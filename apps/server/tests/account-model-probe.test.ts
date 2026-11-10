import './helpers/test-secrets';
import { test, expect } from 'bun:test';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { stopTestProcess } from './helpers/stop-test-process';

test('session inference pins the selected account and canonical model without a user API key', async () => {
 const { createProviderNode, createProviderConnection } = await import('../src/lib/db/providers');
 const { addCustomModel } = await import('../src/lib/db/models');
 const node:any = await createProviderNode({type:'openai-compatible',name:'Account probe',prefix:'accountprobe',apiType:'chat',baseUrl:'https://probe-fixture.invalid/v1'});
 // A higher-priority account must never win the explicit pin.
 await createProviderConnection({provider:node.id,authType:'apikey',apiKey:'wrong-fixture-secret',providerSpecificData:{baseUrl:node.baseUrl,apiType:'chat',prefix:node.prefix},priority:1} as any);
 const selected:any = await createProviderConnection({provider:node.id,authType:'apikey',apiKey:'upstream-fixture-secret',providerSpecificData:{baseUrl:node.baseUrl,apiType:'chat',prefix:node.prefix},priority:20} as any);
 await addCustomModel(node.id,'vendor/model');
 const proc=spawn(process.execPath,['--no-env-file',join(import.meta.dir,'helpers/provider-model-probe-server.ts')],{cwd:join(import.meta.dir,'..'),env:{...process.env,STYX_TEST_MODE:'1',JWT_SECRET:'fixture-jwt-secret-01234567890123456789',INITIAL_PASSWORD:'fixture-password'},stdio:['ignore','pipe','pipe']});
 let output='';proc.stdout!.on('data',x=>output+=x);proc.stderr!.on('data',x=>output+=x);
 try {
 const base=await new Promise<string>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout')),30000);proc.stdout!.on('data',()=>{const m=output.match(/STYX_TEST_LISTENING:(\d+)\r?\n/);if(m){clearTimeout(timer);resolve(`http://127.0.0.1:${m[1]}`)}})});
 const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'fixture-password'})});
 const cookie=login.headers.get('set-cookie')!.split(';')[0];
 const send=(body:any,headers:any={cookie,origin:base})=>fetch(base+'/api/model-test',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
 const body={model:'accountprobe/vendor/model',connectionId:selected.id};
 expect((await send(body,{origin:base})).status).toBe(401);
 expect((await send(body,{cookie,origin:'https://foreign.invalid'})).status).toBe(403);
 const response=await send(body); const result:any=await response.json();
 expect({status:response.status,result,output}).toMatchObject({status:200});
 expect(result).toMatchObject({ok:true,status:'success',connectionId:selected.id,model:body.model,finishReason:'stop',output:'PROBE_SUCCESS_SENTINEL_9467',usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});
 expect(Number.isNaN(Date.parse(result.observedAt))).toBe(false);
 expect(output).not.toContain('PROBE_SUCCESS_SENTINEL_9467');
 expect(output).not.toContain('upstream-fixture-secret');
 expect((await send(body)).status).toBe(429);
 await Bun.sleep(5100);
 const rejectedId=(await createProviderConnection({provider:node.id,authType:'apikey',apiKey:'reject-fixture-key',providerSpecificData:{baseUrl:node.baseUrl,apiType:'chat',prefix:'accountprobe'}} as any)).id;
 const failed=await send({...body,connectionId:rejectedId});
 await Bun.sleep(100);
 const {getProviderConnectionById}=await import('../src/lib/db/providers');
 expect((await getProviderConnectionById(rejectedId) as any).lastError ?? '').not.toContain('PROBE_ERROR_SENTINEL_9467');
 expect(failed.ok).toBe(false);
 expect((await failed.json() as any).status).toBe('failed');
 } finally { await stopTestProcess(proc); }
},60000);
