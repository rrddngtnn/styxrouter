import { expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { stopTestProcess } from './helpers/stop-test-process';

test('two actual servers share generation across HTTP mutation and cached read', async () => {
 const env={...process.env, STYX_TEST_MODE:'1', JWT_SECRET:'fixture-jwt-secret-01234567890123456789', INITIAL_PASSWORD:'fixture-password', STORAGE_ENCRYPTION_KEY:'fixture-encryption-key'};
 const start=async()=>{
  const proc=spawn(process.execPath,[`${import.meta.dir}/helpers/connection-cache-review-server.ts`],{cwd:`${import.meta.dir}/..`,env,stdio:['ignore','pipe','pipe']});
  let out='',err=''; proc.stderr!.on('data',c=>err+=c);
  try { const port=await new Promise<string>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout '+err.slice(-2000))),30000); proc.once('exit',()=>{clearTimeout(timer);reject(Error('server exit '+err.slice(-2000)))});proc.stdout!.on('data',c=>{out+=c; const m=out.match(/STYX_TEST_LISTENING:(\d+)/);if(m){clearTimeout(timer);resolve(m[1]!);}})}); return {proc,base:`http://127.0.0.1:${port}`}; } catch(e) { await stopTestProcess(proc); throw e; }
 };
 const a=await start(); let b:Awaited<ReturnType<typeof start>>|undefined;
 try {
  b=await start();
  const post=(base:string,path:string,body:unknown,cookie='')=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)});
  const login=await post(b.base,'/api/auth/login',{password:'fixture-password'}); expect(login.status).toBe(200); const cookie=login.headers.get('set-cookie')!.split(';')[0]!;
  const created=await post(b.base,'/api/connections',{provider:'openai',name:'before',apiKey:'fixture-key'},cookie); expect(created.status).toBe(201); const {id}=await created.json() as {id:string};
  const read=async()=>((await (await fetch(a.base+'/__test/cache')).json()) as any[]).find(x=>x.id===id);
  expect((await read()).name).toBe('before');
  const mutation=await post(b.base,'/api/connections/bulk-rename',{ids:[id],pattern:'after'},cookie); expect(mutation.status).toBe(200); expect((await mutation.json() as any).results[0].success).toBe(true);
  expect((await read()).name).toBe('after');
 } finally {if(b) await stopTestProcess(b.proc); await stopTestProcess(a.proc);}
},90000);
