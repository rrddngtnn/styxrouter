#!/usr/bin/env python3
"""Smoke a built image without host ports, mounts, credentials or outbound networking."""
import hashlib
import json
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]


def run(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)


def probe_script():
    notices = {
        "/app/LICENSE": ROOT / "LICENSE",
        "/app/CREDITS.md": ROOT / "CREDITS.md",
        "/app/apps/server/LICENSE": ROOT / "apps/server/LICENSE",
        "/app/apps/server/panel/brand/LICENSE-NOTICE.txt": ROOT / "apps/panel/public/brand/LICENSE-NOTICE.txt",
        "/app/apps/server/panel/brand/STYXROUTER-BRAND-KIT-NOTICE.txt": ROOT / "apps/panel/public/brand/STYXROUTER-BRAND-KIT-NOTICE.txt",
        "/app/notices/provider-icon-NOTICE.md": ROOT / "apps/panel/src/components/provider-icon-NOTICE.md",
    }
    # Verify every packaged approved brand byte, not only the two license notices.
    for path in (ROOT / "apps/panel/public/brand").iterdir():
        if path.is_file():
            notices["/app/apps/server/panel/brand/" + path.name] = path
    notices["/app/apps/server/panel/favicon.ico"] = ROOT / "apps/panel/public/favicon.ico"
    for path in (ROOT / "apps/server/licenses").rglob("*"):
        if path.is_file():
            notices["/app/apps/server/licenses/" + path.relative_to(ROOT / "apps/server/licenses").as_posix()] = path
    hashes = {path: hashlib.sha256(source.read_bytes()).hexdigest() for path, source in notices.items()}
    return "const notices = " + json.dumps(hashes) + ";\n" + r'''
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
assert.notEqual(process.getuid(), 0, "runtime must not be root");
for (const [path, expected] of Object.entries(notices)) {
  assert.equal(createHash("sha256").update(readFileSync(path)).digest("hex"), expected, path);
}
const base = "http://127.0.0.1:20128";
async function request(path, options) {
  return fetch(base + path, { ...options, redirect: "manual", signal: AbortSignal.timeout(5000) });
}
const health = await request("/api/health");
assert.equal(health.status, 200);
assert.equal((await health.json()).ok, true);
const panel = await request("/panel/");
assert.equal(panel.status, 200);
const html = await panel.text();
assert.match(html, /<html/i);
const asset = html.match(/(?:src|href)="([^"]*\/assets\/[^"?]+\.js)"/);
assert.ok(asset, "built panel JavaScript asset must exist");
assert.equal((await request(new URL(asset[1], base + "/panel/").pathname)).status, 200);
for (const [path, options] of [
  ["/api/settings", {}],
  ["/api/keys", {}],
  ["/v1/models", {}],
  ["/v1/models", { headers: { authorization: "Bearer smoke-invalid-key" } }],
  ["/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({model: "smoke-no-upstream", messages: []}) }],
]) {
  const response = await request(path, options);
  assert.equal(response.status, 401, path);
  assert.equal((await response.json()).error.type, "authentication_error", path);
}
const login = await request("/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: process.env.INITIAL_PASSWORD }),
});
assert.equal(login.status, 200);
const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
assert.ok(cookie, "login must issue a management session");
const modelsWithSession = await request("/v1/models", { headers: { cookie } });
assert.equal(modelsWithSession.status, 200, "dashboard session may read model catalog without API key");
const modelsPayload = await modelsWithSession.json();
assert.ok(Array.isArray(modelsPayload.data), "model catalog must be an OpenAI-compatible list");
const chatWithSession = await request("/v1/chat/completions", {
  method: "POST",
  headers: { "content-type": "application/json", cookie },
  body: JSON.stringify({ model: "smoke-no-upstream", messages: [] }),
});
assert.equal(chatWithSession.status, 401, "dashboard session must not authorize inference");
assert.equal((await chatWithSession.json()).error.type, "authentication_error");
console.log("PASS: non-root, notices, health, built panel asset, no-key auth, session model catalog");
'''


def main(image):
    if shutil.which("docker") is None:
        raise SystemExit("Docker CLI/daemon required: no image smoke was executed")
    labels = run("docker", "image", "inspect", "--format", "{{json .Config.Labels}}", image, capture_output=True)
    try:
        metadata = json.loads(labels.stdout)
        if metadata.get("org.opencontainers.image.title") != "StyxRouter" or not metadata.get("org.opencontainers.image.version"):
            raise ValueError("missing release identity")
    except (TypeError, ValueError, AttributeError) as exc:
        raise RuntimeError("image labels must identify StyxRouter and its application version") from exc
    name = "styx-smoke-" + secrets.token_hex(8)
    env = {key: secrets.token_hex(32) for key in (
        "JWT_SECRET", "API_KEY_SECRET", "STORAGE_ENCRYPTION_KEY", "INITIAL_PASSWORD")}
    # No inherited env, no production volume, and no outbound route even if a
    # startup task attempts a probe. /data is fresh RAM and removed on cleanup.
    args = ["docker", "run", "--detach", "--name", name, "--network", "none",
            "--read-only", "--tmpfs", "/data:rw,nosuid,nodev,mode=1777",
            "--tmpfs", "/scratch:rw,nosuid,nodev,mode=1777", "--env", "TMPDIR=/scratch",
            "--env", "STYX_DISABLE_TOKEN_HEALTHCHECK=1", "--env", "STYX_BROWSER_POOL=off",
            "--health-interval", "2s", "--health-start-period", "5s",
            "--health-timeout", "5s", "--health-retries", "30"]
    for key, value in env.items():
        args += ["--env", f"{key}={value}"]
    try:
        run(*args, image, stdout=subprocess.DEVNULL)
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            result = run("docker", "inspect", "--format", "{{.State.Status}} {{.State.Health.Status}}", name, capture_output=True)
            status = result.stdout.strip()
            if status == "running healthy":
                break
            if not status.startswith("running ") or status.endswith(" unhealthy"):
                raise RuntimeError("container failed health: " + status)
            time.sleep(2)
        else:
            raise RuntimeError("container health timed out")
        run("docker", "exec", "-i", name, "bun", "run", "-", input=probe_script())
    finally:
        # Do not print application logs or inspect env: they may contain secrets.
        subprocess.run(["docker", "rm", "--force", "--volumes", name], stdout=subprocess.DEVNULL, check=False)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: docker-smoke.py IMAGE")
    main(sys.argv[1])
