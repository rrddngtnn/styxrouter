/**
 * Start Plan (ZCode billing plane) usage fetcher contract.
 *
 * The legacy getGlmUsage answers "API key not available" for every OAuth
 * start-plan connection (they carry no composite coding key). The dispatcher in
 * usage.ts must route planFamily "start" connections to the ZCode billing
 * balance endpoint and keep the coding-plan path for keys that exist.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "glm-start-usage-"));
process.env.DATA_DIR = dir;
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("getGlmUsageWithStartPlan", () => {
  test("routes a start-plan connection to the ZCode billing plane", async () => {
    const { getGlmUsageWithStartPlan } = await import("../open-sse/services/usage/glmStartPlan.ts");
    const { getGlmUsage } = await import("../open-sse/services/usage/glm.ts");

    let legacyCalled = false;
    const origFetch = globalThis.fetch;
    const fake = async (input: any, init?: any) => {
      const url = String(input);
      if (url.includes("zcode-plan/billing/balance")) {
        expect(init?.headers?.Authorization).toMatch(/^Bearer /);
        expect(init?.headers?.["X-Device-Mid"]).toBeTruthy();
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              plans: [{ user_plan_id: "up1", plan_id: "p1", status: "active" }],
              balances: [
                {
                  show_name: "GLM-5.3",
                  user_plan_id: "up1",
                  plan_id: "p1",
                  total_units: 200,
                  used_units: 50,
                  remaining_units: 150,
                  expires_at: 1790000000,
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      legacyCalled = true;
      return new Response("{}", { status: 200 });
    };
    globalThis.fetch = fake as any;
    try {
      const usage: any = await getGlmUsageWithStartPlan(undefined, {
        planFamily: "start",
        zcodeJwtToken: "fixture-jwt",
      });
      expect(legacyCalled).toBe(false);
      expect(usage.plan).toBe("Start Plan");
      const quota = usage.quotas["GLM-5.3"];
      expect(quota).toMatchObject({ used: 50, total: 200, remaining: 150 });
      expect(quota.remainingPercentage).toBe(75);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("falls back to the coding-plan fetcher when an apiKey exists", async () => {
    const { getGlmUsageWithStartPlan } = await import("../open-sse/services/usage/glmStartPlan.ts");
    const origFetch = globalThis.fetch;
    let codingQuotaHit = false;
    globalThis.fetch = (async (input: any) => {
      if (String(input).includes("monitor/usage/quota/limit")) {
        codingQuotaHit = true;
        return new Response(JSON.stringify({ success: true, data: { limits: [] } }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as any;
    try {
      await getGlmUsageWithStartPlan("id.secret-key", { planFamily: "coding" });
      expect(codingQuotaHit).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("reports a readable message when the billing call fails", async () => {
    const { getGlmUsageWithStartPlan } = await import("../open-sse/services/usage/glmStartPlan.ts");
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("{}", { status: 503 })) as any;
    try {
      const usage: any = await getGlmUsageWithStartPlan(undefined, {
        planFamily: "start",
        zcodeJwtToken: "fixture-jwt",
      });
      expect(String(usage.message)).toMatch(/Start Plan usage unavailable/);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
