import { expect, test } from "bun:test";
import { ensureBase64ImagesForClaudeWire } from "../src/lib/guardrails/visionBridgeHelpers";
import { VisionBridgeGuardrail } from "../src/lib/guardrails/visionBridge";
import { GuardrailRegistry } from "../src/lib/guardrails/registry";
import { createServer } from "node:http";

const proxyKeys = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"];

test("guarded reroute blocks metadata URLs instead of forwarding them, including through registry", async () => {
  const saved = Object.fromEntries(proxyKeys.map(key => [key, process.env[key]]));
  for (const key of proxyKeys) delete process.env[key];
  try {
    const body = { model: "auto", messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "http://169.254.169.254/latest/meta-data/" } }] }] };
    await expect(ensureBase64ImagesForClaudeWire(body, "anthropic/test")).rejects.toThrow();
    const registry = new GuardrailRegistry();
    registry.register(new VisionBridgeGuardrail({ deps: {
      getSettings: async () => ({ modalityBridgeVisionEnabled: true, modalityBridgeVisionMode: "reroute", modalityBridgeVisionModel: "anthropic/test" }),
      hasUsableCredentials: async () => true,
    } }));
    const result = await registry.runPreCallHooks(body, {});
    expect(result.blocked).toBe(true);
    const responsesBody = { model: "auto", input: [{ role: "user", content: [{ type: "input_image", image_url: "http://169.254.169.254/latest/meta-data/" }] }] };
    expect((await registry.runPreCallHooks(responsesBody, {})).blocked).toBe(true);
    process.env.HTTP_PROXY = "http://127.0.0.1:9";
    expect((await registry.runPreCallHooks(body, {})).blocked).toBe(true);
  } finally {
    for (const key of proxyKeys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  }
});

test("successful guarded fetch replaces every supported image shape without mutating input", async () => {
  const saved = Object.fromEntries(proxyKeys.map(key => [key, process.env[key]]));
  for (const key of proxyKeys) delete process.env[key];
  const server = createServer((_req, res) => { res.setHeader("content-type", "image/png"); res.end("safe"); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/image`;
    const body = { input: [{ role: "user", content: [
      { type: "input_image", image_url: url },
      { type: "image", source: { type: "url", url } },
      { type: "image_url", image_url: { url } },
    ] }] };
    const result = await ensureBase64ImagesForClaudeWire(body as any, "anthropic/test");
    expect((result.input![0].content as any)[0].image_url).toBe("data:image/png;base64,c2FmZQ==");
    expect((result.input![0].content as any)[1].source).toEqual({ type: "base64", media_type: "image/png", data: "c2FmZQ==" });
    expect((result.input![0].content as any)[2].image_url.url).toBe("data:image/png;base64,c2FmZQ==");
    expect(body.input[0].content[0].image_url).toBe(url);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const key of proxyKeys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  }
});
