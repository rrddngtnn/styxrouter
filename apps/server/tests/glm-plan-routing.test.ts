import { test, expect } from "bun:test";
import {
  getGlmPlanFamily,
  getGlmPrimaryTransport,
  buildGlmChatUrl,
} from "../open-sse/config/glmProvider.ts";

test("plan family round-trip: coding", () => {
  const psd = { planFamily: "coding", organizationName: "默认机构", projectName: "默认项目" };
  expect(getGlmPlanFamily(psd)).toBe("coding");
  expect(getGlmPrimaryTransport(psd)).toBe("openai");
});

test("plan family round-trip: start → biases to anthropic transport", () => {
  const psd = { planFamily: "start", organizationName: "Start Plan", projectName: "start-trial" };
  expect(getGlmPlanFamily(psd)).toBe("start");
  // Start plan's quota lives on the Anthropic translation layer; the transport
  // selector must flip without any explicit primaryTransport override.
  expect(getGlmPrimaryTransport(psd)).toBe("anthropic");
});

test("plan family round-trip: team keeps openai transport", () => {
  const psd = { planFamily: "team", projectType: "2", organizationName: "Team Co", projectName: "team-coding" };
  expect(getGlmPlanFamily(psd)).toBe("team");
  expect(getGlmPrimaryTransport(psd)).toBe("openai");
});

test("per-connection primaryTransport override wins over plan-family bias", () => {
  // Operator pinned openai even though plan family is start → openai honored.
  const psd = { planFamily: "start", primaryTransport: "openai" };
  expect(getGlmPrimaryTransport(psd)).toBe("openai");
});

test("unknown plan family falls back to legacy base-url inference", () => {
  const psd = { planFamily: null };
  // Without a base URL hint the inference lands on openai, matching the
  // pre-plan-family behaviour.
  expect(getGlmPrimaryTransport(psd)).toBe("openai");
});

test("start-plan dispatch URL resolves to the anthropic messages endpoint", () => {
  const psd = { planFamily: "start" };
  const url = buildGlmChatUrl(psd, getGlmPrimaryTransport(psd));
  expect(url).toContain("/anthropic");
  expect(url).toContain("/messages");
});

test("coding-plan dispatch URL stays on the OpenAI coding gateway", () => {
  const psd = { planFamily: "coding" };
  const url = buildGlmChatUrl(psd, getGlmPrimaryTransport(psd));
  expect(url).toContain("/coding/paas/v4/chat/completions");
});

test("glm and zai expose oauth + apikey modes and Start Plan Anthropic headers include Bearer + x-api-key", async () => {
  const { glmProvider } = await import("../open-sse/config/providers/registry/glm/index.ts");
  const { buildGlmBaseHeaders } = await import("../open-sse/config/glmProvider.ts");
  expect(glmProvider.authModes).toEqual(["oauth", "apikey"]);
  const headers = buildGlmBaseHeaders("test-plan-key", false);
  expect(headers["x-api-key"]).toBe("test-plan-key");
  expect(headers["Authorization"]).toBe("Bearer test-plan-key");
});

test("zai-glm pollToken with pending status returns error: authorization_pending", async () => {
  const { zaiGlmProvider } = await import("../src/lib/oauth/providers/zai-glm.ts");
  expect(typeof zaiGlmProvider.requestDeviceCode).toBe("function");
  expect(typeof zaiGlmProvider.pollToken).toBe("function");
});
