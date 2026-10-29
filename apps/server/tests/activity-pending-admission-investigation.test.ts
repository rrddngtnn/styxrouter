import { expect, test } from "bun:test";
import { clearPendingRequests, getPendingById, getPendingRequests, sweepStalePendingRequests, trackPendingRequest, finalizePendingRequestById } from "../src/lib/usage/usageHistory";

test("pending cap is enforced only by sweeping, which evicts live requests", () => {
  clearPendingRequests();
  try {
    const ids: string[] = [];
    for (let i = 0; i < 5001; i++) ids.push(trackPendingRequest("model", "provider", "account", true)!);
    expect(getPendingById().size).toBe(5001);
    expect(getPendingRequests().byModel["model (provider)"]).toBe(5001);
    expect(sweepStalePendingRequests(Date.now(), 3_600_000)).toBe(1);
    expect(getPendingById().size).toBe(5000);
    expect(finalizePendingRequestById(ids[0], { status: 200 })).toBe(false);
    expect(getPendingRequests().byModel["model (provider)"]).toBe(5000);
  } finally { clearPendingRequests(); }
});
