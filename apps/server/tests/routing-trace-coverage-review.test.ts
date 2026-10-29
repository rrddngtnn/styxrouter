import { expect, test } from "bun:test";
import { createRoutingTraceApi } from "../server/routingTrace.ts";

test("trace API discloses partial header-only provenance and local routing decisions", async () => {
  const response = await createRoutingTraceApi().request("/");
  const body = await response.json() as any;
  expect(body.coverage).toEqual({
    upstreamHttp: "base-executor-fetch-only",
    upstreamHttpHeaders: "response-headers-not-final-outcome",
    routing429: "local-routing-decision-not-upstream-status",
    missingEvents: "not-evidence-of-no-upstream-request",
  });
});
