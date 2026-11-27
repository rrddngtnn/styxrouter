import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { request } from "node:http";
import { Hono } from "hono";
import { servePanel } from "../server/panel";
import { join } from "node:path";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";

const root = join(import.meta.dir, "..");
const names = ["LICENSE-NOTICE.txt", "PROVENANCE.txt", "STYXROUTER-BRAND-KIT-NOTICE.txt"];
let base = "";
let proc: Awaited<ReturnType<typeof startTestServer>>["proc"];
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

let fixturePanel = false;
beforeAll(async () => {
  // CI runs server tests before the panel build. Supply an owned static fixture
  // only when dist is absent; never overwrite a developer's real build.
  const dist = join(root, "../panel/dist");
  if (!existsSync(dist)) {
    mkdirSync(dist);
    fixturePanel = true;
    cpSync(join(root, "../panel/public/brand"), join(dist, "brand"), { recursive: true });
    writeFileSync(join(dist, "index.html"), '<div id="root">synthetic panel shell</div>');
  }
  ({ proc, base } = await startTestServer(process.execPath, {
    cwd: root,
    env: { ...process.env, STYX_TEST_MODE: "1", STYX_DISABLE_TOKEN_HEALTHCHECK: "1" },
  }));
}, 40000);
afterAll(async () => {
  if (proc) await stopTestProcess(proc);
  if (fixturePanel) rmSync(join(root, "../panel/dist"), { recursive: true, force: true });
});

// Send the raw request-target: fetch/URL normalize literal dot segments before transmission.
function rawGet(path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(base, { path }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

for (const path of [
  "/panel/brand/MISSING-NOTICE.txt", "/panel/brand/provenance.txt",
  "/panel/brand/LICENSE-NOTICE.txt/extra", "/panel/other.txt", "/panel/.env",
  "/panel/brand/.env", "/panel/data.sqlite", "/panel/data.sqlite3", "/panel/data.db",
  "/panel/brand/%2e%2e%2f.env", "/panel/brand/%252e%252e%252f.env",
  "/panel/brand/%2fetc%2fpasswd", "/panel/brand/%5c..%5c.env",
  "/panel/brand/PROVENANCE.txt%00", "/panel/brand/%ZZ",
]) {
  test(`unsafe or unknown panel asset stays 404: ${path}`, async () => {
    const result = await rawGet(path);
    expect(result.status).toBe(404);
    expect(result.body).not.toContain('id="root"');
  });
}

for (const path of ["/api/settings", "/api/brand/PROVENANCE.txt", "/api/missing.txt", "/v1/models", "/v1/missing.txt"]) {
  test(`legal assets do not bypass auth: ${path}`, async () => {
    expect((await fetch(`${base}${path}`)).status).toBe(401);
  });
}

for (const path of ["/panel/", "/panel/login", "/panel/keys", "/panel/providers/example.com"]) {
  test(`normal SPA navigation remains HTML: ${path}`, async () => {
    const response = await fetch(`${base}${path}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain('id="root"');
  });
}

test("missing packaged allowlisted notice is 404, never the SPA", async () => {
  const dir = mkdtempSync(join(tmpdir(), "styx-panel-missing-"));
  mkdirSync(join(dir, "brand"));
  writeFileSync(join(dir, "index.html"), '<div id="root">fixture shell</div>');
  writeFileSync(join(dir, "brand", "unlisted.txt"), "private synthetic sentinel");
  const app = new Hono();
  app.use("/panel/*", servePanel(dir));
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
  try {
    for (const name of [...names, "unlisted.txt"]) {
      const response = await fetch(`http://127.0.0.1:${server.port}/panel/brand/${name}`);
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain("fixture shell");
    }
  } finally {
    await server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const name of names) {
  test(`public GET /panel/brand/${name} is the exact packaged notice`, async () => {
    const response = await fetch(`${base}/panel/brand/${name}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const bytes = new Uint8Array(await response.arrayBuffer());
    const packaged = readFileSync(join(root, "panel/brand", name));
    expect(bytes).toEqual(new Uint8Array(packaged));
    expect(sha256(bytes)).toBe(sha256(readFileSync(join(root, "../panel/public/brand", name))));
    const head = await fetch(`${base}/panel/brand/${name}`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(head.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("cache-control")).toBe(head.headers.get("cache-control"));
    expect(await head.text()).toBe("");
  });
}
