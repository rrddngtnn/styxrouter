/**
 * Database backups: a manual "back up now", a listing, and pruning of the scheduled ones only. Files the operator made
 * by other means (or earlier tools) are never touched by the pruning.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PORT = 21199;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "backups-password-123";
const BUN = `${process.env.HOME}/.bun/bin/bun`;

describe("pruneScheduled / listBackups (pure file logic)", () => {
  const dir = mkdtempSync(join(tmpdir(), "styx-bk-unit-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const make = (name: string, ageMinutes: number) => {
    const f = join(dir, name);
    writeFileSync(f, "x".repeat(10));
    const t = new Date(Date.now() - ageMinutes * 60_000);
    utimesSync(f, t, t);
  };

  test("keeps the newest N scheduled backups and leaves every other file alone", async () => {
    const { pruneScheduled, listBackups } = await import("../server/backups.ts");
    make("db_2026-01-01T00-00-00-000Z_scheduled.sqlite", 50);
    make("db_2026-01-02T00-00-00-000Z_scheduled.sqlite", 40);
    make("db_2026-01-03T00-00-00-000Z_scheduled.sqlite", 30);
    make("db_2026-01-04T00-00-00-000Z_scheduled.sqlite", 20);
    make("db_2025-12-01T00-00-00-000Z_pre-write.sqlite", 9000);
    make("db_2025-12-02T00-00-00-000Z_manual.sqlite", 8000);
    make("notes.txt", 7000);
    const removed = pruneScheduled(dir, 2);
    expect(removed.sort()).toEqual(["db_2026-01-01T00-00-00-000Z_scheduled.sqlite", "db_2026-01-02T00-00-00-000Z_scheduled.sqlite"]);
    const names = listBackups(dir).map((b) => b.filename);
    expect(names).toEqual([
      "db_2026-01-04T00-00-00-000Z_scheduled.sqlite",
      "db_2026-01-03T00-00-00-000Z_scheduled.sqlite",
      "db_2025-12-02T00-00-00-000Z_manual.sqlite",
      "db_2025-12-01T00-00-00-000Z_pre-write.sqlite",
    ]);
    expect(listBackups(dir)[0].reason).toBe("scheduled");
    expect(existsSync(join(dir, "notes.txt"))).toBe(true);
  });
});

describe("/api/backups", () => {
  let proc: ReturnType<typeof spawn> | null = null;
  let dataDir = "";
  let cookie = "";
  const call = (method: string, path: string, session = true) =>
    fetch(`${BASE}${path}`, { method, headers: session ? { cookie } : {} });

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "styx-bk-"));
    proc = spawn(BUN, ["server/styx.ts"], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(PORT),
        DATA_DIR: dataDir,
        STYX_TEST_MODE: "1",
        STYX_BACKUP_MIN_FREE_MB: "0", // the test tmpfs is small; the guard itself is not what is under test
        JWT_SECRET: "backups-jwt-secret-0123456789abcdef0123456",
        API_KEY_SECRET: "backups-api-key-secret-0123456789abcdef0",
        INITIAL_PASSWORD: PASSWORD,
      },
      stdout: "ignore",
      stderr: "ignore",
    });
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      try {
        if ((await fetch(`${BASE}/api/health`)).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
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

  test("needs the session", async () => {
    expect((await call("GET", "/api/backups", false)).status).toBe(401);
    expect((await call("POST", "/api/backups", false)).status).toBe(401);
  });

  test("back up now writes a readable snapshot that then shows up in the list", async () => {
    const made = await call("POST", "/api/backups");
    expect(made.status).toBe(201);
    const body: any = await made.json();
    expect(body.filename).toMatch(/^db_.*_manual\.sqlite$/);
    const file = join(dataDir, "db_backups", body.filename);
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).mode & 0o077).toBe(0); // owner-only
    const list: any = await (await call("GET", "/api/backups")).json();
    expect(list.backups.some((b: any) => b.filename === body.filename && b.reason === "manual" && b.size > 0)).toBe(true);
  });
});
