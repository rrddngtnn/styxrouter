import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

import { fileURLToPath } from "node:url";
import { stopTestProcess } from "./stop-test-process";

// Read the actual bound port from our child before sending any request. Never
// probe a port selected by another process or use a reserve-and-release port.
export async function startTestServer(bun: string, options: SpawnOptions): Promise<{ proc: ChildProcess; base: string }> {
  const proc = spawn(bun, [fileURLToPath(new URL("./ephemeral-server.ts", import.meta.url))], {
    ...options, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let errors = "";
  proc.stderr!.on("data", (chunk) => { errors = (errors + chunk.toString()).slice(-4000); });
  try {
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Test server startup timed out: ${errors}`)), 30000);
      const fail = (error: Error) => { clearTimeout(timer); reject(error); };
      proc.once("error", fail);
      proc.once("exit", (code, signal) => fail(new Error(`Test server exited (${code ?? signal}): ${errors}`)));
      proc.stdout!.on("data", (chunk) => {
        output += chunk.toString();
        const match = output.match(/(?:^|\n)STYX_TEST_LISTENING:(\d+)\r?\n/);
        if (match) { clearTimeout(timer); resolve(Number(match[1])); }
        if (output.length > 65536) output = output.slice(-4096);
      });
    });
    return { proc, base: `http://127.0.0.1:${port}` };
  } catch (error) {
    await stopTestProcess(proc);
    throw error;
  }
}
