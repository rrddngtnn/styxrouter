import { expect, test } from "bun:test";
test("watchdog-only wrapper preserves bytes, finalizes once, never retries", async () => {
  const { wrapStreamWithWatchdog } = await import("../open-sse/services/watchdogStream.ts");
  let finalized = 0;
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode("data: hello\n\n")); c.close(); } });
  expect(await new Response(wrapStreamWithWatchdog(stream, () => finalized++)).text()).toBe("data: hello\n\n");
  expect(finalized).toBe(1);
});
test("watchdog-only wrapper cancels slow upstream and finalizes", async () => {
  const { wrapStreamWithWatchdog } = await import("../open-sse/services/watchdogStream.ts");
  let now = 0, finalized = 0, cancelled = 0;
  const stream = new ReadableStream<Uint8Array>({ pull(c) { now += 10; c.enqueue(new TextEncoder().encode(": heartbeat\n\n")); }, cancel() { cancelled++; } }, { highWaterMark: 0 });
  const wrapped = wrapStreamWithWatchdog(stream, () => finalized++, { enabled: true, warmupMs: 0, windowMs: 1, minUsefulBytesPerSecond: 1, now: () => now });
  await expect(new Response(wrapped).text()).rejects.toThrow("throughput");
  expect(cancelled).toBe(1);
  expect(finalized).toBe(1);
});
