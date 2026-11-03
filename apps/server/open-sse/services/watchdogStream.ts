/** Single-pass throughput enforcement. No holdback, terminal inference or replay. */
import { createThroughputWatchdog, ThroughputWatchdogError, type ThroughputWatchdogOptions } from "./throughputWatchdog.ts";

export function wrapStreamWithWatchdog(
  source: ReadableStream<Uint8Array>,
  finalize: () => void,
  options: ThroughputWatchdogOptions = {}
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  const watchdog = createThroughputWatchdog(options);
  let finished = false;
  const finish = () => { if (!finished) { finished = true; finalize(); } };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const item = await reader.read();
        if (finished) return;
        if (item.done) { finish(); controller.close(); return; }
        if (watchdog.observe(item.value).abort) {
          const error = new ThroughputWatchdogError();
          await reader.cancel(error).catch(() => {});
          throw error;
        }
        controller.enqueue(item.value);
      } catch (error) {
        if (!finished) { finish(); controller.error(error); }
      }
    },
    async cancel(reason) {
      finish();
      await reader.cancel(reason);
    },
  }, { highWaterMark: 0 });
}
