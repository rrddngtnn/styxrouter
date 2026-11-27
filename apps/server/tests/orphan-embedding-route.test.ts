import './helpers/test-secrets';
import { expect, test } from 'bun:test';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { SPECIALTY_PROVIDERS } from '../server/specialty';

// Actual Hono/auth/adapter chain. All egress is intercepted before imports.
const calls: Array<{url:string; body:any; headers:Headers}> = [];
globalThis.fetch = (async (url:any, init:any) => {
  calls.push({url:String(url),body:JSON.parse(init.body),headers:new Headers(init.headers)});
  if(String(url)==='https://google.serper.dev/search') return Response.json({organic:[{title:'fixture result',link:'https://example.invalid',snippet:'offline'}]});
  if(String(url)!=='https://api.openai.com/v1/embeddings') throw Error('unexpected egress');
  if(calls.at(-1)!.body.input==='upstream-failure') return Response.json({error:{message:'offline upstream rejection'}},{status:429});
  return Response.json({data:[{index:0,embedding:[[0.25,0.5]]}],usage:{prompt_tokens:2,total_tokens:2}});
}) as typeof fetch;
const { createV1Api } = await import('../server/v1');
const { requireAuth } = await import('../server/auth');
const { createProviderConnection } = await import('../src/lib/db/providers');
const { createApiKey } = await import('../src/lib/db/apiKeys');
const app = new Hono(); app.use('*',requireAuth); app.route('/v1',createV1Api(async()=>{}));
const connection:any = await createProviderConnection({provider:'openai',authType:'apikey',name:'offline embedding',apiKey:'synthetic-embedding-key',isActive:true} as any);
const key = (await createApiKey('embedding fixture','fixture')).key;
const send = (body:any, token:string|null=key, extra:Record<string,string>={}) => app.request('/v1/embeddings',{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{}),...extra},body:JSON.stringify(body)});

test('mounted embedding route calls the existing adapter and preserves exact provider model',async()=>{
  const r=await send({model:'openai/text-embedding-3-small',input:'fixture'},key,{'x-styx-connection':connection.id});
  expect(r.status).toBe(200);
  expect((await r.json()).data[0].embedding).toEqual([0.25,0.5]);
  expect(calls).toHaveLength(1);
  expect(calls[0].body).toEqual({model:'text-embedding-3-small',input:'fixture'});
  expect(calls[0].headers.get('authorization')).toBe('Bearer synthetic-embedding-key');
});

test('specialty onboarding accepts an existing embedding provider without adding it to chat',async()=>{
 const {createAdminApi}=await import('../server/admin');
 const admin=createAdminApi();
 const r=await admin.request('/connections',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({provider:'nebius',name:'offline nebius',apiKey:'synthetic-nebius-key'})});
 expect(r.status).toBe(201);
 const {createProviderModelsApi}=await import('../server/providerModels');
 const models=await createProviderModelsApi().request('/providers/nebius/models');
 expect(models.status).toBe(200);
});

test('mounted search route executes the existing Serper builder and normalizer',async()=>{
 const {createProviderConnection}=await import('../src/lib/db/providers');
 const search:any=await createProviderConnection({provider:'serper-search',authType:'apikey',name:'offline search',apiKey:'synthetic-search-key',isActive:true} as any);
 const before=calls.length;
 const r=await app.request('/v1/search',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json','x-styx-connection':search.id},body:JSON.stringify({provider:'serper',query:'fixture',max_results:1})});
 expect(r.status).toBe(200); const data=await r.json(); expect(data.provider).toBe('serper-search'); expect(data.results[0].title).toBe('fixture result'); expect(calls.length).toBe(before+1); expect(calls.at(-1)!.headers.get('x-api-key')).toBe('synthetic-search-key');
});

test('panel lists callable specialty providers through its existing authenticated endpoint',async()=>{
 const {default:server}=await import('../server/styx');
 const {SignJWT}=await import('jose');
 const token=await new SignJWT({authenticated:true}).setProtectedHeader({alg:'HS256'}).setExpirationTime('1m').sign(new TextEncoder().encode(process.env.JWT_SECRET!));
 const r=await server.fetch(new Request('http://localhost/api/providers',{headers:{cookie:'auth_token='+token}}));
 expect(r.status).toBe(200); const body=await r.json(); expect(body.providers.some((p:any)=>p.id==='nebius')).toBe(true); expect(body.providers.some((p:any)=>p.id==='serper-search')).toBe(true);
});

test('unknown embedding aliases never borrow a canonical account',async()=>{
 const n=calls.length; const r=await send({model:'oa/text-embedding-3-small',input:'fixture'});
 expect(r.status).toBe(400); expect(calls.length).toBe(n);
});

test('negative embedding inputs never dispatch or fall back to another provider',async()=>{
 const n=calls.length;
 for(const body of [null,{}, {model:'magnific/mystic',input:'fixture'}, {model:'openai/text-embedding-3-small',input:'fixture',stream:true}, {model:'cohere/embed-v4.0',input:'fixture'}]) expect((await send(body)).status).toBe(400);
 const foreign:any=await createProviderConnection({provider:'nebius',authType:'apikey',name:'wrong provider',apiKey:'synthetic-wrong-provider',isActive:true} as any);
 expect((await send({model:'openai/text-embedding-3-small',input:'fixture'},key,{'x-styx-connection':foreign.id})).status).toBe(503);
 expect(calls.length).toBe(n);
});

test('model ACL and connection ACL apply before embedding execution',async()=>{
 const {updateApiKeyPermissions}=await import('../src/lib/db/apiKeys');
 const restricted=await createApiKey('restricted fixture','fixture');
 await updateApiKeyPermissions(restricted.id,{modelAccessMode:'restricted',allowedModels:['nebius/*']});
 const n=calls.length;
 expect((await send({model:'openai/text-embedding-3-small',input:'fixture'},restricted.key)).status).toBe(403);
 const scoped=await createApiKey('scoped fixture','fixture',[],{allowedConnections:['not-this-connection']});
 expect((await send({model:'openai/text-embedding-3-small',input:'fixture'},scoped.key,{'x-styx-connection':connection.id})).status).toBe(403);
 expect(calls.length).toBe(n);
});

test('upstream embedding rejection preserves status with no cross-model fallback',async()=>{
 const n=calls.length;
 const r=await send({model:'openai/text-embedding-3-small',input:'upstream-failure'},key,{'x-styx-connection':connection.id});
 expect(r.status).toBe(429); expect(calls.length).toBe(n+1);
});

test('search rejects unsafe transport overrides, anonymous callers and unknown providers',async()=>{
 const n=calls.length;
 for(const [body,token,status] of [
 [{provider:'serper',query:'fixture'},null,401],
 [{provider:'unknown',query:'fixture'},key,400],
 [{provider:'serper',query:'fixture',stream:true},key,400],
 [{provider:'serper',query:'fixture',provider_options:{baseUrl:'http://169.254.169.254'}},key,400],
 ] as const) {const r=await app.request('/v1/search',{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)}); expect(r.status).toBe(status);}
 expect(calls.length).toBe(n);
});

test('actual host denies cookie/query auth, CSRF, canonical ACL and oversized bodies without dispatch',async()=>{
 const {default:server}=await import('../server/styx');
 const {getProviderConnections}=await import('../src/lib/db/providers');
 const {updateApiKeyPermissions}=await import('../src/lib/db/apiKeys');
 const {SignJWT}=await import('jose');
 const cookie='auth_token='+await new SignJWT({authenticated:true}).setProtectedHeader({alg:'HS256'}).setExpirationTime('1m').sign(new TextEncoder().encode(process.env.JWT_SECRET!));
 const n=calls.length, count=(await getProviderConnections()).length;
 const req=(path:string,body:any,headers:Record<string,string>={})=>server.fetch(new Request('http://localhost'+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)}));
 for(const path of ['/v1/search','/v1/embeddings']) {
  const body=path.endsWith('search')?{provider:'serper',query:'fixture'}:{model:'openai/text-embedding-3-small',input:'fixture'};
  for(const headers of [{cookie},{cookie:'auth_token=invalid'},{'x-api-key':key},{}]) expect((await req(path,body,headers)).status).toBe(401);
  expect((await req(path+'?api_key='+key,body)).status).toBe(401);
 }
 for(const headers of [{cookie:'auth_token=invalid'},{cookie,origin:'https://attacker.invalid'}]) expect([401,403]).toContain((await req('/api/connections',{provider:'nebius',name:'must not create',apiKey:'fixture-not-created'},headers)).status);
 expect((await getProviderConnections()).length).toBe(count);
 const restricted=await createApiKey('canonical denial','fixture');
 await updateApiKeyPermissions(restricted.id,{modelAccessMode:'restricted',allowedModels:['serper']});
 expect((await req('/v1/search',{provider:'serper',query:'fixture'},{authorization:'Bearer '+restricted.key})).status).toBe(403);
 expect((await req('/v1/search',{provider:'serper',query:'x'.repeat(70000)},{authorization:'Bearer '+key})).status).toBe(413);
 expect((await req('/v1/embeddings',{model:'openai/text-embedding-3-small',input:'x'.repeat(1050000)},{authorization:'Bearer '+key})).status).toBe(413);
 expect(calls.length).toBe(n);
 const {updateProviderConnection}=await import('../src/lib/db/providers');
 await updateProviderConnection(connection.id,{rateLimitedUntil:null,backoffLevel:0,testStatus:'active',lastError:null} as any);
 const good=await server.fetch(new Request('http://caller.invalid/v1/embeddings',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({model:'openai/text-embedding-3-small',input:'host fixture'})}));
 expect(good.status).toBe(200); expect(calls.at(-1)!.url).toBe('https://api.openai.com/v1/embeddings'); expect(calls.at(-1)!.headers.get('authorization')).toBe('Bearer synthetic-embedding-key');
});

test('embedding endpoint rejects anonymous requests before dispatch',async()=>{
 const n=calls.length; expect((await send({model:'openai/text-embedding-3-small',input:'fixture'},null)).status).toBe(401); expect(calls.length).toBe(n);
});
