import "./helpers/test-secrets";
import { expect, test } from "bun:test";
import { AntigravityExecutor } from "../open-sse/executors/antigravity.ts";
import { getAntigravityUsage } from "../open-sse/services/usage/antigravity.ts";
import { ensureAntigravityProjectAssigned } from "../open-sse/services/antigravityProjectBootstrap.ts";
import { getAntigravityClientProfile } from "../open-sse/services/antigravityClientProfile.ts";

// All traffic is intercepted; no credentials or provider services are used.
test.each([undefined, "ide", "hub", "cli"])("bootstrap, quota catalog and dispatch share profile %s", async (stored) => {
  const originalFetch = globalThis.fetch;
  const originalProfile = process.env.STYX_ANTIGRAVITY_CLIENT_PROFILE;
  delete process.env.STYX_ANTIGRAVITY_CLIENT_PROFILE;
  const providerSpecificData = { clientProfile: stored };
  const profile = getAntigravityClientProfile({ providerSpecificData });
  const accessToken = `fixture-profile-${stored}-${crypto.randomUUID()}`;
  const calls: Array<{ url: string; headers: Headers; body: any }> = [];
  globalThis.fetch = (async (url, init) => {
    const target = String(url);
    if (target.includes("auto-updater")) return Response.json([{ version: "1.0.0" }]);
    const body = JSON.parse(await new Response(init?.body as BodyInit).text());
    calls.push({ url: target, headers: new Headers(init?.headers), body });
    if (target.includes(":loadCodeAssist")) return Response.json({ cloudaicompanionProject: "fixture-project" });
    if (target.includes(":fetchAvailableModels")) return Response.json({ models: {} });
    if (target.includes(":retrieveUserQuota")) return Response.json({ buckets: [] });
    if (target.includes(":streamGenerateContent")) return new Response('data: {"response":{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}}\n\n', { headers: { "content-type": "text/event-stream" } });
    if (target.includes("Quota")) return Response.json({});
    throw new Error(`Unexpected fixture request: ${target}`);
  }) as typeof fetch;
  try {
    expect(await ensureAntigravityProjectAssigned(accessToken, globalThis.fetch, profile)).toBe("fixture-project");
    await getAntigravityUsage("antigravity", accessToken, providerSpecificData, "fixture-project", undefined, { forceRefresh: true });
    const result = await new AntigravityExecutor().execute({ model: "gemini-3-flash", body: { contents: [{ role: "user", parts: [{ text: "hi" }] }] }, stream: true, credentials: { accessToken, projectId: "fixture-project", providerSpecificData } } as any);
    expect(result.response.status).toBe(200);
    await result.response.text();
    for (const suffix of [":loadCodeAssist", ":fetchAvailableModels", ":retrieveUserQuota", ":streamGenerateContent"]) expect(calls.some(c => c.url.includes(suffix))).toBe(true);
    for (const call of calls) expect(call.headers.get("user-agent")).toContain(`antigravity/${profile}/`);
    const dispatch = calls.filter(c => c.url.includes(":streamGenerateContent"));
    expect(dispatch).toHaveLength(1);
    expect(dispatch[0].body.model).toBe("gemini-3-flash");
    if (profile === "hub") {
      expect(dispatch[0].headers.has("x-goog-user-project")).toBe(false);
      expect(dispatch[0].body.requestType).toBeUndefined();
    } else {
      expect(dispatch[0].headers.get("x-goog-user-project")).toBe("fixture-project");
      expect(dispatch[0].body.requestType).toBe("agent");
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalProfile === undefined) delete process.env.STYX_ANTIGRAVITY_CLIENT_PROFILE;
    else process.env.STYX_ANTIGRAVITY_CLIENT_PROFILE = originalProfile;
  }
});
