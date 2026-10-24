/**
 * Admin write contract: API keys and combos have real server-side create / update / delete,
 * all behind the session (auth itself is covered by auth-contracts.test.ts).
 * Boots a REAL server on a throwaway DATA_DIR; nothing touches the operator DB.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PORT = 21196;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "admin-contracts-password";
const BUN = `${process.env.HOME}/.bun/bin/bun`;

let proc: ReturnType<typeof spawn> | null = null;
let dataDir = "";
let cookie = "";

async function waitReady() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("styx test boot timed out");
}

const api = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const models = (key: string) => fetch(`${BASE}/v1/models`, { headers: { authorization: `Bearer ${key}` } });

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "styx-admin-"));
  proc = spawn(BUN, ["server/styx.ts"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: dataDir,
      STYX_TEST_MODE: "1",
      JWT_SECRET: "admin-contracts-jwt-secret-0123456789abcdef",
      API_KEY_SECRET: "admin-contracts-api-key-secret-0123456789",
      INITIAL_PASSWORD: PASSWORD,
    },
    stdout: "ignore",
    stderr: "ignore",
  });
  await waitReady();
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
});

afterAll(() => {
  proc?.kill("SIGKILL");
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

describe("api keys", () => {
  let id = "";
  let key = "";

  test("create returns the full key once; the list shows only a prefix", async () => {
    const r = await api("POST", "/api/keys", { name: "ci-key" });
    expect(r.status).toBe(201);
    const body: any = await r.json();
    id = body.id;
    key = body.key;
    expect(id).toBeTruthy();
    expect(key.length).toBeGreaterThan(20);
    const list: any = await (await api("GET", "/api/keys")).json();
    const row = list.keys.find((k: any) => k.id === id);
    expect(row?.name).toBe("ci-key");
    expect(JSON.stringify(list)).not.toContain(key);
  });

  test("the new key authenticates /v1", async () => {
    expect((await models(key)).status).toBe(200);
  });

  test("an empty name is 400", async () => {
    expect((await api("POST", "/api/keys", { name: "" })).status).toBe(400);
    expect((await api("POST", "/api/keys", {})).status).toBe(400);
  });

  test("regenerate returns a different key; the old one stops working", async () => {
    const r = await api("POST", `/api/keys/${id}/regenerate`);
    expect(r.status).toBe(200);
    const body: any = await r.json();
    expect(body.key).not.toBe(key);
    expect((await models(key)).status).toBe(401);
    expect((await models(body.key)).status).toBe(200);
    key = body.key;
  });

  test("revoke makes the key stop working and the list says so", async () => {
    const before: any = await (await api("GET", "/api/keys")).json();
    expect(before.keys.find((k: any) => k.id === id)?.isActive).toBe(true);
    expect((await api("POST", `/api/keys/${id}/revoke`)).status).toBe(200);
    expect((await models(key)).status).toBe(401);
    const after: any = await (await api("GET", "/api/keys")).json();
    expect(after.keys.find((k: any) => k.id === id)?.isActive).toBe(false);
  });

  test("delete removes it from the list; unknown ids are 404", async () => {
    expect((await api("DELETE", `/api/keys/${id}`)).status).toBe(200);
    const list: any = await (await api("GET", "/api/keys")).json();
    expect(list.keys.some((k: any) => k.id === id)).toBe(false);
    expect((await api("DELETE", `/api/keys/${id}`)).status).toBe(404);
    expect((await api("POST", "/api/keys/nope/revoke")).status).toBe(404);
    expect((await api("POST", "/api/keys/nope/regenerate")).status).toBe(404);
  });
});

describe("combos", () => {
  let a = "";
  let b = "";
  const combos = async () => ((await (await api("GET", "/api/routing/combos")).json()) as any).combos as any[];

  test("create, then it is listed", async () => {
    const r = await api("POST", "/api/routing/combos", { name: "combo-a", models: ["codex/gpt-5.6-sol-low"] });
    expect(r.status).toBe(201);
    a = ((await r.json()) as any).id;
    expect((await combos()).some((c) => c.id === a && c.name === "combo-a")).toBe(true);
  });

  test("a duplicate name is 400; a bad body is 400", async () => {
    expect((await api("POST", "/api/routing/combos", { name: "combo-a", models: ["x/y"] })).status).toBe(400);
    expect((await api("POST", "/api/routing/combos", { name: "combo-z", models: [] })).status).toBe(400);
    expect((await api("POST", "/api/routing/combos", {})).status).toBe(400);
  });

  test("update changes the combo; renaming onto another name is 400", async () => {
    b = ((await (await api("POST", "/api/routing/combos", { name: "combo-b", models: ["x/y"] })).json()) as any).id;
    const r = await api("PUT", `/api/routing/combos/${a}`, { description: "edited" });
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).description).toBe("edited");
    expect((await api("PUT", `/api/routing/combos/${a}`, { name: "combo-b" })).status).toBe(400);
    expect((await api("PUT", "/api/routing/combos/nope", { description: "x" })).status).toBe(404);
  });

  test("the list reports the step count and an enabled flag that follows isActive", async () => {
    const row = (await combos()).find((c) => c.id === a);
    expect(row).toMatchObject({ steps: 1, enabled: true });
    expect((await api("PUT", `/api/routing/combos/${a}`, { isActive: false })).status).toBe(200);
    expect((await combos()).find((c) => c.id === a)?.enabled).toBe(false);
    expect((await api("PUT", `/api/routing/combos/${a}`, { isActive: true })).status).toBe(200);
  });

  test("a combo that references itself is refused (cycle)", async () => {
    const r = await api("PUT", `/api/routing/combos/${b}`, { models: ["combo-b"] });
    expect(r.status).toBe(400);
  });

  test("reorder persists the new order", async () => {
    const r = await api("POST", "/api/routing/combos/reorder", { comboIds: [b, a] });
    expect(r.status).toBe(200);
    const order = (await combos()).map((c) => c.id).filter((id) => id === a || id === b);
    expect(order).toEqual([b, a]);
    expect((await api("POST", "/api/routing/combos/reorder", { comboIds: [] })).status).toBe(400);
  });

  test("delete removes it; unknown is 404", async () => {
    expect((await api("DELETE", `/api/routing/combos/${a}`)).status).toBe(200);
    expect((await combos()).some((c) => c.id === a)).toBe(false);
    expect((await api("DELETE", `/api/routing/combos/${a}`)).status).toBe(404);
    expect((await api("DELETE", `/api/routing/combos/${b}`)).status).toBe(200);
  });
});
