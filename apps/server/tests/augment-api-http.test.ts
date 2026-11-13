import './helpers/test-secrets';
import {test,expect,mock} from 'bun:test';
mock.module('../open-sse/services/augmentApiTransport',()=>({augmentPinnedPost:(url:string,init:RequestInit)=>globalThis.fetch(url,init)}));
test('mounted Hono route uses encrypted stored key and native executor without caller budget',async()=>{
 const original=globalThis.fetch;const calls:string[]=[];let onDiscovery:(()=>void)|undefined;
 globalThis.fetch=Object.assign(async(input:string|URL|Request,init?:RequestInit)=>{
  const url=String(input instanceof Request?input.url:input);
  if(!url.startsWith('https://fixture.api.augmentcode.com/'))throw Error('External network forbidden');
  calls.push(url);expect(['Bearer synthetic-upstream','Bearer synthetic-managed']).toContain(new Headers(init?.headers).get('authorization'));
  if(url.endsWith('/get-models')){onDiscovery?.();return Response.json({feature_flags:{model_info_registry:'{"fixture-model":{"displayName":"Fixture"}}'}});}
  return new Response('{"text":"native mounted output"}\n{"stop_reason":1,"nodes":[{"type":10,"token_usage":{"input_tokens":4,"output_tokens":2}}]}\n');
 },{preconnect:original.preconnect});
 try{
  process.env.INITIAL_PASSWORD='fixture-password';process.env.STYX_TEST_MODE='1';
  const {createProviderConnection}=await import('../src/lib/db/providers');const {createApiKey}=await import('../src/lib/db/apiKeys');
  await createProviderConnection({provider:'augment-api',authType:'apikey',apiKey:'synthetic-upstream',providerSpecificData:{apiUrl:'https://fixture.api.augmentcode.com'},isActive:true});
  const key=(await createApiKey('augment-fixture','synthetic-machine')).key;
  const {default:config}=await import('../server/styx.ts');
  const login=await config.fetch(new Request('http://localhost/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'fixture-password'})}));expect(login.status).toBe(200);
  const cookie=login.headers.get('set-cookie')?.split(';')[0]??'';
  const manage=(path:string,body:unknown)=>config.fetch(new Request('http://localhost/api'+path,{method:'POST',headers:{cookie,origin:'http://localhost','content-type':'application/json'},body:JSON.stringify(body)}));
  const missing=await manage('/connections',{provider:'augment-api',name:'missing-tenant',apiKey:'synthetic-upstream'});expect(missing.status).toBe(400);
  const created=await manage('/connections',{provider:'augment-api',name:'fixture-managed',apiKey:'synthetic-managed',apiUrl:'https://fixture.api.augmentcode.com'});expect(created.status).toBe(201);
  const {getDbInstance}=await import('../src/lib/db/core');const db=getDbInstance();
  const stored=db.prepare("SELECT id,api_key FROM provider_connections WHERE name='fixture-managed'").get() as {id:string;api_key:string};expect(stored.api_key.startsWith('enc:v1:')).toBe(true);
  const sync=await manage(`/providers/${stored.id}/sync-models`,{});expect(sync.status).toBe(200);
  const listing=await config.fetch(new Request('http://localhost/v1/models',{headers:{authorization:'Bearer '+key}}));
  const catalogResponse=await listing.json() as {data:Record<string,unknown>[]};const entry=catalogResponse.data.find(m=>m.id==='augment-api/fixture-model');expect(entry?.supported_parameters).toEqual(['tools']);
  const catalog=db.prepare("SELECT value FROM key_value WHERE namespace='syncedAvailableModels' AND key=?").get(`augment-api:${stored.id}`) as {value:string};expect(JSON.parse(catalog.value)).toMatchObject([{id:'fixture-model'}]);
  const inventoryResponse=await config.fetch(new Request('http://localhost/api/providers/augment-api/models',{headers:{cookie}}));
  const managedInventory=await inventoryResponse.json() as {models:Record<string,unknown>[]};expect(managedInventory.models.find(m=>m.id==='fixture-model')?.supported_parameters).toEqual(['tools']);
  await config.fetch(new Request('http://localhost/api/connections/'+stored.id,{method:'PATCH',headers:{cookie,origin:'http://localhost','content-type':'application/json'},body:JSON.stringify({isActive:false})}));
  const send=(extra:Record<string,unknown>={},auth=true)=>config.fetch(new Request('http://localhost/v1/chat/completions',{method:'POST',headers:{...(auth?{authorization:'Bearer '+key}:{}),'content-type':'application/json','cache-control':'no-cache'},body:JSON.stringify({model:'augment-api/fixture-model',messages:[{role:'user',content:'hello native'}],...extra})}));
  const result=await send();const text=await result.text();expect({status:result.status,text}).toMatchObject({status:200});expect(text).toContain('native mounted output');
  const owner=db.prepare("SELECT id FROM api_keys WHERE name='augment-fixture'").get() as {id:string};
  onDiscovery=()=>{db.prepare("UPDATE api_keys SET allowed_connections='[\"denied-fixture-account\"]' WHERE id=?").run(owner.id);};
  const raceCount=calls.length;const raced=await send();expect(raced.status).toBe(403);expect(calls.length).toBe(raceCount+1);onDiscovery=undefined;
  db.prepare("UPDATE api_keys SET allowed_connections='[]' WHERE id=?").run(owner.id);
  const unsupported=await send({max_completion_tokens:9,temperature:0.2});expect(unsupported.status).toBe(400);
  const streamed=await send({stream:true});expect(streamed.status).toBe(200);expect(await streamed.text()).toContain('[DONE]');
  const unknown=await send({model:'augment-api/haiku4.5'});expect(unknown.status).toBe(400);
  const before=calls.length;const bad=await send({max_tokens:4});expect(bad.status).toBe(400);expect(calls.length).toBe(before);
  const routeSend=(path:string,body:unknown)=>config.fetch(new Request('http://localhost/v1/'+path,{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json','cache-control':'no-cache'},body:JSON.stringify(body)}));
  for(const [path,body] of [['responses',{model:'augment-api/fixture-model',input:'response fixture'}],['messages',{model:'augment-api/fixture-model',max_tokens:12,messages:[{role:'user',content:'message fixture'}]}]] as const){const count=calls.length;const r=await routeSend(path,body);if(path==='responses'){expect({status:r.status,text:await r.text()}).toMatchObject({status:200});expect(calls.length).toBe(count+2);}else {expect(r.status).toBe(400);expect(calls.length).toBe(count);}}
  for(const extra of [{tool_choice:'auto'},{stop:['end']},{max_output_tokens:9}]){const count=calls.length;expect((await send(extra)).status).toBe(400);expect(calls.length).toBe(count);}
  const {updateSettings}=await import('../src/lib/db/settings');await updateSettings({globalFallbackModel:'auggie/haiku4.5',modelAliases:{'native-review-alias':'augment-api/fixture-model'}});
  const selectionBefore=db.prepare('SELECT last_used_at FROM provider_connections WHERE provider=?').all('augment-api');
  const aliasCount=calls.length;const aliasRejection=await send({model:'native-review-alias',max_tokens:8});expect(aliasRejection.status).toBe(400);expect(calls.length).toBe(aliasCount);
  expect(await aliasRejection.text()).toContain('unsupported_parameter');
  const {createCombo}=await import('../src/lib/db/combos');
  await createCombo({name:'native-review-combo',strategy:'priority',models:['augment-api/fixture-model'],config:{maxRetries:0}});
  const comboCount=calls.length;const comboRejection=await send({model:'native-review-combo',max_tokens:8});expect(comboRejection.status).toBe(400);expect(calls.length).toBe(comboCount);expect(await comboRejection.text()).toContain('unsupported_parameter');
  expect(db.prepare('SELECT last_used_at FROM provider_connections WHERE provider=?').all('augment-api')).toEqual(selectionBefore);
  for(const strategy of ['pipeline','parallel','fusion','chaos','context-relay']){
   const name=`native-unsupported-${strategy}`;
   await createCombo({name,strategy,models:['augment-api/fixture-model'],config:{maxRetries:0}});
   const beforeAdvanced=calls.length;const recency=db.prepare('SELECT last_used_at FROM provider_connections WHERE provider=?').all('augment-api');
   const rejected=await send({model:name});expect(rejected.status).toBe(400);expect(await rejected.text()).toContain('unsupported_augment_routing');expect(calls.length).toBe(beforeAdvanced);
   expect(db.prepare('SELECT last_used_at FROM provider_connections WHERE provider=?').all('augment-api')).toEqual(recency);
  }
  const failOriginal=globalThis.fetch;globalThis.fetch=Object.assign(async()=>new Response('FAKE-native-denial',{status:403}),{preconnect:original.preconnect});
  try{const failure=await send();expect(failure.status).toBe(403);}finally{globalThis.fetch=failOriginal;}

  const restricted=(await createApiKey('restricted-fixture','synthetic-machine',[],{allowedConnections:[stored.id]})).key;
  const deniedBefore=calls.length;const denied=await config.fetch(new Request('http://localhost/v1/chat/completions',{method:'POST',headers:{authorization:'Bearer '+restricted,'content-type':'application/json'},body:JSON.stringify({model:'augment-api/fixture-model',messages:[{role:'user',content:'denied'}]})}));expect(denied.status).not.toBe(200);expect(calls.length).toBe(deniedBefore);
  const imported=await manage('/connections/import',{provider:'augment-api',accounts:[{token:'synthetic-import-secret',apiUrl:'https://fixture.api.augmentcode.com'}]});expect(imported.status).toBe(200);
  const importedRow=db.prepare("SELECT api_key,provider_specific_data FROM provider_connections WHERE provider='augment-api' AND name LIKE 'Imported account%'").get() as {api_key:string;provider_specific_data:string};expect(importedRow.api_key.startsWith('enc:v1:')).toBe(true);expect(JSON.parse(importedRow.provider_specific_data).apiUrl).toBe('https://fixture.api.augmentcode.com');
  const conflicting=await manage('/connections/import',{provider:'augment-api',accounts:[{token:'synthetic-import-secret',apiUrl:'https://another.api.augmentcode.com'}]});expect(await conflicting.text()).toContain('conflicts');
  // Warm shared-account routing, then mutate authoritative caller policy in another process.
  const keyRow=db.prepare("SELECT id FROM api_keys WHERE name='augment-fixture'").get() as {id:string};
  const sqlitePath=(db.prepare('PRAGMA database_list').all() as {name:string;file:string}[]).find(r=>r.name==='main')!.file;
  const child=Bun.spawn(['python3','-c',"import sqlite3,sys; d=sqlite3.connect(sys.argv[1]); d.execute('UPDATE api_keys SET is_active=0 WHERE id=?',(sys.argv[2],)); d.commit(); d.close()",sqlitePath,keyRow.id]);expect(await child.exited).toBe(0);
  const revokedCount=calls.length;expect((await send()).status).toBe(401);expect(calls.length).toBe(revokedCount);
  const anon=await send({},false);expect(anon.status).toBe(401);
 }finally{globalThis.fetch=original;}
},30000);
