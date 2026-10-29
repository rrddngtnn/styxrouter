import { expect, test, spyOn } from "bun:test";
import { clearPendingRequests, getPendingById, getPendingRequests, trackPendingRequest, finalizePendingRequestById } from "../src/lib/usage/usageHistory";

test("pending IDs distinguish UUIDs sharing a prefix in the same millisecond", () => {
  clearPendingRequests();
  const clock = spyOn(Date, "now").mockReturnValue(1700000000000);
  const uuid = spyOn(globalThis.crypto, "randomUUID")
    .mockReturnValueOnce("12345600-0000-4000-8000-000000000001")
    .mockReturnValueOnce("12345600-0000-4000-8000-000000000002");
  try {
    const first = trackPendingRequest("model", "provider", "account", true)!;
    const second = trackPendingRequest("model", "provider", "account", true)!;
    expect(first).not.toBe(second);
    expect(getPendingById().size).toBe(2);
    expect(finalizePendingRequestById(first, { status: 200 })).toBe(true);
    expect(finalizePendingRequestById(second, { status: 200 })).toBe(true);
    expect(getPendingById().size).toBe(0);
    expect(getPendingRequests().byModel["model (provider)"]).toBeUndefined();
  } finally { uuid.mockRestore(); clock.mockRestore(); clearPendingRequests(); }
});
