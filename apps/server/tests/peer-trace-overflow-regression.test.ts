import { expect, test } from "bun:test";
import { inspectPeerRequest, STYX_PEER_TRACE_HEADER } from "../src/shared/resilience/peerRouting";

test("oversized peer trace cannot reset loop protection", () => {
  const headers = new Headers({ [STYX_PEER_TRACE_HEADER]: "other,".repeat(350) });
  const result = inspectPeerRequest(headers, { STYX_INSTANCE_ID: "local" });
  expect(result?.code).toBe("peer_hop_limit_exceeded");
});

test("valid peer traces retain loop detection and normal admission", () => {
  const env = { STYX_INSTANCE_ID: "local", STYX_PEER_MAX_HOPS: "4" };
  expect(inspectPeerRequest({ [STYX_PEER_TRACE_HEADER]: "a,local" }, env)?.code).toBe("peer_loop_detected");
  expect(inspectPeerRequest({ [STYX_PEER_TRACE_HEADER]: "a,b,c,d" }, env)?.code).toBe("peer_hop_limit_exceeded");
  expect(inspectPeerRequest({ [STYX_PEER_TRACE_HEADER]: "a,b" }, env)).toBeNull();
  expect(inspectPeerRequest({}, env)).toBeNull();
});
