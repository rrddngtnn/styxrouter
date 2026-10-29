import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";

const root = join(import.meta.dir, "..");
const dir = mkdtempSync(join(tmpdir(), "kiro-import-probe-"));
let proc: ReturnType<typeof spawn>, base = "", key = "", cookie = "", expiredId = "";
const calls: string[] = [];
const requests: Array<{ type: string | null; body: any }> = [];
let upstreamStatus = 403;
const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  calls.push(request.headers.get("authorization") ?? "");
  requests.push({ type: request.headers.get("tokentype"), body: await request.json() });
  return new Response("synthetic-secret-upstream", { status: upstreamStatus });
}});
const env = { ...process.env, DATA_DIR: dir, STYX_TEST_MODE: "1", MOCK_UPSTREAM_PORT: String(upstream.port), JWT_SECRET: "kiro-probe-jwt-secret-0123456789", API_KEY_SECRET: "kiro-probe-api-secret-0123456789", STORAGE_ENCRYPTION_KEY: "kiro-probe-encryption-key", INITIAL_PASSWORD: "kiro-probe-password" };
beforeAll(async () => {
  const made = spawnSync(process.execPath, ["-e", `const {createApiKey}=await import('./src/lib/db/apiKeys.ts'); const {createProviderConnection}=await import('./src/lib/db/providers.ts'); const {createCombo}=await import('./src/lib/db/combos.ts'); const key=(await createApiKey('test','test')).key; for (const token of ['synthetic-kiro-first','synthetic-kiro-second',...Array.from({length:10},(_,i)=>'synthetic-kiro-'+i)]) await createProviderConnection({provider:'kiro',authType:'oauth',name:token,accessToken:token,isActive:true,providerSpecificData:{importedToken:true,nonRefreshable:true,authMethod:'social'}}); const expiredId=(await createProviderConnection({provider:'kiro',authType:'oauth',name:'expired',accessToken:'synthetic-expired',expiresAt:'1970-01-01T00:00:01.000Z',isActive:true,providerSpecificData:{importedToken:true,nonRefreshable:true,authMethod:'social'}})).id; for (const strategy of ['priority','round-robin']) await createCombo({name:'kiro-'+strategy,strategy,models:['kiro/claude-sonnet-4.5','kiro/claude-sonnet-5']}); console.log(JSON.stringify({key,expiredId}));`], {cwd:root,env,encoding:"utf8"});
  expect(made.status).toBe(0); const fixture = JSON.parse(made.stdout.trim().split("\n").pop()!); key = fixture.key; expiredId = fixture.expiredId;
  const helper = join(dir, "server.ts");
  writeFileSync(helper, `const orig=globalThis.fetch; globalThis.fetch=((input,init)=>{const u=new URL(input instanceof Request?input.url:String(input)); if(u.hostname==='codewhisperer.us-east-1.amazonaws.com') return orig('http://127.0.0.1:'+process.env.MOCK_UPSTREAM_PORT+u.pathname,init); if(u.hostname==='127.0.0.1'||u.hostname==='localhost') return orig(input,init); throw new Error('external network blocked');}); const {default:config}=await import(${JSON.stringify(join(root,"server/styx.ts"))}); const s=Bun.serve({...config,hostname:'127.0.0.1',port:0}); console.log('LISTEN:'+s.port);`);
  proc=spawn(process.execPath,[helper],{cwd:root,env,stdio:["ignore","pipe","pipe"]});
  let out="", err=""; proc.stderr!.on("data",c=>err+=c);
  const port=await new Promise<string>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(err)),30000);proc.once("exit",()=>reject(new Error(err)));proc.stdout!.on("data",c=>{out+=c;const m=out.match(/LISTEN:(\d+)/);if(m){clearTimeout(timer);resolve(m[1]);}})});
  base=`http://127.0.0.1:${port}`;
  const login=await fetch(base+"/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({password:"kiro-probe-password"})});
  cookie=(login.headers.get("set-cookie") ?? "").split(";")[0];
},30000);
// Each request uses the same synthetic conversation; do not carry its pin into the next test.
beforeEach(() => {
  const db = new Database(join(dir, "storage.sqlite"));
  db.query("DELETE FROM key_value WHERE namespace = ?").run("session_account_affinity");
  db.close();
});
afterAll(()=>{proc?.kill("SIGKILL");upstream.stop(true);rmSync(dir,{recursive:true,force:true});});
test("Kiro access-only import is accepted after executor verification",async()=>{
  const response=await fetch(base+"/api/connections/import",{method:"POST",headers:{cookie,"content-type":"application/json"},body:JSON.stringify({provider:"kiro",accounts:{access_token:"synthetic-kiro-new",authMethod:"social"}})});
  const result=await response.json() as any;
  expect(result.results[0].valid).toBe(true);
});
test("imported external IdP reaches real executor with bound metadata", async () => {
  const arn = "arn:aws:codewhisperer:us-east-1:123456789012:profile/abcdef12-3456-7890-abcd-123456789012";
  const payload = {provider:"kiro",accounts:{access_token:"synthetic-imported-external",authMethod:"external_idp",profileArn:arn,region:"eu-north-1",clientSecret:"synthetic-extra-secret"}};
  const response = await fetch(base+"/api/connections/import",{method:"POST",headers:{cookie,"content-type":"application/json"},body:JSON.stringify(payload)});
  const result = await response.json() as any;
  expect(result.results[0].valid).toBe(true);
  expect(JSON.stringify(result)).not.toContain("synthetic-");
  const id = result.results[0].id;
  const db = new Database(join(dir,"storage.sqlite"),{readonly:true});
  const row = db.query("SELECT access_token,provider_specific_data FROM provider_connections WHERE id=?").get(id) as any;
  db.close();
  expect(row.access_token).toStartWith("enc:v1:");
  expect(row.provider_specific_data).not.toContain("synthetic-");
  expect(JSON.parse(row.provider_specific_data)).toMatchObject({authMethod:"external_idp",profileArn:arn,region:"eu-north-1"});
  calls.length=0; requests.length=0; upstreamStatus=403;
  const chat = await fetch(base+"/v1/chat/completions",{method:"POST",headers:{authorization:`Bearer ${key}`,"content-type":"application/json","x-styx-connection":id},body:JSON.stringify({model:"kiro/claude-sonnet-4.5",messages:[{role:"user",content:"test"}]})});
  expect(chat.status).toBe(403);
  expect(await chat.text()).toContain("IMPORTED_TOKEN_FORBIDDEN");
  expect(calls).toEqual(["Bearer synthetic-imported-external"]);
  expect(requests[0].type).toBe("EXTERNAL_IDP");
  expect(requests[0].body.profileArn).toBe(arn);
  calls.length=0;
},30000);
test("known expired imported Kiro returns typed reauthentication without dispatch", async () => {
  calls.length = 0;
  const response = await fetch(base + "/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-styx-connection": expiredId }, body: JSON.stringify({model:"kiro/claude-sonnet-4.5",messages:[{role:"user",content:"test"}]}) });
  const text = await response.text();
  expect(response.status).toBe(401);
  expect(text).toContain("IMPORTED_TOKEN_REAUTH_REQUIRED");
  expect(calls).toEqual([]);
  // Remove only the expired synthetic fixture so later routing tests select a live account.
  const deleted = await fetch(base + "/api/connections/" + expiredId, { method: "DELETE", headers: { cookie } });
  expect(deleted.status).toBe(200);
}, 30000);

test("actual Kiro executor rejects imported 403 without leaking or falling back",async()=>{
  const response=await fetch(base+"/v1/chat/completions",{method:"POST",headers:{authorization:`Bearer ${key}`,"content-type":"application/json"},body:JSON.stringify({model:"kiro/claude-sonnet-4.5",messages:[{role:"user",content:"test"}]})});
  const text=await response.text();
  expect(response.status).toBe(403); expect(text).toContain("IMPORTED_TOKEN_FORBIDDEN"); expect(text).not.toContain("synthetic-secret-upstream"); expect(calls).toEqual(["Bearer synthetic-kiro-first"]);
},30000);

for (const status of [403, 401]) for (const strategy of ["priority", "round-robin"]) for (const stream of [false, true]) {
  test(`real Kiro ${strategy} stream=${stream} upstream ${status} stops fallback`, async () => {
    calls.length = 0; upstreamStatus = status;
    const response = await fetch(base + "/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model: `kiro-${strategy}`, stream, messages: [{ role: "user", content: "test" }] }) });
    const text = await response.text();
    expect(response.status).toBe(status);
    expect(text).toContain(status === 401 ? "IMPORTED_TOKEN_REAUTH_REQUIRED" : "IMPORTED_TOKEN_FORBIDDEN");
    expect(text).not.toContain("synthetic-secret-upstream");
    expect(calls).toHaveLength(1);
    const db = new Database(join(dir, "storage.sqlite"), { readonly: true });
    const rows = db.query("SELECT name, test_status, is_active FROM provider_connections WHERE provider = 'kiro'").all() as any[];
    db.close();
    const row = rows.find(row => calls[0] === `Bearer ${row.name}`);
    expect(row).toBeDefined();
    expect(row.is_active).toBe(status === 401 ? 0 : 1);
    if (status === 401) expect(row.test_status).toBe("expired");
    else expect(row.test_status).not.toBe("expired");
  }, 30000);
}
