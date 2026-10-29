import { afterAll, beforeAll, expect, test } from "bun:test";
import { startTestServer } from "./helpers/start-test-server";
import { createProviderConnection } from "../src/lib/db/providers";
import { addCustomModel, replaceSyncedAvailableModelsForConnection } from "../src/lib/db/models";

const password = "overlay-test-password-123";
const servers: {proc: any; base: string; cookie: string}[] = [];
const id = "legacy-overlay-truth-fixture";
async function call(server: typeof servers[number], method: string, path: string, body?: unknown) {
  return fetch(server.base + path, { method, headers: { cookie: server.cookie, ...(body ? {"content-type": "application/json"} : {}) }, ...(body ? {body: JSON.stringify(body)} : {}) });
}
beforeAll(async () => {
  const connection = await createProviderConnection({ provider: "claude", authType: "apikey", apiKey: "synthetic", name: "fixture", isActive: true } as any);
  await addCustomModel("claude", id, "Legacy manual", "manual", "embeddings", ["embeddings"], undefined, {}, true);
  await replaceSyncedAvailableModelsForConnection("claude", connection.id, [{ id, name: "Synced authority", supportedThinkingEfforts: ["low", "high"] }]);
  for (let i = 0; i < 2; i++) {
    const started = await startTestServer(process.execPath, { cwd: new URL("..", import.meta.url).pathname, env: { ...process.env, STYX_TEST_MODE: "1", JWT_SECRET: "overlay-test-jwt-secret-0123456789", API_KEY_SECRET: "overlay-test-key-secret-0123456789", INITIAL_PASSWORD: password } });
    const login = await fetch(started.base + "/api/auth/login", { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({password}) });
    expect(login.status).toBe(200);
    servers.push({ ...started, cookie: (login.headers.get("set-cookie") || "").split(";")[0] });
  }
}, 60000);
afterAll(async () => { for (const {proc} of servers) if (proc.exitCode === null) { const done = new Promise(resolve => proc.once("exit", resolve)); proc.kill("SIGKILL"); await done; } });
test("legacy manual shadow is visible without implying synced authority is editable", async () => {
  for (const server of servers) {
    const list = await call(server, "GET", "/api/providers/claude/models");
    expect(list.status).toBe(200);
    const row = ((await list.json()) as any).models.find((m: any) => m.id === id);
    expect(row).toMatchObject({ origin: "synced", name: "Synced authority", manualOverlay: { name: "Legacy manual", apiFormat: "embeddings", supportsVision: true } });
    expect((await call(server, "PATCH", `/api/providers/claude/models/${id}`, {name:"Changed"})).status).toBe(409);
    expect((await call(server, "DELETE", `/api/providers/claude/models/${id}`)).status).toBe(409);
    const catalog = await call(server, "GET", "/v1/models?prefix=canonical");
    const publicRow = ((await catalog.json()) as any).data.find((m: any) => m.id === `claude/${id}`);
    expect(publicRow).toMatchObject({ custom: true, type: "embedding", capabilities: { vision: true, effort_tiers: ["low", "high"] } });
  }
}, 60000);
