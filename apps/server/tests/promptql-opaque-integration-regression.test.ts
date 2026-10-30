import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { prepareTokenImport, tokenImportProviders } from "../server/tokenImport.ts";

test("PromptQL exposes access-only and rejects refresh and invalid credentials", () => {
  expect(tokenImportProviders().find(x => x.id === "promptql")).toMatchObject({ supported: true, access: true, accessRefresh: false });
  for (const accounts of [{ access_token: "synthetic", refresh_token: "refresh-secret" }, { access_token: "bad token" }, { access_token: "" }]) {
    const view = prepareTokenImport({ provider: "promptql", accounts })![0].view;
    expect(view.valid).toBe(false);
    expect(JSON.stringify(view)).not.toContain("refresh-secret");
  }
});

const root = join(import.meta.dir, "..");
const dir = mkdtempSync(join(tmpdir(), "promptql-import-probe-"));
let proc: ReturnType<typeof spawn>, base = "", key = "", cookie = "", expiredId = "", importedId = "";
const calls: string[] = [];
const projects: unknown[] = [];
let upstreamStatus = 403;
const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  calls.push(request.headers.get("authorization") ?? "");
  if (upstreamStatus !== 200) return new Response("synthetic-secret-upstream", { status: upstreamStatus });
  const payload = await request.json() as any;
  if (payload.variables?.projectId) projects.push(payload.variables.projectId);
  if (payload.operationName === "QueryThreadEvents") return Response.json({data:{thread_events:[{thread_event_id:2,event_data:{AgentMessage:{final_response:{message:"synthetic response"},state:"final_response_sent"}}}]}});
  return Response.json({data:{start_thread:{thread_id:"12345678-1234-4123-8123-123456789012",thread_events:[]}}});
}});
const env = { ...process.env, DATA_DIR: dir, STYX_TEST_MODE: "1", MOCK_UPSTREAM_PORT: String(upstream.port), PROMPTQL_GRAPHQL_ENDPOINT: `http://127.0.0.1:${upstream.port}/graphql`, JWT_SECRET: "promptql-probe-jwt-secret-0123456789", API_KEY_SECRET: "promptql-probe-api-secret-0123456789", STORAGE_ENCRYPTION_KEY: "promptql-probe-encryption-key", INITIAL_PASSWORD: "promptql-probe-password" };
beforeAll(async () => {
  const made = spawnSync(process.execPath, ["-e", `const {createApiKey}=await import('./src/lib/db/apiKeys.ts'); const {createProviderConnection}=await import('./src/lib/db/providers.ts'); const {createCombo}=await import('./src/lib/db/combos.ts'); const key=(await createApiKey('test','test')).key; for (const token of ['synthetic-promptql-first','synthetic-promptql-second',...Array.from({length:10},(_,i)=>'synthetic-promptql-'+i)]) await createProviderConnection({provider:'promptql',authType:'oauth',name:token,accessToken:token,isActive:true,providerSpecificData:{importedToken:true,nonRefreshable:true,projectId:'12345678-1234-4123-8123-123456789012'}}); const expiredId=(await createProviderConnection({provider:'promptql',authType:'oauth',name:'expired',accessToken:'synthetic-expired',expiresAt:'1970-01-01T00:00:01.000Z',isActive:true,providerSpecificData:{importedToken:true,nonRefreshable:true,projectId:'12345678-1234-4123-8123-123456789012'}})).id; for (const strategy of ['priority','round-robin']) await createCombo({name:'promptql-'+strategy,strategy,models:['promptql/claude-sonnet-4','promptql/claude-sonnet-4']}); console.log(JSON.stringify({key,expiredId}));`], {cwd:root,env,encoding:"utf8"});
  expect(made.status).toBe(0); const fixture = JSON.parse(made.stdout.trim().split("\n").pop()!); key = fixture.key; expiredId = fixture.expiredId;
  const helper = join(dir, "server.ts");
  writeFileSync(helper, `const orig=globalThis.fetch; globalThis.fetch=((input,init)=>{const u=new URL(input instanceof Request?input.url:String(input)); if(u.hostname==='data.prompt.ql.app') return orig('http://127.0.0.1:'+process.env.MOCK_UPSTREAM_PORT+u.pathname,init); if(u.hostname==='127.0.0.1'||u.hostname==='localhost') return orig(input,init); throw new Error('external network blocked');}); const {default:config}=await import(${JSON.stringify(join(root,"server/styx.ts"))}); const s=Bun.serve({...config,hostname:'127.0.0.1',port:0}); console.log('LISTEN:'+s.port);`);
  proc=spawn(process.execPath,[helper],{cwd:root,env,stdio:["ignore","pipe","pipe"]});
  let out="", err=""; proc.stderr!.on("data",c=>err+=c);
  const port=await new Promise<string>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(err)),30000);proc.once("exit",()=>reject(new Error(err)));proc.stdout!.on("data",c=>{out+=c;const m=out.match(/LISTEN:(\d+)/);if(m){clearTimeout(timer);resolve(m[1]);}})});
  base=`http://127.0.0.1:${port}`;
  const login=await fetch(base+"/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({password:"promptql-probe-password"})});
  cookie=(login.headers.get("set-cookie") ?? "").split(";")[0];
},30000);
afterAll(()=>{proc?.kill("SIGKILL");upstream.stop(true);rmSync(dir,{recursive:true,force:true});});
test("PromptQL Web access-only import is accepted after executor verification",async()=>{
  const response=await fetch(base+"/api/connections/import",{method:"POST",headers:{cookie,"content-type":"application/json"},body:JSON.stringify({provider:"promptql",accounts:{access_token:"synthetic-promptql-new",projectId:"12345678-1234-4123-8123-123456789012"}})});
  const result=await response.json() as any;
  expect(result.results[0].valid).toBe(true);
  importedId = result.results[0].id;
  expect(JSON.stringify(result)).not.toContain("synthetic-promptql-new");
  const db = new Database(join(dir, "storage.sqlite"), { readonly: true });
  const row = db.query("SELECT access_token FROM provider_connections WHERE id = ?").get(result.results[0].id) as any; db.close();
  expect(row.access_token).not.toContain("synthetic-promptql-new");
  expect(row.access_token).toStartWith("enc:v1:");
});
test("known expired imported PromptQL returns typed reauthentication without dispatch", async () => {
  // A pinned expired request is its own session. Reusing the identical prompt
  // without a session ID would pin every later unpinned case to this account.
  calls.length = 0;
  const response = await fetch(base + "/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-styx-connection": expiredId, "x-session-id": "promptql-expired-only" }, body: JSON.stringify({model:"promptql/claude-sonnet-4",messages:[{role:"user",content:"test"}]}) });
  const text = await response.text();
  expect(response.status).toBe(401);
  expect(text).toContain("IMPORTED_TOKEN_REAUTH_REQUIRED");
  expect(calls).toEqual([]);
}, 30000);

test("actual PromptQL executor rejects imported 403 without leaking or falling back",async()=>{
  const response=await fetch(base+"/v1/chat/completions",{method:"POST",headers:{authorization:`Bearer ${key}`,"content-type":"application/json"},body:JSON.stringify({model:"promptql/claude-sonnet-4",messages:[{role:"user",content:"test"}]})});
  const text=await response.text();
  expect(response.status).toBe(403); expect(text).toContain("IMPORTED_TOKEN_FORBIDDEN"); expect(text).not.toContain("synthetic-secret-upstream"); expect(calls).toEqual(["Bearer synthetic-promptql-first"]);
},30000);

for (const status of [403, 401]) for (const strategy of ["priority", "round-robin"]) for (const stream of [false, true]) {
  test(`real PromptQL ${strategy} stream=${stream} upstream ${status} stops fallback`, async () => {
    calls.length = 0; upstreamStatus = status;
    const response = await fetch(base + "/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model: `promptql-${strategy}`, stream, messages: [{ role: "user", content: "test" }] }) });
    const text = await response.text();
    expect(response.status).toBe(status);
    expect(text).toContain(status === 401 ? "IMPORTED_TOKEN_REAUTH_REQUIRED" : "IMPORTED_TOKEN_FORBIDDEN");
    expect(text).not.toContain("synthetic-secret-upstream");
    expect(calls).toHaveLength(1);
    const db = new Database(join(dir, "storage.sqlite"), { readonly: true });
    const rows = db.query("SELECT name, test_status, is_active FROM provider_connections WHERE provider = 'promptql'").all() as any[];
    db.close();
    const row = rows.find(row => calls[0] === `Bearer ${row.name}`);
    expect(row).toBeDefined();
    expect(row.is_active).toBe(status === 401 ? 0 : 1);
    if (status === 401) expect(row.test_status).toBe("expired");
    else expect(row.test_status).not.toBe("expired");
  }, 30000);
}

for (const stream of [false, true]) test(`synthetic upstream success dispatches saved project stream=${stream}`, async () => {
  calls.length = 0; projects.length = 0; upstreamStatus = 200;
  const response = await fetch(base + "/v1/chat/completions", { method:"POST", headers:{authorization:`Bearer ${key}`, "content-type":"application/json", "x-styx-connection":importedId}, body:JSON.stringify({model:"promptql/claude-sonnet-4",stream,messages:[{role:"user",content:"hello"}]}) });
  const body = await response.text();
  expect(response.status).toBe(200); expect(body).toContain("synthetic response"); expect(calls).toEqual(["Bearer synthetic-promptql-new", "Bearer synthetic-promptql-new"]);
  expect(projects).toEqual(["12345678-1234-4123-8123-123456789012"]); expect(body).not.toContain("synthetic-promptql-new");
}, 30000);
