import { expect, test } from "bun:test";
import { VisionBridgeGuardrail } from "../src/lib/guardrails/visionBridge";
import { callVisionModel, GuardedVisionImageFetchError } from "../src/lib/guardrails/visionBridgeHelpers";
import { GuardrailRegistry } from "../src/lib/guardrails/registry";

const proxyKeys = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"];

test("describe blocks a guarded image fetch failure through the registry", async () => {
  const saved = Object.fromEntries(proxyKeys.map(key => [key, process.env[key]]));
  for (const key of proxyKeys) delete process.env[key];
  try {
    const registry = new GuardrailRegistry();
    registry.register(new VisionBridgeGuardrail({ deps: {
      getSettings: async () => ({ modalityBridgeVisionEnabled: true, modalityBridgeVisionMode: "describe", modalityBridgeVisionModel: "anthropic/test", modalityBridgeCacheEnabled: false }),
      callVisionModel: (image, config) => callVisionModel(image, config, "test", { maxFallbackAttempts: 1 }, { hasUsableCredentials: async () => true }),
    } }));
    const body = { model: "auto", messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "http://169.254.169.254/latest/meta-data/" } }] }] };
    expect((await registry.runPreCallHooks(body, {})).blocked).toBe(true);
  } finally {
    for (const key of proxyKeys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  }
});

test("a guarded failure blocks even when another image is described", async () => {
  const bridge = new VisionBridgeGuardrail({ deps: {
    getSettings: async () => ({ modalityBridgeVisionEnabled: true, modalityBridgeVisionMode: "describe", modalityBridgeCacheEnabled: false }),
    callVisionModel: async (image) => {
      if (image.includes("blocked")) throw new GuardedVisionImageFetchError("blocked");
      return "safe description";
    },
  } });
  const result = await bridge.preCall({ model: "auto", messages: [{ role: "user", content: [
    { type: "image_url", image_url: { url: "https://safe.example/image" } },
    { type: "image_url", image_url: { url: "https://blocked.example/image" } },
  ] }] }, {});
  expect(result.block).toBe(true);
});

test("ordinary describe errors preserve the existing fail-partial behavior", async () => {
  const bridge = new VisionBridgeGuardrail({ deps: {
    getSettings: async () => ({ modalityBridgeVisionEnabled: true, modalityBridgeVisionMode: "describe", modalityBridgeCacheEnabled: false }),
    callVisionModel: async () => { throw new Error("provider unavailable"); },
  } });
  const body = { model: "auto", messages: [{ role: "user", content: [
    { type: "image_url", image_url: { url: "https://safe.example/image" } },
  ] }] };
  const result = await bridge.preCall(body, {});
  expect(result.block).toBe(false);
  expect(result.modifiedPayload).toEqual(body);
});
