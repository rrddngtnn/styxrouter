import os from "node:os";
import path from "node:path";
import zcodeSystem from "../config/zcode_system.json" with { type: "json" };

type JsonRecord = Record<string, unknown>;

export const ZCODE_START_PLAN_ANTHROPIC_ENDPOINT =
  "https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages";

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function resolveEnvPromptInfo() {
  const platform = process.platform === "win32" ? "windows" : process.platform;
  const arch = process.arch === "x64" ? "amd64" : process.arch;
  const release = os.release();
  const osVersion = [platform, release, arch].filter(Boolean).join(" ");
  const shellRaw = process.env.SHELL || process.env.ComSpec || process.env.COMSPEC || "";
  const shell = shellRaw ? path.basename(shellRaw) || "unknown" : "unknown";
  const cwd = process.cwd() || "unknown";
  return { cwd, platform, shell, osVersion };
}

function buildEnvironmentSection(currentModel: string, provider = "zai"): string {
  const env = resolveEnvPromptInfo();
  const e = zcodeSystem.environment;
  const lines = [
    e.heading,
    e.invokedLine,
    `- ${e.cwdLabel}: ${env.cwd}`,
    `- ${e.gitLabel}: ${e.gitNo}`,
    `- ${e.platformLabel}: ${env.platform}`,
    `- ${e.shellLabel}: ${env.shell}`,
    `- ${e.osVersionLabel}: ${env.osVersion}`,
  ];
  const modelId = currentModel.trim();
  if (modelId) {
    const providerModelId = provider === "bigmodel" ? "bigmodel-api" : "zai-api";
    lines.push(
      e.poweredByLine
        .replace("{provider}", providerModelId)
        .replace("{model}", modelId)
    );
  }
  return lines.join("\n");
}

export function buildZcodeStartPlanSystemBlocks(currentModel: string, provider = "zai") {
  const stable = zcodeSystem.stableSections.join("\n\n");
  const dynamic = [
    zcodeSystem.dynamicSections.beforeEnvironment,
    buildEnvironmentSection(currentModel, provider),
    zcodeSystem.dynamicSections.afterEnvironment,
  ].join("\n\n");
  return [
    { type: "text", text: zcodeSystem.cliPrefix, cache_control: { type: "ephemeral" } },
    { type: "text", text: stable, cache_control: { type: "ephemeral" } },
    { type: "text", text: "\n\n" + dynamic, cache_control: { type: "ephemeral" } },
  ];
}

export function buildZcodeContextPrefixMessage(now = new Date()) {
  const cp = zcodeSystem.contextPrefix;
  const isoDate = now.toISOString().slice(0, 10);
  const currentDate = `${cp.currentDateHeading}\n${cp.currentDateLine.replace("{date}", isoDate)}`;
  const body = [cp.intro, currentDate, "", cp.outro].join("\n");
  const text = `${zcodeSystem.systemReminder.open}${body}${zcodeSystem.systemReminder.close}`;
  return {
    role: "user",
    content: [{ type: "text", text }],
  };
}

function extractUserSystemText(systemField: unknown): string {
  if (typeof systemField === "string") return systemField.trim();
  if (!Array.isArray(systemField)) return "";
  const parts: string[] = [];
  for (const item of systemField) {
    if (typeof item === "string" && item.trim()) {
      parts.push(item.trim());
    } else if (asRecord(item) && typeof asRecord(item)!.text === "string") {
      const t = (asRecord(item)!.text as string).trim();
      if (t && !t.startsWith("You are Claude Code") && !t.startsWith("You are ZCode")) {
        parts.push(t);
      }
    }
  }
  return parts.join("\n\n");
}

function prependBlockToMessage(msg: JsonRecord, block: JsonRecord) {
  const content = msg.content;
  if (typeof content === "string") {
    msg.content = [block, { type: "text", text: content }];
  } else if (Array.isArray(content)) {
    msg.content = [block, ...content];
  } else {
    msg.content = [block];
  }
}

function applyAnthropicCacheControl(messages: JsonRecord[]) {
  for (const msg of messages) {
    if (msg.role === "system") continue;
    if (Array.isArray(msg.content)) {
      for (const b of msg.content) {
        const rec = asRecord(b);
        if (rec) delete rec.cache_control;
      }
    }
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "system") continue;
    if (typeof msg.content === "string") {
      msg.content = [
        { type: "text", text: msg.content, cache_control: { type: "ephemeral" } },
      ];
    } else if (Array.isArray(msg.content) && msg.content.length > 0) {
      const last = asRecord(msg.content[msg.content.length - 1]);
      if (last && !last.cache_control) {
        last.cache_control = { type: "ephemeral" };
      }
    }
    return;
  }
}

export function applyZcodeStartPlanBodyTransform(
  body: unknown,
  currentModel: string,
  deviceMid: string,
  provider = "zai"
): JsonRecord {
  const record = { ...(asRecord(body) ?? {}) };
  const userSystemText = extractUserSystemText(record.system);
  record.system = buildZcodeStartPlanSystemBlocks(currentModel, provider);

  const rawMessages = Array.isArray(record.messages)
    ? record.messages.map((m) => ({ ...(asRecord(m) ?? {}) }))
    : [];

  if (userSystemText) {
    const sysBlock = { type: "text", text: userSystemText };
    const firstUser = rawMessages.find((m) => m.role === "user");
    if (firstUser) {
      prependBlockToMessage(firstUser, sysBlock);
    } else {
      rawMessages.unshift({ role: "user", content: [sysBlock] });
    }
  }

  if (rawMessages.length > 0) {
    rawMessages.unshift(buildZcodeContextPrefixMessage());
  }

  if (Array.isArray(record.tools)) {
    record.tools = record.tools.map((t) => {
      const tr = { ...(asRecord(t) ?? {}) };
      delete tr.cache_control;
      return tr;
    });
  }

  applyAnthropicCacheControl(rawMessages);
  record.messages = rawMessages;
  record.metadata = {
    user_id: JSON.stringify({
      device_id: deviceMid.trim(),
      account_uuid: "",
      session_id: "",
    }),
  };

  return record;
}
