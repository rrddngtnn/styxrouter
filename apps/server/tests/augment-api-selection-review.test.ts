import './helpers/test-secrets';
import {test,expect,mock} from 'bun:test';
mock.module('../open-sse/services/augmentApiTransport',()=>({augmentPinnedPost:(url:string,init:RequestInit)=>globalThis.fetch(url,init)}));
import {createProviderConnection} from '../src/lib/db/providers';
import {getDbInstance} from '../src/lib/db/core';
import {AugmentApiExecutor} from '../open-sse/executors/augment-api';
import {updateProviderConnection} from '../src/lib/db/providers';
import {loadAdvertisedModelsForSelfHostedConnections} from '../src/sse/services/auth';
test('durable revocation during discovery blocks generation using stale selected credentials',async()=>{
 const c=await createProviderConnection({provider:'augment-api',authType:'apikey',apiKey:'FAKE-revoke',isActive:true,providerSpecificData:{apiUrl:'https://fixture.api.augmentcode.com'}});
 const original=globalThis.fetch;const calls:string[]=[];
 globalThis.fetch=Object.assign(async(input:string|URL|Request)=>{calls.push(String(input));await updateProviderConnection(c.id,{isActive:false});return Response.json({feature_flags:{model_info_registry:'{"Exact-A":{}}'}});},{preconnect:original.preconnect});
 try{const result=await new AugmentApiExecutor().execute({model:'Exact-A',body:{messages:[]},stream:false,credentials:{connectionId:c.id,apiKey:'FAKE-revoke',providerSpecificData:{apiUrl:'https://fixture.api.augmentcode.com'}}});expect(result.response.status).toBe(403);expect(calls.length).toBe(1);}finally{globalThis.fetch=original;}
});
test('Augment preselection restricts each tenant to its own last-good exact catalog',async()=>{
 const a=await createProviderConnection({provider:'augment-api',authType:'apikey',apiKey:'FAKE-selection-a',isActive:true});
 const b=await createProviderConnection({provider:'augment-api',authType:'apikey',apiKey:'FAKE-selection-b',isActive:true});
 const db=getDbInstance();for(const [id,model] of [[a.id,'Exact-A'],[b.id,'Exact-B']])db.prepare("INSERT OR REPLACE INTO key_value(namespace,key,value) VALUES('syncedAvailableModels',?,?)").run('augment-api:'+id,JSON.stringify([{id:model}]));
 const rows=[{id:a.id,provider:'augment-api'},{id:b.id,provider:'augment-api'}];
 const catalogs=await loadAdvertisedModelsForSelfHostedConnections(rows as never,'Exact-A');
 expect(catalogs.get(a.id)?.has('Exact-A')).toBe(true);expect(catalogs.get(b.id)?.has('Exact-A')).toBe(false);expect(catalogs.get(b.id)?.has('Exact-B')).toBe(true);
});

test('trusted caller fence is rechecked after discovery before credential-bearing generation',async()=>{
 let authorized=true,calls=0;
 const original=globalThis.fetch;
 globalThis.fetch=Object.assign(async()=>{calls++;authorized=false;return Response.json({feature_flags:{model_info_registry:'{"Exact-A":{}}'}});},{preconnect:original.preconnect});
 try{
  const result=await new AugmentApiExecutor().execute({model:'Exact-A',body:{messages:[]},stream:false,credentials:{apiKey:'FAKE-caller-fence',providerSpecificData:{apiUrl:'https://fixture.api.augmentcode.com'},augmentAuthorize:async()=>{if(!authorized)throw new Error('caller_policy_revoked');}}});
  expect(result.response.status).toBe(403);expect(calls).toBe(1);
 }finally{globalThis.fetch=original;}
});
