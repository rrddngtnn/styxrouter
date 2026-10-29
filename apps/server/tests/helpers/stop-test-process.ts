import type { ChildProcess } from "node:child_process";

// Wait for the child to release its database before removing its sandbox.
export async function stopTestProcess(proc: ChildProcess | null): Promise<void> {
  if (!proc || proc.pid === undefined || proc.exitCode !== null || proc.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Test child did not exit after SIGKILL")), 5000);
    proc.once("exit", () => { clearTimeout(timer); resolve(); });
    proc.once("error", (error) => { clearTimeout(timer); reject(error); });
    proc.kill("SIGKILL");
  });
}
