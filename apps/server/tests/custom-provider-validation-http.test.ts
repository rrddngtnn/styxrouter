import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestServer } from './helpers/start-test-server';
import { stopTestProcess } from './helpers/stop-test-process';

test('authenticated UUID custom-node credential Test reaches models only, with exact saved definition', async () => {
 const dir=mkdtempSync(join(tmpdir(),'custom-validator-'));
 const calls: {path:string;method:string;auth:string|null;custom:string|null;anthropic:string|null}[]=[];
 let status=200;
 let payload: unknown={data:[{id:'synthetic-model'}]};
 const upstream=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){calls.push({path:new URL(req.url).pathname,method:req.method,auth:req.headers.get('authorization'),custom:req.headers.get('x-fixture'),anthropic:req.headers.get('x-api-key')});return Response.json(status===200?payload:{error:'synthetic rejection'},{status,headers:status===302?{location:'/must-not-follow'}:{}});}});
 const {proc,base}=await startTestServer(process.execPath,{cwd:join(import.meta.dir,'..'),env:{...process.env,DATA_DIR:dir,STYX_TEST_MODE:'1',JWT_SECRET:'synthetic-validator-jwt-0123456789',INITIAL_PASSWORD:'synthetic-validator-password',STORAGE_ENCRYPTION_KEY:'synthetic-validator-encryption'}});
 try {
  let cookie='';
  const post=(path:string,body:unknown)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{}),origin:base},body:JSON.stringify(body)});
  const login=await post('/api/auth/login',{password:'synthetic-validator-password'});expect(login.status).toBe(200);cookie=login.headers.get('set-cookie')!.split(';')[0]!;
  const created=await post('/api/provider-nodes',{type:'openai-compatible',name:'Synthetic UUID validator',prefix:'uuidvalidator',apiType:'chat',baseUrl:`http://127.0.0.1:${upstream.port}/v1`,modelsPath:'/v1/custom-models',customHeaders:{'x-fixture':'definition-header'}});expect(created.status).toBe(201);
  const {node}=await created.json() as any;expect(node.id).toMatch(/^[0-9a-f-]{36}$/);
  const saved=await post('/api/connections',{provider:node.id,name:'Synthetic account',apiKey:'synthetic-validator-key'});expect(saved.status).toBe(201);
  const connection=await saved.json() as any;
  expect((await fetch(base+`/api/connections/${connection.id}/test`,{method:'POST'})).status).toBe(401);
  const tested=await post(`/api/connections/${connection.id}/test`,{});expect(tested.status).toBe(200);expect(await tested.json()).toEqual({ok:true,error:null});
  expect(calls).toEqual([{path:'/v1/custom-models',method:'GET',auth:'Bearer synthetic-validator-key',custom:'definition-header',anthropic:null}]);
  for(const rejected of [401,403,404,429,500]) {status=rejected;const result=await (await post(`/api/connections/${connection.id}/test`,{})).json() as any;expect(result.ok).toBe(false);expect(result.error).toBeTruthy();}
  expect(calls).toHaveLength(6);expect(calls.every(c=>c.method==='GET')).toBe(true);
  status=200;
  const a=await (await post('/api/provider-nodes',{type:'anthropic-compatible',name:'Synthetic Anthropic',prefix:'anthfixture',baseUrl:`http://127.0.0.1:${upstream.port}/v1`,modelsPath:'/v1/models'})).json() as any;
  const ac=await (await post('/api/connections',{provider:a.node.id,name:'Synthetic Anthropic key',apiKey:'synthetic-anthropic-only'})).json() as any;
  expect(await (await post(`/api/connections/${ac.id}/test`,{})).json()).toEqual({ok:true,error:null});
  expect(calls.at(-1)).toEqual({path:'/v1/models',method:'GET',auth:null,custom:null,anthropic:'synthetic-anthropic-only'});
  status=302;const before=calls.length;
  expect((await (await post(`/api/connections/${connection.id}/test`,{})).json() as any).ok).toBe(false);
  expect(calls.length-before).toBe(1);expect(calls.some(c=>c.path==='/must-not-follow')).toBe(false);
  status=200;payload={unexpected:'not a models list'};
  expect((await (await post(`/api/connections/${connection.id}/test`,{})).json() as any).ok).toBe(false);

 } finally {await stopTestProcess(proc);upstream.stop(true);rmSync(dir,{recursive:true,force:true});}
},60000);
