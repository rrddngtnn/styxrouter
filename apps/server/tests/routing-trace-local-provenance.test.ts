import { expect, test } from "bun:test";
import { CodeBuddyCnExecutor } from "../open-sse/executors/codebuddy-cn";
import { NineRouterExecutor } from "../open-sse/executors/ninerouter";
import { clearRoutingTrace, readRoutingTrace, withRoutingTraceRequest } from "../src/sse/services/routingDecisionTrace";

test("locally normalized 429 retains real upstream 200 provenance", async () => {
  clearRoutingTrace();
  const old = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response('{"code":6004,"msg":"private-upstream-body"}', { headers: { "content-type": "application/json" } })) as typeof fetch;
    const result: any = await withRoutingTraceRequest(() => new CodeBuddyCnExecutor().execute({ model: "fixture", body: { messages: [] }, stream: false, credentials: { accessToken: "private-token", connectionId: "private-account" } } as any));
    expect((result instanceof Response ? result : result.response).status).toBe(429);
    const events = readRoutingTrace();
    expect(events.filter(e => e.reason === "upstreamHttpError")).toEqual([]);
    expect(events.filter(e => e.reason === "upstreamHttpHeaders").map(e => e.status)).toEqual([200]);
    expect(JSON.stringify(events)).not.toContain("private-");
  } finally { globalThis.fetch = old; clearRoutingTrace(); }
});

test("locally generated unavailable 503 is not an upstream response", async () => {
  clearRoutingTrace();
  const old = globalThis.fetch;
  let fetches = 0;
  try {
    globalThis.fetch = (async () => { fetches++; throw new Error("unexpected fetch"); }) as typeof fetch;
    const result = await withRoutingTraceRequest(() => new NineRouterExecutor().execute({ model: "fixture", body: {}, stream: false, credentials: { connectionId: "private-account" } } as any));
    expect(result.response.status).toBe(503);
    expect(fetches).toBe(0);
    expect(readRoutingTrace().filter(e => e.reason.startsWith("upstreamHttp"))).toEqual([]);
  } finally { globalThis.fetch = old; clearRoutingTrace(); }
});
