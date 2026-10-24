/**
 * A provider that rejects OUR upstream credentials (401/403 from its API) must not reach the client as
 * 401/403: clients read that as "your StyxRouter API key is wrong". It is a bad-gateway condition (502)
 * with a message that says whose credentials were rejected.
 */
import { describe, expect, test } from "bun:test";
import { handleNoCredentials } from "../src/sse/handlers/chatHelpers.ts";
import { isUpstreamAuthStatus, upstreamAuthFailureResponse } from "../open-sse/utils/error.ts";

const HTML_401 = '[401]: <html>\r\n<head><title>401 Authorization Required</title></head>\r\n<body><center><h1>401 Authorization Required</h1></center></body></html>';
const body = async (r: Response) => (await r.json()) as any;

describe("upstreamAuthFailureResponse", () => {
  test("is a 502 that names the provider and says it is not the client's key", async () => {
    const r = upstreamAuthFailureResponse("codebuddy-intl", "deepseek-v4.1-flash", 401, HTML_401);
    expect(r.status).toBe(502);
    const b = await body(r);
    expect(b.error.code).toBe("UPSTREAM_AUTH_REJECTED");
    expect(b.error.message).toContain("codebuddy-intl/deepseek-v4.1-flash");
    expect(b.error.message).toContain("HTTP 401");
    expect(b.error.message).toMatch(/not a problem with your StyxRouter API key/i);
  });

  test("never relays raw HTML from the provider", async () => {
    const b = await body(upstreamAuthFailureResponse("p", "m", 401, HTML_401));
    expect(JSON.stringify(b)).not.toMatch(/<html|<head|<body|<center/i);
  });

  test("only 401 and 403 count as upstream auth failures", () => {
    expect([401, 403].every(isUpstreamAuthStatus)).toBe(true);
    expect([200, 400, 404, 429, 500, 502, 503].some(isUpstreamAuthStatus)).toBe(false);
  });
});

describe("handleNoCredentials after every account failed", () => {
  test("a last upstream 401 becomes 502", async () => {
    const r = handleNoCredentials({}, "conn-1", "codebuddy-intl", "m", HTML_401, 401);
    expect(r.status).toBe(502);
    expect((await body(r)).error.code).toBe("UPSTREAM_AUTH_REJECTED");
  });

  test("a last upstream 403 becomes 502", async () => {
    const r = handleNoCredentials({}, "conn-1", "codebuddy-intl", "m", '[403]: {"code":11140,"msg":"request illegal"}', 403);
    expect(r.status).toBe(502);
    expect((await body(r)).error.message).toContain("HTTP 403");
  });

  test("other upstream statuses keep their meaning", () => {
    expect(handleNoCredentials({}, "conn-1", "p", "m", "[429]: slow down", 429).status).toBe(429);
    expect(handleNoCredentials({}, "conn-1", "p", "m", "[500]: boom", 500).status).toBe(500);
  });

  test("all accounts expired is 502, not a 401 about the client's key", async () => {
    const r = handleNoCredentials({ allExpired: true, expiredStatus: "expired", expiredCount: 2 }, null, "p", "m", null, null);
    expect(r.status).toBe(502);
    const b = await body(r);
    expect(b.error.message).toMatch(/reconnect/i);
    expect(b.error.message).toMatch(/not a problem with your StyxRouter API key/i);
  });

  test("all accounts rate limited with an upstream 403 is 502 too", () => {
    const r = handleNoCredentials({ allRateLimited: true, lastError: "restricted", lastErrorCode: 403, retryAfter: null }, "c", "p", "m", "restricted", 403);
    expect(r.status).toBe(502);
  });
});
