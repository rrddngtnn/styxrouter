/**
 * Admin CRUD batch 2 contracts: provider nodes CRUD, audit-log reader, bulk
 * account import, account key rotation. Session-gated like every /api write.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PORT = 21196;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "admin2-contracts-password";
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

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "styx-admin2-"));
  proc = spawn(BUN, ["server/styx.ts"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: dataDir,
      STYX_TEST_MODE: "1",
      JWT_SECRET: "admin2-contracts-jwt-secret-0123456789abcd",
      API_KEY_SECRET: "admin2-contracts-api-key-secret-0123456",
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

const call = (method: string, path: string, body?: unknown, session = true) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: { ...(session ? { cookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("provider nodes", () => {
  test("list starts empty; create validates and rejects reserved prefixes", async () => {
    expect((await call("GET", "/api/provider-nodes")).status).toBe(200);

    const reserved = await call("POST", "/api/provider-nodes", {
      type: "openai-compatible",
      name: "x",
      prefix: "glm",
      apiType: "chat",
      baseUrl: "https://x.example/v1",
    });
    expect(reserved.status).toBe(400);

    const noApiType = await call("POST", "/api/provider-nodes", {
      type: "openai-compatible",
      name: "x",
      prefix: "bridge",
      baseUrl: "https://x.example/v1",
    });
    expect(noApiType.status).toBe(400);

    expect((await call("POST", "/api/provider-nodes", undefined, false)).status).toBe(401);
  });

  test("create → list → update → delete round-trip; delete of unknown is 404", async () => {
    const created = await call("POST", "/api/provider-nodes", {
      type: "openai-compatible",
      name: "Muse Test",
      prefix: "muse-test",
      apiType: "chat",
      baseUrl: "https://bridge.example/v1",
      chatPath: null,
      modelsPath: null,
      customHeaders: { "X-Bridge": "on" },
    });
    expect(created.status).toBe(201);
    const node = ((await created.json()) as any).node;
    expect(node.customHeaders).toEqual({ "X-Bridge": "on" });

    const listed: any = await (await call("GET", "/api/provider-nodes")).json();
    expect(listed.nodes.some((n: any) => n.id === node.id)).toBe(true);

    const updated = await call("PATCH", `/api/provider-nodes/${node.id}`, {
      name: "Muse Test 2",
      chatPath: null,
      modelsPath: null,
    });
    expect(updated.status).toBe(200);
    const updatedBody = (await updated.json()) as any;
    expect(updatedBody.node.name).toBe("Muse Test 2");
    // partial update keeps the stored custom headers
    expect(updatedBody.node.customHeaders).toEqual({ "X-Bridge": "on" });

    // Adding an API-key account directly against a custom provider node id copies
    // its routing metadata onto the connection.
    const nodeConn = await call("POST", "/api/connections", {
      provider: node.id,
      name: "Muse Bridge Key",
      apiKey: "sk-custom-node-key-111111",
    });
    expect(nodeConn.status).toBe(201);
    const nodeBulk = await call("POST", "/api/connections/bulk", {
      provider: node.id,
      lines: ["sk-custom-node-key-222222|Muse Bulk Key"],
    });
    expect(nodeBulk.status).toBe(201);

    expect((await call("DELETE", `/api/provider-nodes/${node.id}`)).status).toBe(200);
    expect((await call("DELETE", `/api/provider-nodes/${node.id}`)).status).toBe(404);
  });
});

describe("audit log", () => {
  test("reads entries the admin writes, with filters; needs the session", async () => {
    expect((await call("GET", "/api/audit-log", undefined, false)).status).toBe(401);
    // generate a known entry
    await call("POST", "/api/provider-nodes", {
      type: "openai-compatible",
      name: "Audit Probe",
      prefix: "audit-probe",
      apiType: "chat",
      baseUrl: "https://x.example/v1",
    });
    const res = await call("GET", "/api/audit-log?action=providerNode.create&limit=10");
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.total).toBeGreaterThan(0);
    expect(body.entries[0].action).toBe("providerNode.create");
  });
});

describe("bulk import + rotation", () => {
  test("bulk creates valid lines, skips bad ones; rotation swaps the key in place", async () => {
    const bulk = await call("POST", "/api/connections/bulk", {
      provider: "openai",
      lines: ["sk-bulk-test-111111", "sk-bulk-test-222222|second-account"],
    });
    expect(bulk.status).toBe(201);
    const body: any = await bulk.json();
    expect(body.created).toHaveLength(2);
    expect(body.created[1].name).toBe("second-account");

    const unknownProvider = await call("POST", "/api/connections/bulk", { provider: "nope", lines: ["x"] });
    expect(unknownProvider.status).toBe(400);

    const rotate = await call("POST", `/api/connections/${body.created[0].id}/rotate-key`, {
      apiKey: "sk-rotated-test-333333",
    });
    expect(rotate.status).toBe(200);
    expect((await call("POST", `/api/connections/${body.created[0].id}/rotate-key`, { apiKey: "short" })).status).toBe(400);
    expect((await call("POST", "/api/connections/nope/rotate-key", { apiKey: "sk-rotated-test-444444" })).status).toBe(404);
  });
});
