import fs from "node:fs";
import { DefaultExecutor } from "./default.ts";
import { FETCH_BODY_TIMEOUT_MS } from "../config/constants.ts";
import { createAbortError, createBodyTimeoutError, readStreamChunkWithTimeout } from "../handlers/chatCore/upstreamTimeouts.ts";
import type { ExecuteInput, ExecutorExecuteResult, ProviderCredentials } from "./base.ts";

const SENSITIVE_CONTENT_REJECTION =
  "抱歉，系统检测到您当前输入的信息存在敏感内容，我无法响应您的请求，请检查后重新输入";
const LARGE_TOOL_METADATA_BYTES = 64 * 1024;

// Read from the environment only. No operator path may live in public source.
const SOUL_PATH = process.env.RATMAN_SOUL_PATH?.trim() ?? "";

let cachedSoul: { mtimeMs: number; content: string } | null = null;

function getRatmanSoul(): string {
  try {
    const st = fs.statSync(SOUL_PATH);
    if (cachedSoul && cachedSoul.mtimeMs === st.mtimeMs) {
      return cachedSoul.content;
    }
    const content = fs.readFileSync(SOUL_PATH, "utf8").trim();
    cachedSoul = { mtimeMs: st.mtimeMs, content };
    return content;
  } catch {
    return "";
  }
}

function responseFromResult(result: ExecutorExecuteResult): Response {
  return result instanceof Response ? result : result.response;
}

function credentialsFromResult(
  result: ExecutorExecuteResult,
  fallback: ProviderCredentials
): ProviderCredentials {
  if (result instanceof Response || !result.headers) return fallback;

  const authorization = Object.entries(result.headers).find(
    ([name]) => name.toLowerCase() === "authorization"
  )?.[1];
  if (!authorization?.startsWith("Bearer ")) return fallback;

  return {
    ...fallback,
    accessToken: authorization.slice("Bearer ".length),
    expiresAt: undefined,
  };
}

function compactToolDescriptions(body: unknown): unknown | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;

  const request = body as Record<string, unknown>;
  if (!Array.isArray(request.tools) || request.tools.length === 0) return null;

  const originalTools = request.tools;
  try {
    const serializedTools = JSON.stringify(originalTools);
    if (new TextEncoder().encode(serializedTools).byteLength < LARGE_TOOL_METADATA_BYTES) {
      return null;
    }
  } catch {
    return null;
  }

  let tools: unknown[] | null = null;
  originalTools.forEach((tool, index) => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) return;

    const declaration = tool as Record<string, unknown>;
    if (
      declaration.type !== "function" ||
      !declaration.function ||
      typeof declaration.function !== "object" ||
      Array.isArray(declaration.function)
    ) {
      return;
    }

    const toolFunction = declaration.function as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(toolFunction, "description")) return;

    const compactFunction = { ...toolFunction };
    delete compactFunction.description;
    tools ??= originalTools.slice();
    tools[index] = { ...declaration, function: compactFunction };
  });

  return tools ? { ...request, tools } : null;
}

async function normalizeFrequencyLimit(result: ExecutorExecuteResult, signal?: AbortSignal | null): Promise<ExecutorExecuteResult> {
  const response = responseFromResult(result);
  if (response.status !== 200 || !/\bapplication\/(?:[\w.+-]*\+)?json\b/i.test(response.headers.get("content-type") ?? "")) return result;
  const reader = response.body?.getReader();
  if (!reader) return result;
  const chunks: Uint8Array[] = [];
  let size = 0;
  const deadline = FETCH_BODY_TIMEOUT_MS > 0 ? Date.now() + FETCH_BODY_TIMEOUT_MS : 0;
  const replaceResponse = (body: BodyInit) => {
    const replacement = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    return result instanceof Response ? replacement : { ...result, response: replacement };
  };
  const passthrough = () => {
    let index = 0;
    return replaceResponse(new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (index < chunks.length) { controller.enqueue(chunks[index++]); return; }
        try {
          const next = await reader.read();
          if (next.done) controller.close(); else controller.enqueue(next.value);
        } catch (error) { controller.error(error); }
      },
      cancel(reason) { return reader.cancel(reason); },
    }));
  };
  let abortListener: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    if (!signal) return;
    abortListener = () => reject(createAbortError(signal));
    if (signal.aborted) abortListener();
    else signal.addEventListener("abort", abortListener, { once: true });
  });
  try {
    while (true) {
      const remaining = deadline ? deadline - Date.now() : 0;
      if (deadline && remaining <= 0) throw createBodyTimeoutError(FETCH_BODY_TIMEOUT_MS);
      const { done, value } = await Promise.race([readStreamChunkWithTimeout(reader, remaining), aborted]);
      if (done) break;
      size += value!.byteLength;
      chunks.push(value!);
      if (size > 65536) return passthrough();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || typeof data !== "object" || Array.isArray(data) || data.code === 6000 || data.code === "6000") return replaceResponse(bytes);
    const message = [data.msg, data.message, data.error?.message].find((value) => typeof value === "string") ?? "";
    if (data.code !== 6004 && data.code !== "6004" && !/超出频率限制|frequency limit|限额/i.test(message)) return replaceResponse(bytes);
    const headers = new Headers(response.headers);
    // The body has changed; representation metadata and credentials must not survive.
    for (const name of ["content-length", "content-encoding", "content-range", "etag", "digest", "content-md5", "authorization", "proxy-authorization", "set-cookie"]) headers.delete(name);
    headers.set("content-type", "application/json");
    const normalized = new Response(JSON.stringify({ error: { message: "CodeBuddy frequency limit", type: "rate_limit_error" } }), { status: 429, headers });
    return result instanceof Response ? normalized : { ...result, response: normalized };
  } catch (error) {
    if (error instanceof SyntaxError) return passthrough();
    void reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    if (signal && abortListener) signal.removeEventListener("abort", abortListener);
  }
}

async function isSensitiveContentRejection(response: Response): Promise<boolean> {
  if (response.status !== 400) return false;
  const responseText = await response
    .clone()
    .text()
    .catch(() => "");
  return responseText.includes(SENSITIVE_CONTENT_REJECTION);
}

/**
 * CodeBuddyCnExecutor — talks to https://copilot.tencent.com/v2/chat/completions
 *
 * CodeBuddy CN is an OpenAI-compatible Tencent gateway but it rejects non-stream
 * chat requests (HTTP 400, code 11101 "Non-stream chat request is currently not
 * supported"). The same-format (openai→openai) translator path leaves body.stream
 * as the client sent it, so we force it true here — StyxRouter still re-aggregates
 * the SSE into a JSON response for non-streaming clients.
 *
 * Reasoning params are opt-in: reasoning_summary:"auto" is only added when the
 * client explicitly sets reasoning_effort. Plain requests are left untouched.
 * When the caller explicitly asks for "none"/"off" we drop the field entirely
 * (the gateway has no "none" value). Forcing reasoning on plain requests trips
 * CodeBuddy's content filter and returns an error.
 *
 * Agent system prompt replacement: Tencent's content filter flags CLI agent system
 * prompts ("You are Claude Code, Anthropic's official CLI…") as prompt injection /
 * sensitive content and rejects the whole request. Detect agent system prompts
 * (length catch-all + identity-marker regex) and replace them with a neutral one,
 * while leaving legitimate user system prompts untouched. Content may be a string
 * or typed blocks ([{type:"text",text}]) depending on the incoming client format,
 * so flatten before matching and preserve the original shape on replacement.
 */
export class CodeBuddyCnExecutor extends DefaultExecutor {
  constructor() {
    super("codebuddy-cn");
  }

  async execute(input: ExecuteInput): Promise<ExecutorExecuteResult> {
    const result = await normalizeFrequencyLimit(await super.execute({ ...input, skipUpstreamRetry: true }), input.signal);
    if (!(await isSensitiveContentRejection(responseFromResult(result)))) {
      return result;
    }

    const compactBody = compactToolDescriptions(input.body);
    if (!compactBody) return result;

    input.log?.debug?.(
      "CODEBUDDY_CN",
      "Upstream rejected an oversized tool request as sensitive content; retrying with compact tool descriptions"
    );
    return normalizeFrequencyLimit(await super.execute({
      ...input,
      skipUpstreamRetry: true,
      body: compactBody,
      credentials: credentialsFromResult(result, input.credentials),
    }), input.signal);
  }

  transformRequest(
    model: string,
    body: unknown,
    stream: boolean,
    credentials: ProviderCredentials
  ): unknown {
    const transformed = super.transformRequest(model, body, stream, credentials);
    if (!transformed || typeof transformed !== "object" || Array.isArray(transformed)) {
      return transformed;
    }
    const out = transformed as Record<string, unknown>;
    out.stream = true;

    const eff = out.reasoning_effort;
    if (eff === "none" || eff === "off") {
      delete out.reasoning_effort;
    } else if (eff) {
      out.reasoning_summary = "auto";
    }

    // --- Agent system prompt replacement ---
    // Tencent's content filter flags CLI agent system prompts as sensitive content.
    // Use the configured system prompt when available, falling back to the neutral prompt.
    const NEUTRAL_PROMPT =
      getRatmanSoul() || "You are a helpful AI assistant that helps with software engineering tasks.";
    const AGENT_PATTERN = /you are claude code|claude.?code.+official.+cli|anthropic.+official.+cli|anxthxropic.+official.+cli|you are (?:cursor|windsurf|cline|aider|continue|copilot|cody)|you are an? (?:ai )?(?:coding |code )?agent|cc_entrypoint\s*=\s*(?:cli|vscode|jetbrains|gui)|claude.?code.+issues|give feedback.+claude.?code|you are .{0,30}(?:powerful )?ai agent|orchestration capabilities|OhMyOpenCode|<agent-identity>|<Role>|<Behavior_Instructions>/i;
    const flatten = (content: unknown): string =>
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? (content as Array<Record<string, unknown>>)
              .map((b) => (b && typeof b.text === "string" ? b.text : ""))
              .join("\n")
          : "";

    // Handle top-level `system` field (Anthropic format after translation)
    const ratmanSoul = getRatmanSoul();
    if (out.system) {
      const text = flatten(out.system);
      if (text && (text.length > 2000 || AGENT_PATTERN.test(text))) {
        out.system = NEUTRAL_PROMPT;
      }
    } else if (ratmanSoul) {
      out.system = ratmanSoul;
    }

    // Handle messages array with role: "system"
    if (Array.isArray(out.messages)) {
      let hasSystem = false;
      const messages = (out.messages as Array<Record<string, unknown>>).map((message) => {
        if (!message || message.role !== "system") return message;
        hasSystem = true;
        const text = flatten(message.content);
        if (!text) return message;
        if (text.length > 2000 || AGENT_PATTERN.test(text)) {
          return typeof message.content === "string"
            ? { ...message, content: NEUTRAL_PROMPT }
            : { ...message, content: [{ type: "text", text: NEUTRAL_PROMPT }] };
        }
        return message;
      });

      out.messages = !hasSystem && ratmanSoul
        ? [{ role: "system", content: ratmanSoul }, ...messages]
        : messages;
    }

    // --- Strip oversized tool descriptions (>64KB) ---
    // Large tool descriptions can also trigger the content filter.
    if (Array.isArray(out.tools) && out.tools.length > 0) {
      try {
        const s = JSON.stringify(out.tools);
        if (new TextEncoder().encode(s).byteLength >= 65536) {
          out.tools = (out.tools as Array<Record<string, unknown>>).map((tool) => {
            if (!tool || typeof tool !== "object" || Array.isArray(tool)) return tool;
            if (tool.type !== "function" || !tool.function || typeof tool.function !== "object" || Array.isArray(tool.function)) return tool;
            if (!Object.prototype.hasOwnProperty.call(tool.function, "description")) return tool;
            const cf = { ...(tool.function as Record<string, unknown>) };
            delete cf.description;
            return { ...tool, function: cf };
          });
        }
      } catch {}
    }

    return out;
  }
}

export default CodeBuddyCnExecutor;
