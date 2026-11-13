import './helpers/test-secrets';
import { expect, test, mock } from 'bun:test';
// Exercise real Hono authentication, origin enforcement and management handler;
// fence the inference boundary to capture its actual Request and deadline.
test('authenticated Hydrogen management endpoint sends 32768 with a 60-second deadline', async () => {
 process.env.INITIAL_PASSWORD = 'fixture-panel-password';
 process.env.JWT_SECRET = 'fixture-panel-secret-0123456789012345';
 const chat = await import('../src/sse/handlers/chat.ts');
 const models = await import('../server/providerModels.ts');
 let captured: any;
 mock.module('../src/sse/handlers/chat.ts', () => ({...chat, handleChat: async (request:Request) => {
  captured = await request.json();
  return Response.json({choices:[{message:{role:'assistant',content:'OK'},finish_reason:'stop'}]});
 }}));
 mock.module('../server/providerModels.ts', () => ({...models,isExplicitProviderModel:async (model:string)=>model==='antigravity/gemini-4-hydrogen-high'}));
 globalThis.fetch = async () => { throw new Error('external network forbidden'); };
 const {default:config} = await import('../server/styx.ts');
 const base='http://127.0.0.1:39127';
 const call=(path:string,body:unknown,headers:Record<string,string>={})=>config.fetch(new Request(base+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)}));
 const login=await call('/api/auth/login',{password:process.env.INITIAL_PASSWORD});
 expect(login.status).toBe(200);
 const cookie=login.headers.get('set-cookie')!.split(';')[0];
 const model='antigravity/gemini-4-hydrogen-high';
 expect((await call('/api/model-test',{model},{origin:base})).status).toBe(401);
 expect((await call('/api/model-test',{model},{cookie,origin:'http://foreign.invalid'})).status).toBe(403);
 const original=globalThis.setTimeout;
 const deadlines:number[]=[];
 globalThis.setTimeout=((fn:any,delay:any,...args:any[])=>{deadlines.push(delay);return original(fn,delay,...args)}) as typeof setTimeout;
 try {
  const response=await call('/api/model-test',{model},{cookie,origin:base});
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ok:true});
  expect(captured.model).toBe(model);
  expect(captured.max_tokens).toBe(32768);
  expect(captured.stream).toBe(false);
  expect(deadlines).toContain(60000);
 } finally {globalThis.setTimeout=original;}
});
