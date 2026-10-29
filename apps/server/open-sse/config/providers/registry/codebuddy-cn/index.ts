import type { RegistryEntry } from "../../shared.ts";

/**
 * CodeBuddy CN (Tencent) — copilot.tencent.com.
 *
 * Unified OpenAI-compatible gateway behind Tencent's CodeBuddy CLI. Carries 19
 * models (GLM, Kimi, MiniMax, DeepSeek, Hunyuan, MiMo, Space-Bunny) and reasons
 * via OpenAI-style `reasoning_effort` (not vendor-native thinking shapes).
 * Streaming is forced by the executor because non-stream requests are rejected
 * with code 11101.
 *
 * Short alias "cbcn" reserves "cbai" for a future CodeBuddy intl variant.
 * Per-model context windows/vision are advertised in the catalog below.
 *
 * Catalog refresh 2026-10: probed live against the gateway. `model [X] service
 * info not found` (code 11102) is the only reliable "does not exist" signal —
 * 429 code 6000 means quota-exhausted, the model is still there. MiMo ships in
 * this gateway under the v-prefixed id only: `mimo-v2.6-pro` answers, every
 * `mimo-2.6*` / `mimo-v2.6-flash*` spelling returns 11102, so there is no flash
 * variant to add. Context windows below that cannot be read off the catalog are
 * marked with the source of the estimate.
 */
export const codebuddy_cnProvider: RegistryEntry = {
  id: "codebuddy-cn",
  vendor: "tencent",
  category: "coding-agent",
  alias: "cbcn",
  format: "openai",
  executor: "codebuddy-cn",
  baseUrl: "https://copilot.tencent.com/v2/chat/completions",
  authType: "oauth",
  authModes: ["oauth", "apikey"],
  authHeader: "bearer",
  headers: {
    "User-Agent": "CLI/2.108.1 CodeBuddy/2.108.1",
    "X-Product": "SaaS",
    "X-IDE-Type": "CLI",
    "X-IDE-Name": "CLI",
    "x-requested-with": "XMLHttpRequest",
    "x-codebuddy-request": "1",
  },
  models: [
    // contextLength is the StyxRouter analogue of upstream's contextWindow;
    // supportsReasoning + supportsVision drive UI affordances and translator
    // decisions. Sourced from the gateway's model config.
    //
    // Ordering: GLM → MiniMax → Kimi → Hunyuan → DeepSeek → MiMo → Space-Bunny,
    // cheapest-tier first inside each family, so the picker reads as a ladder.
    {
      id: "glm-5.3-flash",
      name: "GLM-5.3-Flash",
      // 320B total / 18B active MoE, native multimodal, 1M window advertised by
      // Z.ai. maxOutputTokens 131072 is the conservative floor across providers
      // (some endpoints expose 943718, but routing must not assume it).
      contextLength: 1000000,
      maxOutputTokens: 131072,
      supportsReasoning: true,
      supportsVision: true,
    },
    {
      id: "glm-5.3-flashx",
      name: "GLM-5.3-FlashX",
      // Same weights as -flash tuned for ~200 tok/s. Response carries
      // completion reasoning tokens, so reasoning is on by default.
      contextLength: 1000000,
      maxOutputTokens: 131072,
      supportsReasoning: true,
      supportsVision: true,
    },
    {
      id: "glm-5.3",
      name: "GLM-5.3",
      contextLength: 1000000,
      maxOutputTokens: 128000,
      supportsReasoning: true,
    },
    {
      id: "glm-5.2",
      name: "GLM-5.2",
      contextLength: 1000000,
      maxOutputTokens: 48000,
      supportsReasoning: true,
    },
    {
      id: "glm-5.1",
      name: "GLM-5.1",
      contextLength: 200000,
      maxOutputTokens: 48000,
      supportsReasoning: true,
    },
    {
      id: "glm-5.0",
      name: "GLM-5.0",
      contextLength: 200000,
      maxOutputTokens: 48000,
      supportsReasoning: true,
    },
    {
      id: "glm-5.0-turbo",
      name: "GLM-5.0-Turbo",
      contextLength: 200000,
      maxOutputTokens: 48000,
      supportsReasoning: true,
    },
    {
      id: "glm-5v-turbo",
      name: "GLM-5v-Turbo",
      contextLength: 200000,
      maxOutputTokens: 38000,
      supportsReasoning: true,
      supportsVision: true,
    },
    {
      id: "minimax-m3",
      name: "MiniMax-M3",
      contextLength: 512000,
      maxOutputTokens: 48000,
      supportsReasoning: true,
      supportsVision: true,
    },
    {
      id: "minimax-m2.7",
      name: "MiniMax-M2.7",
      contextLength: 200000,
      maxOutputTokens: 48000,
      supportsReasoning: true,
      supportsVision: true,
    },
    {
      id: "kimi-k3.1-pro",
      name: "Kimi-K3.1-Pro",
      contextLength: 256000,
      maxOutputTokens: 32000,
      supportsReasoning: true,
      supportsVision: true,
    },
    {
      id: "kimi-k3",
      name: "Kimi-K3",
      contextLength: 256000,
      maxOutputTokens: 32000,
      supportsReasoning: true,
      supportsVision: true,
    },
    {
      id: "kimi-k2.7",
      name: "Kimi-K2.7-Code",
      contextLength: 256000,
      maxOutputTokens: 32000,
      supportsReasoning: true,
      supportsVision: true,
    },
    {
      id: "kimi-k2.6",
      name: "Kimi-K2.6",
      contextLength: 256000,
      maxOutputTokens: 32000,
      supportsReasoning: true,
      supportsVision: true,
    },
    {
      id: "kimi-k2.5",
      name: "Kimi-K2.5",
      contextLength: 164000,
      maxOutputTokens: 32000,
      supportsReasoning: true,
      supportsVision: true,
    },
    {
      id: "hy4-preview",
      name: "Hy4 Preview",
      // 770B total / 49B active, Apache 2.0, 1M window (Tencent 2026-08 announce).
      contextLength: 1000000,
      maxOutputTokens: 64000,
      supportsReasoning: true,
      supportsVision: true,
    },
    {
      id: "hy3-preview",
      name: "Hy3 Preview",
      contextLength: 192000,
      maxOutputTokens: 64000,
      supportsReasoning: true,
      supportsVision: true,
    },
    {
      id: "hy3",
      name: "Hy3",
      contextLength: 192000,
      maxOutputTokens: 64000,
      supportsReasoning: true,
      supportsVision: true,
    },
    {
      id: "deepseek-v4.1-flash",
      name: "DeepSeek-V4.1-Flash",
      // 552B MoE, asymmetric Causal-Encoder-Decoder, 8B in / 16B out active.
      // Gateway caps output at 128000 on this id; the v4-flash id stays at 50000.
      contextLength: 1000000,
      maxOutputTokens: 128000,
      supportsReasoning: true,
      supportsVision: true,
    },
    {
      id: "deepseek-v4-pro",
      name: "DeepSeek-V4-Pro",
      contextLength: 1000000,
      maxOutputTokens: 50000,
      supportsReasoning: true,
      supportsVision: true,
    },
    {
      id: "deepseek-v4-flash",
      name: "DeepSeek-V4-Flash",
      contextLength: 1000000,
      maxOutputTokens: 50000,
      supportsReasoning: true,
      supportsVision: true,
    },
    {
      id: "deepseek-v3.2",
      name: "DeepSeek-V3.2",
      contextLength: 96000,
      maxOutputTokens: 32000,
      supportsReasoning: true,
    },
    {
      id: "deepseek-v3-2-volc",
      name: "DeepSeek-V3.2 (Volc)",
      contextLength: 96000,
      maxOutputTokens: 32000,
      supportsReasoning: true,
    },
    {
      id: "mimo-v2.6-pro",
      name: "MiMo-V2.6-Pro",
      // 1T-parameter multimodal reasoning flagship. The only MiMo id the gateway
      // serves — there is no flash/standard tier here, so callers that need a
      // cheap MiMo must reach mimo.mi.com's own Token Plan instead.
      contextLength: 1000000,
      maxOutputTokens: 64000,
      supportsReasoning: true,
      supportsVision: true,
    },
    {
      id: "space-bunny",
      name: "Space-Bunny",
      // Tencent-exclusive anonymous model (0.08x credit rate, promo to 2026-10-07).
      // Identity undisclosed; multimodal input works, so vision stays on.
      contextLength: 256000,
      maxOutputTokens: 32000,
      supportsReasoning: true,
      supportsVision: true,
    },
  ],
};

export default codebuddy_cnProvider;
