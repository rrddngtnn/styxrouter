import type { RegistryEntry } from "../../shared.ts";

/**
 * CodeBuddy International (Tencent) — codebuddy.ai.
 *
 * International variant of CodeBuddy. Same OpenAI-compatible gateway protocol,
 * different host (codebuddy.ai vs copilot.tencent.com), different model catalog
 * (international mainstream models), separate credential pool.
 *
 * Alias "cbai" as reserved by the CN registry comment.
 * Auth and token refresh share the same flow shape as CN but hit different endpoints.
 */
export const codebuddy_intlProvider: RegistryEntry = {
  id: "codebuddy-intl",
  displayName: "CodeBuddy International",
  vendor: "tencent",
  category: "coding-agent",
  alias: "cbai",
  format: "openai",
  executor: "codebuddy-intl",
  baseUrl: "https://www.codebuddy.ai/v2/chat/completions",
  authType: "apikey",
  authHeader: "bearer",
  headers: {
    "User-Agent": "IDE/2.108.1 CodeBuddy/2.108.1",
    "X-Product": "SaaS",
    "X-IDE-Type": "IDE",
    "X-IDE-Name": "IDE",
    "x-requested-with": "XMLHttpRequest",
    "x-codebuddy-request": "1",
  },
  models: [
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
      contextLength: 1000000,
      maxOutputTokens: 48000,
      supportsReasoning: true,
    },
    {
      id: "glm-5.0",
      name: "GLM-5.0",
      contextLength: 262144,
      maxOutputTokens: 32768,
      supportsReasoning: true,
    },
    {
      id: "glm-5.0-turbo",
      name: "GLM-5.0-Turbo",
      contextLength: 262144,
      maxOutputTokens: 32768,
      supportsReasoning: false,
    },
    {
      id: "glm-5v-turbo",
      name: "GLM-5v-Turbo",
      contextLength: 262144,
      maxOutputTokens: 32768,
      supportsReasoning: false,
      supportsVision: true,
    },
    {
      id: "glm-4.7",
      name: "GLM-4.7",
      contextLength: 131072,
      maxOutputTokens: 16384,
      supportsReasoning: false,
    },
    {
      id: "minimax-m3",
      name: "MiniMax-M3",
      contextLength: 262144,
      maxOutputTokens: 32768,
      supportsReasoning: true,
    },
    {
      id: "minimax-m2.7",
      name: "MiniMax-M2.7",
      contextLength: 262144,
      maxOutputTokens: 32768,
      supportsReasoning: false,
    },
    {
      id: "kimi-k2.7",
      name: "Kimi-K2.7-Code",
      contextLength: 262144,
      maxOutputTokens: 32768,
      supportsReasoning: true,
    },
    {
      id: "kimi-k2.6",
      name: "Kimi-K2.6",
      contextLength: 262144,
      maxOutputTokens: 32768,
      supportsReasoning: true,
    },
    {
      id: "kimi-k2.5",
      name: "Kimi-K2.5",
      contextLength: 262144,
      maxOutputTokens: 32768,
      supportsReasoning: true,
    },
    {
      id: "hy3-preview",
      name: "Hy3 Preview",
      contextLength: 131072,
      maxOutputTokens: 16384,
      supportsReasoning: false,
    },
    {
      id: "deepseek-v4-pro",
      name: "DeepSeek-V4-Pro",
      contextLength: 131072,
      maxOutputTokens: 32768,
      supportsReasoning: true,
    },
    {
      id: "deepseek-v4.1-flash",
      name: "DeepSeek-V4.1-Flash",
      contextLength: 131072,
      maxOutputTokens: 32768,
      supportsReasoning: true,
    },
    {
      id: "deepseek-v3-2-volc",
      name: "DeepSeek-V3.2",
      contextLength: 131072,
      maxOutputTokens: 32768,
      supportsReasoning: false,
    },
  ],
};
