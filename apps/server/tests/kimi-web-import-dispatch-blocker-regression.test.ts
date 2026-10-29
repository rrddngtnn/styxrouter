import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";

const root = join(import.meta.dir, "..");
const dir = mkdtempSync(join(tmpdir(), "kimi-import-probe-"));
let proc: ReturnType<typeof spawn>, base = "", key = "", cookie = "", expiredId = "";
const calls: string[] = [];
let upstreamStatus = 403;
const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
  calls.push(request.headers.get("authorization") ?? "");
  return new Response("synthetic-secret-upstream", { status: upstreamStatus });
}});
const env = { ...process.env, DATA_DIR: dir, STYX_TEST_MODE: "1", MOCK_UPSTREAM_PORT: String(upstream.port), JWT_SECRET: "kimi-probe-jwt-secret-0123456789", API_KEY_SECRET: "kimi-probe-api-secret-0123456789", STORAGE_ENCRYPTION_KEY: "kimi-probe-encryption-key", INITIAL_PASSWORD: "kimi-probe-password" };
beforeAll(async () => {
  const made = spawnSync(process.execPath, ["-e", `const {createApiKey}=await import('./src/lib/db/apiKeys.ts'); const {createProviderConnection}=await import('./src/lib/db/providers.ts'); const {createCombo}=await import('./src/lib/db/combos.ts'); const key=(await createApiKey('test','test')).key; for (const token of ['synthetic-kimi-first','synthetic-kimi-second',...Array.from({length:10},(_,i)=>'synthetic-kimi-'+i)]) await createProviderConnection({provider:'kimi-web',authType:'oauth',name:token,accessToken:token,isActive:true,providerSpecificData:{importedToken:true,nonRefreshable:true}}); const expiredId=(await createProviderConnection({provider:'kimi-web',authType:'oauth',name:'expired',accessToken:'synthetic-expired',expiresAt:'1970-01-01T00:00:01.000Z',isActive:true,providerSpecificData:{importedToken:true,nonRefreshable:true}})).id; for (const strategy of ['priority','round-robin']) await createCombo({name:'kimi-'+strategy,strategy,models:['kimi-web/k3','kimi-web/k2d6']}); console.log(JSON.stringify({key,expiredId}));`], {cwd:root,env,encoding:"utf8"});
  expect(made.status).toBe(0); const fixture = JSON.parse(made.stdout.trim().split("\n").pop()!); key = fixture.key; expiredId = fixture.expiredId;
  const helper = join(dir, "server.ts");
  writeFileSync(helper, `const orig=globalThis.fetch; globalThis.fetch=((input,init)=>{const u=new URL(input instanceof Request?input.url:String(input)); if(u.hostname==='www.kimi.ai') return orig('http://127.0.0.1:'+process.env.MOCK_UPSTREAM_PORT+u.pathname,init); if(u.hostname==='127.0.0.1'||u.hostname==='localhost') return orig(input,init); throw new Error('external network blocked');}); const {default:config}=await import(${JSON.stringify(join(root,"server/styx.ts"))}); const s=Bun.serve({...config,hostname:'127.0.0.1',port:0}); console.log('LISTEN:'+s.port);`);
  proc=spawn(process.execPath,[helper],{cwd:root,env,stdio:["ignore","pipe","pipe"]});
  let out="", err=""; proc.stderr!.on("data",c=>err+=c);
  const port=await new Promise<string>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(err)),30000);proc.once("exit",()=>reject(new Error(err)));proc.stdout!.on("data",c=>{out+=c;const m=out.match(/LISTEN:(\d+)/);if(m){clearTimeout(timer);resolve(m[1]);}})});
  base=`http://127.0.0.1:${port}`;
  const login=await fetch(base+"/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({password:"kimi-probe-password"})});
  cookie=(login.headers.get("set-cookie") ?? "").split(";")[0];
},30000);
// Each request uses the same synthetic conversation; do not carry its pin into the next test.
beforeEach(() => {
  const db = new Database(join(dir, "storage.sqlite"));
  db.query("DELETE FROM key_value WHERE namespace = ?").run("session_account_affinity");
  db.close();
});
afterAll(()=>{proc?.kill("SIGKILL");upstream.stop(true);rmSync(dir,{recursive:true,force:true});});
test("Kimi Web access-only import is accepted after executor verification",async()=>{
  const response=await fetch(base+"/api/connections/import",{method:"POST",headers:{cookie,"content-type":"application/json"},body:JSON.stringify({provider:"kimi-web",accounts:{access_token:"synthetic-kimi-new"}})});
  const result=await response.json() as any;
  expect(result.results[0].valid).toBe(true);
});
test("known expired imported Kimi returns typed reauthentication without dispatch", async () => {
  calls.length = 0;
  const response = await fetch(base + "/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-styx-connection": expiredId }, body: JSON.stringify({model:"kimi-web/k3",messages:[{role:"user",content:"test"}]}) });
  const text = await response.text();
  expect(response.status).toBe(401);
  expect(text).toContain("IMPORTED_TOKEN_REAUTH_REQUIRED");
  expect(calls).toEqual([]);
  // Remove only the expired synthetic fixture so later routing tests select a live account.
  const deleted = await fetch(base + "/api/connections/" + expiredId, { method: "DELETE", headers: { cookie } });
  expect(deleted.status).toBe(200);
}, 30000);

test("actual Kimi executor rejects imported 403 without leaking or falling back",async()=>{
  const response=await fetch(base+"/v1/chat/completions",{method:"POST",headers:{authorization:`Bearer ${key}`,"content-type":"application/json"},body:JSON.stringify({model:"kimi-web/k3",messages:[{role:"user",content:"test"}]})});
  const text=await response.text();
  expect(response.status).toBe(403); expect(text).toContain("IMPORTED_TOKEN_FORBIDDEN"); expect(text).not.toContain("synthetic-secret-upstream"); expect(calls).toEqual(["Bearer synthetic-kimi-first"]);
},30000);

for (const status of [403, 401]) for (const strategy of ["priority", "round-robin"]) for (const stream of [false, true]) {
  test(`real Kimi ${strategy} stream=${stream} upstream ${status} stops fallback`, async () => {
    calls.length = 0; upstreamStatus = status;
    const response = await fetch(base + "/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model: `kimi-${strategy}`, stream, messages: [{ role: "user", content: "test" }] }) });
    const text = await response.text();
    expect(response.status).toBe(status);
    expect(text).toContain(status === 401 ? "IMPORTED_TOKEN_REAUTH_REQUIRED" : "IMPORTED_TOKEN_FORBIDDEN");
    expect(text).not.toContain("synthetic-secret-upstream");
    expect(calls).toHaveLength(1);
    const db = new Database(join(dir, "storage.sqlite"), { readonly: true });
    const rows = db.query("SELECT name, test_status, is_active FROM provider_connections WHERE provider = 'kimi-web'").all() as any[];
    db.close();
    const row = rows.find(row => calls[0] === `Bearer ${row.name}`);
    expect(row).toBeDefined();
    expect(row.is_active).toBe(status === 401 ? 0 : 1);
    if (status === 401) expect(row.test_status).toBe("expired");
    else expect(row.test_status).not.toBe("expired");
  }, 30000);
}
