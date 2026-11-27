import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuggieExecutor, __resetAuggieModels, checkAuggieCliVersion, resolveAuggieModel } from "../open-sse/executors/auggie.ts";
import { REGISTRY } from "../open-sse/config/providerRegistry.ts";
import { getExecutor } from "../open-sse/executors/index.ts";
import { resolveProviderAlias } from "../open-sse/services/model.ts";
import { getProviderCredentials } from "../src/sse/services/auth.ts";
import { NOAUTH_PROVIDERS } from "../src/shared/constants/providers/noauth.ts";
import { prepareTokenImport } from "../server/tokenImport.ts";

const root = mkdtempSync(join(tmpdir(), "auggie-fixture-"));
const bin = join(root, "auggie");
const calls = join(root, "calls.jsonl");
const children: number[] = [];
writeFileSync(bin, `#!${process.execPath}
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(calls)}, JSON.stringify({pid:process.pid,args})+'\\n');
if (args[0] === '--version') { console.log('0.32.0-fixture'); process.exit(0); }
if (args[0] === 'model') { console.log('[fixture-model] Synthetic model'); if (process.env.AUGGIE_FIXTURE_HOLD_DISCOVERY) await new Promise(() => setInterval(() => {}, 1000)); process.exit(0); }
const prompt = await new Response(Bun.stdin.stream()).text();
if (prompt.includes('fixture-error')) { console.error('fixture failure'); process.exit(7); }
process.stdout.write('fixture output');
if (prompt.includes('fixture-hold')) setInterval(() => {}, 1000);
`);
chmodSync(bin, 0o700);
process.env.AUGGIE_BIN = bin;

function invocations(): { pid: number; args: string[] }[] {
  try { return readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)); }
  catch { return []; }
}
async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!predicate() && Date.now() < deadline) await Bun.sleep(10);
  expect(predicate()).toBe(true);
}
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
afterEach(() => {
  for (const child of children.splice(0)) { try { process.kill(child, "SIGKILL"); } catch {} }
  __resetAuggieModels();
  writeFileSync(calls, "");
});
process.on("exit", () => rmSync(root, { recursive: true, force: true }));

function input(text: string, stream = true, signal?: AbortSignal) {
  return { model: "sonnet4.6", body: { messages: [{ role: "user", content: text }] }, stream, signal, credentials: {} };
}

test("existing registry, CLI onboarding and factory reach discovered-model subprocess dispatch", async () => {
  expect(REGISTRY.auggie).toMatchObject({ id: "auggie", alias: "aug", authType: "none", executor: "auggie" });
  expect(NOAUTH_PROVIDERS.auggie).toMatchObject({ noAuth: true, isLocalCli: true, hasFree: false });
  expect(await checkAuggieCliVersion()).toEqual({ ok: true, version: "0.32.0-fixture" });
  const imported = prepareTokenImport({ provider: "auggie", accounts: { access_token: "synthetic-secret" } })![0].view;
  expect(imported.valid).toBe(false);
  expect(JSON.stringify(imported)).not.toContain("synthetic-secret");
  expect(resolveProviderAlias("aug")).toBe("auggie");
  const credentials = await getProviderCredentials("auggie");
  expect(credentials).toMatchObject({ authType: "none", connectionId: "noauth", accessToken: null });
  const executor = getExecutor(resolveProviderAlias("aug"));
  expect(executor).toBeInstanceOf(AuggieExecutor);
  const result = await executor.execute({ ...input("fixture-normal", false), credentials, model: "fixture-model" });
  expect(result.response.status).toBe(200);
  expect(await result.response.json()).toMatchObject({ model: "fixture-model", choices: [{ message: { content: "fixture output" } }] });
  expect(invocations().map(call => call.args)).toEqual([
    ["--version"], ["model", "list"], ["--print", "--quiet", "--model", "fixture-model", "--"],
  ]);
  expect(resolveAuggieModel("--help").ok).toBe(false);
});

test("streaming relays synthetic output and a terminal stop", async () => {
  const { response } = await getExecutor("auggie").execute(input("fixture-normal"));
  const text = await response.text();
  expect(text).toContain("fixture output");
  expect(text).toContain('"finish_reason":"stop"');
  expect(text).toContain("[DONE]");
});

test("CLI failures remain errors in both streaming and nonstreaming paths", async () => {
  const { response } = await getExecutor("auggie").execute(input("fixture-error", false));
  expect(response.status).toBe(502);
  expect(await response.text()).toContain("code 7");
  const streamed = await getExecutor("auggie").execute(input("fixture-error"));
  const text = await streamed.response.text();
  expect(text).toContain("code 7");
  expect(text).not.toContain('"finish_reason":"stop"');
});

test("missing CLI is explicitly unavailable, not a successful connection or completion", async () => {
  process.env.AUGGIE_BIN = join(root, "missing-binary");
  try {
    expect(await checkAuggieCliVersion()).toMatchObject({ ok: false, error: expect.stringContaining("not found") });
    const { response } = await getExecutor("auggie").execute(input("fixture-normal", false));
    expect(response.status).toBe(502);
    expect(await response.text()).toContain("AUGGIE_BIN");
  } finally { process.env.AUGGIE_BIN = bin; }
});

test("an abort observed immediately after discovery spawn still terminates that child", async () => {
  const { initAuggieModels } = await import("../open-sse/executors/auggie.ts");
  let reads = 0;
  const signal = { get aborted() { if (++reads > 1) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100); return true; } return false; } } as AbortSignal;
  process.env.AUGGIE_FIXTURE_HOLD_DISCOVERY = '1';
  try { await initAuggieModels(signal); } finally { delete process.env.AUGGIE_FIXTURE_HOLD_DISCOVERY; }
  await Bun.sleep(100);
  // A racing abort may start discovery, but cannot leave its child alive.
  expect(invocations().length).toBeGreaterThan(0);
  for (const call of invocations()) { children.push(call.pid); expect(alive(call.pid)).toBe(false); }
});

test("stream completion and reader cancellation release request abort listeners", async () => {
  const { getEventListeners } = await import('node:events');
  const controller = new AbortController();
  const complete = await new AuggieExecutor().execute(input('fixture-normal', true, controller.signal));
  await complete.response.text();
  await waitFor(() => getEventListeners(controller.signal, 'abort').length === 0);
  const holding = await new AuggieExecutor().execute(input('fixture-hold', true, controller.signal));
  const reader = holding.response.body!.getReader(); await reader.read();
  const pid = invocations().filter(call => call.args[0] === '--print').at(-1)!.pid; children.push(pid);
  await reader.cancel();
  await waitFor(() => !alive(pid) && getEventListeners(controller.signal, 'abort').length === 0);
});

test("an already-aborted request never starts discovery or generation", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await new AuggieExecutor().execute(input("fixture-normal", false, controller.signal));
  await Bun.sleep(50);
  expect(invocations()).toEqual([]);
  expect(result.response.status).toBe(502);
  expect(await result.response.text()).toContain("aborted");
});

test("cancelling the response reader terminates the local CLI without requiring an abort signal", async () => {
  const result = await new AuggieExecutor().execute(input("fixture-hold"));
  const reader = result.response.body!.getReader();
  await reader.read();
  const pid = invocations().find(call => call.args[0] === "--print")!.pid;
  children.push(pid);
  await reader.cancel();
  await waitFor(() => !alive(pid));
});
