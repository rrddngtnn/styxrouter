import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "model-editor-"));
process.env.DATA_DIR = dir;
const overrides = await import("../src/lib/db/modelCapabilityOverrides.ts");
const { getResolvedModelCapabilities, createModelCapabilityResolutionSnapshot } = await import("../src/lib/modelCapabilities.ts");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("unknown model context defaults to 1M and unknown GPT context to 256K", () => {
  expect(getResolvedModelCapabilities({ provider: "codex", model: "unlisted-model-editor" }).contextWindow).toBe(1000000);
  expect(getResolvedModelCapabilities({ provider: "codex", model: "gpt-unlisted-model-editor" }).contextWindow).toBe(256000);
});

test("local editor rejects spoofed and forwarded transport and validates before persistence", async () => {
  const { createModelMetadataApi } = await import("../server/modelMetadata.ts");
  const app = createModelMetadataApi();
  const payload = { provider: "codex", modelId: "gpt-5", contextWindow: 256000, supportsTools: false, supportsThinking: false, supportsVision: true };
  const send = (peerAddress?: string, headers: Record<string, string> = {}, body: unknown = payload) => app.request("http://localhost/", { method: "PATCH", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }, { peerAddress });
  expect((await send()).status).toBe(403);
  expect((await send("203.0.113.1", { Host: "localhost" })).status).toBe(403);
  expect((await send("127.0.0.1", { "X-Forwarded-For": "203.0.113.1" })).status).toBe(403);
  expect((await send("127.0.0.1", { Origin: "https://evil.example" })).status).toBe(403);
  expect((await send("127.0.0.1", {}, { ...payload, contextWindow: -1 })).status).toBe(400);
  expect((await send("127.0.0.1")).status).toBe(200);
  const read = await app.request("http://localhost/?provider=codex&modelId=gpt-5", {}, { peerAddress: "127.0.0.1" });
  const model = (await read.json()).model;
  expect(model.contextWindow).toBe(256000);
  expect(model.supportsTools).toBe(false);
  expect(model.supportsThinking).toBe(false);
  expect(model.supportsVision).toBe(true);
  expect((await send("127.0.0.1", {}, { provider: "codex", modelId: "gpt-5", contextWindow: null, supportsTools: null, supportsThinking: null, supportsVision: null })).status).toBe(200);
});

test("Bun transport supplies the peer, rejects unauthenticated proxy headers, and allows authenticated sessions behind a reverse proxy", async () => {
  const { Hono } = await import("hono");
  const { SignJWT } = await import("jose");
  const { createModelMetadataApi } = await import("../server/modelMetadata.ts");
  process.env.JWT_SECRET = "test-model-editor-secret-key-32-bytes";
  const token = await new SignJWT({ authenticated: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(process.env.JWT_SECRET));
  const app = new Hono<{ Bindings: { peerAddress?: string } }>();
  app.route("/api/model-metadata", createModelMetadataApi());
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request, server) => app.fetch(request, { peerAddress: server.requestIP(request)?.address }) });
  try {
    const url = `http://127.0.0.1:${server.port}/api/model-metadata?provider=codex&modelId=gpt-5`;
    expect((await fetch(url)).status).toBe(200);
    expect((await fetch(url, { headers: { "X-Forwarded-Host": "remote.example" } })).status).toBe(403);
    expect((await fetch(url, { headers: { Origin: "https://remote.example" } })).status).toBe(403);
    expect(
      (
        await fetch(url, {
          headers: {
            Cookie: `auth_token=${token}`,
            "X-Forwarded-Host": "styx.example.com",
            "X-Forwarded-For": "198.51.100.7",
            Origin: "https://styx.example.com",
          },
        })
      ).status,
    ).toBe(200);
  } finally { await server.stop(true); }
});

test("boolean overrides persist and affect runtime and catalog snapshot resolution", () => {
  for (const key of ["supportsTools", "supportsThinking", "supportsVision"] as const) {
    expect(overrides.setModelCapabilityOverride("codex/gpt-5", key as any, false as any)).toBe(true);
  }
  for (const snapshot of [undefined, createModelCapabilityResolutionSnapshot()]) {
    const caps = getResolvedModelCapabilities({ provider: "codex", model: "gpt-5" }, undefined, snapshot);
    expect(caps.toolCalling).toBe(false);
    expect(caps.reasoning).toBe(false);
    expect(caps.supportsVision).toBe(false);
  }
  expect(getResolvedModelCapabilities({ provider: "openai", model: "gpt-5" }).toolCalling).toBe(true);
  for (const key of ["supportsTools", "supportsThinking", "supportsVision"] as const) {
    expect(overrides.setModelCapabilityOverride("codex/gpt-5", key, true)).toBe(true);
  }
  const enabled = getResolvedModelCapabilities({ provider: "codex", model: "gpt-5" });
  expect(enabled.toolCalling).toBe(true);
  expect(enabled.reasoning).toBe(true);
  expect(enabled.supportsVision).toBe(true);
  expect(getResolvedModelCapabilities({ provider: "codex", model: "gpt-5" }, { persistedOverrides: false }).toolCalling).toBe(true);
  for (const key of ["supportsTools", "supportsThinking", "supportsVision"] as const) {
    expect(overrides.removeModelCapabilityOverride("codex/gpt-5", key as any)).toBe(true);
  }
  expect(getResolvedModelCapabilities({ provider: "codex", model: "gpt-5" }).toolCalling).toBe(true);
});
