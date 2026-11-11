import { expect, test } from "bun:test";
import { CodexExecutor } from "../open-sse/executors/codex.ts";

test("Codex HTTP dispatch uses the verified stable version and preserves explicit overrides", async () => {
  const previousFetch = globalThis.fetch;
  const previousVersion = process.env.CODEX_CLIENT_VERSION;
  const previousUA = process.env.CODEX_USER_AGENT;
  let headers = new Headers();
  globalThis.fetch = (async (_url, options) => {
    headers = new Headers(options?.headers);
    return new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  try {
    delete process.env.CODEX_CLIENT_VERSION;
    delete process.env.CODEX_USER_AGENT;
    const send = async () => {
      const result = await new CodexExecutor().execute({ model: "gpt-5.5", body: { model: "gpt-5.5", input: "fixture" }, stream: true, credentials: { accessToken: "fixture-token", providerSpecificData: { codexTransport: "http" } } as any });
      await (result as any).response.text();
    };
    await send();
    expect(headers.get("version")).toBe("0.167.1");
    expect(headers.get("user-agent")).toContain("/0.167.1 ");
    process.env.CODEX_CLIENT_VERSION = "0.166.0";
    process.env.CODEX_USER_AGENT = "fixture-client/explicit";
    await send();
    expect(headers.get("version")).toBe("0.166.0");
    expect(headers.get("user-agent")).toBe("fixture-client/explicit");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousVersion === undefined) delete process.env.CODEX_CLIENT_VERSION; else process.env.CODEX_CLIENT_VERSION = previousVersion;
    if (previousUA === undefined) delete process.env.CODEX_USER_AGENT; else process.env.CODEX_USER_AGENT = previousUA;
  }
});
