import { expect, test } from "bun:test";
import { join } from "node:path";

const workerFile = join(import.meta.dir, "helpers", "routing-trace-scope-worker.ts");
type Worker = { child: ReturnType<typeof Bun.spawn>; port: number; token: string };

async function startWorker(): Promise<Worker> {
  const child = Bun.spawn([process.execPath, "--no-env-file", workerFile], { stdout: "pipe", stderr: "pipe", env: { ...process.env } });
  const reader = child.stdout.getReader();
  let output = "";
  try {
    const ready = await Promise.race([
      (async () => {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) throw new Error(`worker exited before ready: ${output}`);
          output += new TextDecoder().decode(chunk.value);
          for (const line of output.split("\n")) {
            try { const parsed = JSON.parse(line); if (parsed.port && parsed.token) return parsed; } catch { /* startup logs */ }
          }
        }
      })(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`worker startup timeout: ${output}`)), 10000)),
    ]);
    return { child, ...ready };
  } catch (error) { child.kill(); await child.exited; throw error; }
  finally { reader.releaseLock(); }
}
async function stop(worker: Worker) { worker.child.kill(); await worker.child.exited; }
async function read(worker: Worker) {
  const url = `http://127.0.0.1:${worker.port}/api/routing/trace`;
  expect((await fetch(url)).status).toBe(401);
  const response = await fetch(url, { headers: { cookie: `auth_token=${worker.token}` } });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const text = await response.text();
  for (const secret of [worker.token, "synthetic-scope-api-key-secret", "synthetic-scope-jwt-secret", "synthetic-scope-password", "fixture-provider-secret", "fixture-account-secret"]) expect(text).not.toContain(secret);
  return JSON.parse(text);
}
async function record(worker: Worker) {
  const response = await fetch(`http://127.0.0.1:${worker.port}/fixture/record`, { method: "POST" });
  expect(response.status).toBe(200);
}

test("authenticated scope identifies each volatile worker across reads, events and restart", async () => {
  const workers: Worker[] = [];
  try {
    const a = await startWorker(); workers.push(a);
    const b = await startWorker(); workers.push(b);
    const a0 = await read(a); const b0 = await read(b);
    expect(a0.scope).toEqual({ storage: "process-local", retention: "volatile", maxEvents: 1000, instanceId: expect.stringMatching(/^[a-f0-9]{32}$/) });
    expect(b0.scope).toEqual({ ...a0.scope, instanceId: expect.stringMatching(/^[a-f0-9]{32}$/) });
    expect(a0.scope.instanceId).not.toBe(b0.scope.instanceId);
    expect(a0.events).toHaveLength(0); expect(b0.events).toHaveLength(0);
    await record(a);
    const a1 = await read(a); const b1 = await read(b);
    expect(a1.scope.instanceId).toBe(a0.scope.instanceId);
    expect(b1.scope.instanceId).toBe(b0.scope.instanceId);
    expect(a1.events).toHaveLength(1); expect(b1.events).toHaveLength(0);
    await record(a);
    const a2 = await read(a);
    expect(a2.scope.instanceId).toBe(a0.scope.instanceId);
    expect(a2.events).toHaveLength(2);
    await stop(a); workers.splice(workers.indexOf(a), 1);
    const restarted = await startWorker(); workers.push(restarted);
    const a3 = await read(restarted); const b2 = await read(b);
    expect(a3.scope.instanceId).not.toBe(a0.scope.instanceId);
    expect(a3.scope.instanceId).not.toBe(b0.scope.instanceId);
    expect(a3.events).toHaveLength(0);
    expect(b2.scope.instanceId).toBe(b0.scope.instanceId);
    expect(b2.events).toHaveLength(0);
    await record(restarted);
    const a4 = await read(restarted);
    expect(a4.scope.instanceId).toBe(a3.scope.instanceId);
    expect(a4.events).toHaveLength(1);
  } finally { for (const worker of workers) await stop(worker); }
}, 30000);
