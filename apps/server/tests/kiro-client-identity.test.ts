import "./helpers/test-secrets";
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { release } from "node:os";
import { KiroExecutor } from "../open-sse/executors/kiro";

test("Kiro dispatch uses the supported released IDE Smithy identity without changing auth or endpoint", async () => {
  const original = globalThis.fetch;
  const calls: { url: string; headers: Headers; body: any; signal: unknown }[] = [];
  const abort = new AbortController();
  try {
    globalThis.fetch = (async (url, init) => {
      calls.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)), signal: init?.signal });
      return Response.json({ message: "ordinary rejection" }, { status: 400 });
    }) as typeof fetch;
    for (const authMethod of ["builder-id", "api_key", "external_idp"]) {
      const body = { conversationState: { currentMessage: { userInputMessage: { content: "test", modelId: "claude-sonnet-5.5" } } }, profileArn: "arn:aws:codewhisperer:eu-central-1:111111111111:profile/test" };
      await new KiroExecutor().execute({ model: "claude-sonnet-5.5", body, stream: false, signal: abort.signal,
        credentials: { accessToken: "synthetic-access", apiKey: "synthetic-api", providerSpecificData: { authMethod, profileArn: body.profileArn } },
        upstreamExtraHeaders: { "x-fixture-proxy-header": "preserved" } } as any);
      const call = calls.at(-1)!;
      const rawId = readFileSync("/var/lib/dbus/machine-id", "utf8").split("\n")[0].replace(/\s+/g, "").toLowerCase();
      const machine = createHash("sha256").update(rawId).digest("hex");
      const custom = `KiroIDE-0.11.133-${machine}`;
      expect(call.headers.get("x-amz-user-agent")).toBe(`aws-sdk-js/1.0.34 ${custom}`);
      expect(call.headers.get("user-agent")).toBe(`aws-sdk-js/1.0.34 ua/2.1 os/${process.platform}#${release().replace(/[^!$%&'*+\-.^_`|~\w#]/g, "-")} lang/js md/nodejs#${process.versions.node} api/codewhispererstreaming#1.0.34 m/E ${custom}`);
      expect(call.url).toBe("https://q.eu-central-1.amazonaws.com/generateAssistantResponse");
      expect(call.headers.get("authorization")).toBe(`Bearer ${authMethod === "api_key" ? "synthetic-api" : "synthetic-access"}`);
      expect(call.headers.get("tokentype")).toBe(authMethod === "api_key" ? "API_KEY" : authMethod === "external_idp" ? "EXTERNAL_IDP" : null);
      expect(call.headers.get("x-fixture-proxy-header")).toBe("preserved");
      expect(call.body).toEqual(body);
      expect(call.signal).toBe(abort.signal);
    }
    expect(calls[0].headers.get("amz-sdk-invocation-id")).not.toBe(calls[1].headers.get("amz-sdk-invocation-id"));
    expect(calls[0].headers.get("user-agent")).toBe(calls[1].headers.get("user-agent"));
  } finally { globalThis.fetch = original; }
});
