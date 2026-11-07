import { expect, test } from "bun:test";
import { runWithPanelProbeLogContext, isPanelProbeLogContext } from "../src/lib/panelProbeLogContext";
import { saveCallLog, getCallLogById } from "../src/lib/usage/callLogs";
import { logger, createLogger } from "../open-sse/utils/logger";

test("probe context suppresses call logs and structured console output, without affecting other requests", async () => {
  const sentinel = "UPSTREAM_PROBE_SENTINEL_9467";
  const captured: unknown[][] = [];
  const original = [console.log, console.warn, console.error];
  console.log = console.warn = console.error = (...args) => { captured.push(args); };
  try {
    expect(isPanelProbeLogContext()).toBe(false);
    await runWithPanelProbeLogContext(async () => {
      await Promise.resolve();
      expect(isPanelProbeLogContext()).toBe(true);
      logger("TEST").error(sentinel, { response: sentinel });
      createLogger("req").warn("TEST", sentinel, { error: sentinel });
      await saveCallLog({ id: "panel-probe-no-log-9467", status: 502, error: sentinel, responseBody: { sentinel }, pipelinePayloads: { providerResponse: { sentinel } } });
    });
    expect(isPanelProbeLogContext()).toBe(false);
    expect(await getCallLogById("panel-probe-no-log-9467")).toBeNull();
    expect(JSON.stringify(captured)).not.toContain(sentinel);
    logger("TEST").error("ordinary-log-control");
    expect(JSON.stringify(captured)).toContain("ordinary-log-control");
    await saveCallLog({ id: "ordinary-call-control-9467", status: 502, error: "ordinary-error-control" });
    expect(await getCallLogById("ordinary-call-control-9467")).not.toBeNull();
  } finally {
    [console.log, console.warn, console.error] = original;
  }
}, 60000);

test("probe context is isolated between overlapping async requests and restored on errors", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const probe = runWithPanelProbeLogContext(async () => {
    await gate;
    expect(isPanelProbeLogContext()).toBe(true);
    throw new Error("expected");
  });
  expect(isPanelProbeLogContext()).toBe(false);
  release();
  await expect(probe).rejects.toThrow("expected");
  expect(isPanelProbeLogContext()).toBe(false);
});
