import { expect, test } from "bun:test";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";

test("bulk UI endpoint contracts over isolated local HTTP return per-entry partial results without credentials", async () => {
  const { proc, base } = await startTestServer(process.execPath, { cwd: `${import.meta.dir}/..`, env: { ...process.env, STYX_TEST_MODE: "1", JWT_SECRET: "fixture-jwt-secret-01234567890123456789", INITIAL_PASSWORD: "fixture-password", STORAGE_ENCRYPTION_KEY: "fixture-encryption-key" } });
  try {
    const post = (path: string, body: unknown, cookie = "") => fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? {cookie} : {}) }, body: JSON.stringify(body) });
    const login = await post("/api/auth/login", {password:"fixture-password"});
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const secret = "fixture-provider-secret-unique-78219";
    const created = await post("/api/connections", {provider:"openai",name:"First",apiKey:secret},cookie);
    expect(created.status).toBe(201);
    const { id } = await created.json() as {id:string};
    for (const [path, payload] of [
      ["bulk-rename", {ids:[id,"missing-id"],pattern:"Team {name} {index}"}],
      ["bulk-tags", {ids:[id,"missing-id"],operation:"add",tags:["@team"]}],
      ["bulk-release-cooldown", {ids:[id,"missing-id"]}],
    ] as const) {
      const response = await post(`/api/connections/${path}`,payload,cookie);
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).not.toContain(secret);
      const {results} = JSON.parse(text);
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({id,success:true});
      expect(results[1]).toMatchObject({id:"missing-id",success:false,error:"Connection not found"});
    }
    const listing = await fetch(base + "/api/connections", {headers:{cookie}});
    const text = await listing.text();
    expect(text).not.toContain(secret);
    expect(text).toContain("Team First 1");
    expect(text).toContain("@team");
  } finally { await stopTestProcess(proc); }
}, 60000);
