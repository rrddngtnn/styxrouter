import { Hono } from "hono";
import { readRoutingTrace, routingTraceScope } from "../src/sse/services/routingDecisionTrace.ts";

// Mount only behind the management requireAuth middleware.
export function createRoutingTraceApi() {
  const api = new Hono();
  api.get("/", (c) => {
    c.header("Cache-Control", "no-store");
    return c.json({
      scope: routingTraceScope(),
      coverage: {
        upstreamHttp: "base-executor-fetch-only",
        upstreamHttpHeaders: "response-headers-not-final-outcome",
        routing429: "local-routing-decision-not-upstream-status",
        missingEvents: "not-evidence-of-no-upstream-request",
      },
      events: readRoutingTrace(),
    });
  });
  return api;
}
