import { test, expect } from "bun:test";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";

 test("authenticated bulk rename applies a pattern per account and reports missing entries", async () => {
  const { proc, base } = await startTestServer(process.execPath, { cwd: `${import.meta.dir}/..`, env: { ...process.env, STYX_TEST_MODE: "1", JWT_SECRET: "fixture-jwt-secret-01234567890123456789", INITIAL_PASSWORD: "fixture-password", STORAGE_ENCRYPTION_KEY: "fixture-encryption-key" } });
  try {
    const login = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({password:"fixture-password"}) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const post = (path: string, body: unknown) => fetch(base + path, {method:"POST",headers:{cookie,"content-type":"application/json"},body:JSON.stringify(body)});
    const created = await post("/api/connections", { provider:"openai", name:"Original", apiKey:"synthetic-rename-key" });
    expect(created.status).toBe(201);
    const {id} = await created.json() as any;
    const r = await post("/api/connections/bulk-rename", { ids:[id,"missing-account"], pattern:"Team {name} {index}" });
    expect(r.status).toBe(200);
    const body:any = await r.json();
    expect(body.results).toEqual([{id, success:true, name:"Team Original 1"}, {id:"missing-account", success:false, error:"Connection not found"}]);
    const listed:any = await (await fetch(base + "/api/connections", {headers:{cookie}})).json();
    expect(listed.connections.find((x:any) => x.id === id).name).toBe("Team Original 1");
  } finally { await stopTestProcess(proc); }
}, 60000);
