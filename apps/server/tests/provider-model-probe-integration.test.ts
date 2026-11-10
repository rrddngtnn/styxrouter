import "./helpers/test-secrets";
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
 const proc=spawn(process.execPath,['--no-env-file',join(import.meta.dir,'helpers/provider-model-probe-server.ts')],{cwd:join(import.meta.dir,'..'),env:{...process.env,STYX_TEST_MODE:'1',JWT_SECRET:'fixture-jwt-secret-01234567890123456789',INITIAL_PASSWORD:'fixture-password'},stdio:['ignore','pipe','pipe']});
 let output=''; proc.stdout!.on('data',x=>output+=x); proc.stderr!.on('data',x=>output+=x);
 try {
  const base = await new Promise<string>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('server startup timeout '+output)),30000);proc.stdout!.on('data',()=>{const m=output.match(/STYX_TEST_LISTENING:(\d+)\r?\n/);if(m){clearTimeout(timer);resolve(`http://127.0.0.1:${m[1]}`)}});proc.once('exit',()=>reject(Error('server exited '+output)));});
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'fixture-password'})}); expect(login.status).toBe(200);
  const cookie=login.headers.get('set-cookie')!.split(';')[0];
  const path=`/api/providers/${node.id}/models`;
  expect((await fetch(base+path,{headers:{cookie}})).status).toBe(200);
  expect((await fetch(base+path,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({id:'vendor/model'})})).status).toBe(201);
  const probeArgs={method:'POST',headers:{cookie,origin:base,'content-type':'application/json','x-route-model':'probefixture/attacker'},body:JSON.stringify({model:'probefixture/vendor/model'})};
  expect((await fetch(base+'/api/model-test',{...probeArgs,headers:{origin:base,'content-type':'application/json'}})).status).toBe(401);
  const probe = await fetch(base+'/api/model-test',probeArgs);
  expect([probe.status,await probe.json()]).toEqual([200,{ok:true}]);
  expect((await fetch(base+'/api/model-test',probeArgs)).status).toBe(429);
  expect(output).not.toContain('PROBE_SUCCESS_SENTINEL_9467');
  const request=(token:string)=>fetch(base+'/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({model:'probefixture/vendor/model',messages:[{role:'user',content:'Reply with OK.'}],max_tokens:8,stream:false})});
  expect((await fetch(base+'/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json','x-styx-exact-target-probe':'true'},body:probeArgs.body})).status).toBe(401);
  expect((await request('invalid-fixture-secret')).status).toBe(401);
  const response=await request(key); const body:any=await response.json(); expect([response.status,body.choices?.[0]?.message?.content]).toEqual([200,'PROBE_SUCCESS_SENTINEL_9467']);

  if (process.env.PROBE_PLAYWRIGHT && process.env.PROBE_PANEL_URL) {
   const {chromium} = await import(process.env.PROBE_PLAYWRIGHT);
   const browser = await chromium.launch({executablePath:process.env.PROBE_CHROMIUM,headless:true,args:['--no-sandbox']});
   try {
    const page=await browser.newPage(); let dispatched=0;
    await page.route('**/*',async (route:any)=>{
     const request=route.request(), url=new URL(request.url());
     if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/v1/')) {
      if (url.pathname === '/api/model-test') { dispatched++; expect(request.postDataJSON()).toEqual({model:'probefixture/vendor/model'}); }
      const headers={...request.headers(),cookie}; delete headers.host; delete headers.origin;
      if (url.pathname === '/api/model-test') headers.origin = base;
      return route.fulfill({response:await route.fetch({url:base+url.pathname+url.search,headers})});
     }
     if(url.origin !== new URL(process.env.PROBE_PANEL_URL!).origin) return route.abort();
     return route.continue();
    });
    await page.goto(`${process.env.PROBE_PANEL_URL}/panel/tests/provider-model-probe.fixture.html?provider=${encodeURIComponent(node.id)}`);
    await page.locator('[data-model-id="vendor/model"]').getByRole('button',{name:'Test model'}).click(); const dialog=page.getByRole('dialog');
    expect(dispatched).toBe(0); expect(await dialog.innerText()).toContain('may incur usage charges');
    expect(await dialog.getByLabel('API key').count()).toBe(0);
    await Bun.sleep(5100);
    const browserResponse = page.waitForResponse((r:any) => new URL(r.url()).pathname === '/api/model-test');
    await dialog.getByRole('button',{name:'Run test'}).click();
    const probeResponse = await browserResponse;
    expect([probeResponse.status(), await probeResponse.text()]).toEqual([200, '{"ok":true}']);
    await dialog.getByText('Test succeeded').waitFor(); expect(dispatched).toBe(1);
    expect(await page.locator('body').innerText()).not.toContain(key);
    expect(output).not.toContain(key); expect(output).not.toContain('upstream-fixture-secret');
   } finally {await browser.close()}
  }
  // Run the synthetic upstream 404 last: it can cool down this connection,
  // which otherwise contaminates the subsequent successful browser probe.
  expect((await fetch(base+path,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({id:'vendor/fail'})})).status).toBe(201);
  await Bun.sleep(5100);
  const failedProbe = await fetch(base+'/api/model-test',{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify({model:'probefixture/vendor/fail'})});
  expect(failedProbe.ok).toBe(false);
  expect(output).not.toContain('PROBE_ERROR_SENTINEL_9467');
  expect(output).not.toContain(key);expect(output).not.toContain('upstream-fixture-secret');expect(output).not.toContain('invalid-fixture-secret');
 } finally {await stopTestProcess(proc)}
},60000);
