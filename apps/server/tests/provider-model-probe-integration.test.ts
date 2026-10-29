import { test, expect } from 'bun:test';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { stopTestProcess } from './helpers/stop-test-process';

test('real server authenticates UI probe and routes dynamic node to mock upstream without logging credentials', async () => {
 const {createProviderNode, createProviderConnection} = await import('../src/lib/db/providers');
 const {createApiKey} = await import('../src/lib/db/apiKeys');
 const node: any = await createProviderNode({type:'openai-compatible',name:'Probe fixture',prefix:'probefixture',apiType:'chat',baseUrl:'https://probe-fixture.invalid/v1'});
 await createProviderConnection({provider:node.id,authType:'apikey',apiKey:'upstream-fixture-secret',name:'fixture',isActive:true,providerSpecificData:{prefix:'probefixture',apiType:'chat',baseUrl:'https://probe-fixture.invalid/v1'}} as any);
 const key = (await createApiKey('probe-fixture','test-machine')).key;
 const proc=spawn(process.execPath,[join(import.meta.dir,'helpers/provider-model-probe-server.ts')],{cwd:join(import.meta.dir,'..'),env:{...process.env,STYX_TEST_MODE:'1',JWT_SECRET:'fixture-jwt-secret-01234567890123456789',INITIAL_PASSWORD:'fixture-password'},stdio:['ignore','pipe','pipe']});
 let output=''; proc.stdout!.on('data',x=>output+=x); proc.stderr!.on('data',x=>output+=x);
 try {
  const base = await new Promise<string>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('server startup timeout '+output)),30000);proc.stdout!.on('data',()=>{const m=output.match(/STYX_TEST_LISTENING:(\d+)\r?\n/);if(m){clearTimeout(timer);resolve(`http://127.0.0.1:${m[1]}`)}});proc.once('exit',()=>reject(Error('server exited '+output)));});
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'fixture-password'})}); expect(login.status).toBe(200);
  const cookie=login.headers.get('set-cookie')!.split(';')[0];
  const path=`/api/providers/${node.id}/models`;
  expect((await fetch(base+path,{headers:{cookie}})).status).toBe(200);
  expect((await fetch(base+path,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({id:'vendor/model'})})).status).toBe(201);
  const request=(token:string)=>fetch(base+'/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({model:'probefixture/vendor/model',messages:[{role:'user',content:'Reply with OK.'}],max_tokens:8,stream:false})});
  expect((await request('invalid-fixture-secret')).status).toBe(401);
  const response=await request(key); const body:any=await response.json(); expect([response.status,body.choices?.[0]?.message?.content]).toEqual([200,'OK']);
  expect(output).not.toContain(key);expect(output).not.toContain('upstream-fixture-secret');expect(output).not.toContain('invalid-fixture-secret');
  if (process.env.PROBE_PLAYWRIGHT && process.env.PROBE_PANEL_URL) {
   const {chromium} = await import(process.env.PROBE_PLAYWRIGHT);
   const browser = await chromium.launch({executablePath:process.env.PROBE_CHROMIUM,headless:true,args:['--no-sandbox']});
   try {
    const page=await browser.newPage(); let dispatched=0;
    await page.route('**/*',async (route:any)=>{
     const request=route.request(), url=new URL(request.url());
     if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/v1/')) {
      if (url.pathname === '/v1/chat/completions') dispatched++;
      const headers={...request.headers(),cookie}; delete headers.host; delete headers.origin;
      return route.fulfill({response:await route.fetch({url:base+url.pathname+url.search,headers})});
     }
     if(url.origin !== new URL(process.env.PROBE_PANEL_URL!).origin) return route.abort();
     return route.continue();
    });
    await page.goto(`${process.env.PROBE_PANEL_URL}/panel/tests/provider-model-probe.fixture.html?provider=${encodeURIComponent(node.id)}`);
    await page.getByRole('button',{name:'Test model'}).click(); const dialog=page.getByRole('dialog');
    expect(dispatched).toBe(0); expect(await dialog.innerText()).toContain('may incur usage charges');
    await dialog.getByLabel('API key').fill('invalid-fixture-secret'); await dialog.getByRole('button',{name:'Run test'}).click();
    await dialog.getByText(/Invalid API key/).waitFor();
    await dialog.getByLabel('API key').fill(key); await dialog.getByRole('button',{name:'Run test'}).click();
    await dialog.getByText('Test succeeded').waitFor(); expect(dispatched).toBe(2);
    expect(await dialog.getByLabel('API key').inputValue()).toBe('');
    expect(await page.locator('body').innerText()).not.toContain(key);
    expect(output).not.toContain(key); expect(output).not.toContain('upstream-fixture-secret');
   } finally {await browser.close()}
  }
 } finally {await stopTestProcess(proc)}
},60000);
