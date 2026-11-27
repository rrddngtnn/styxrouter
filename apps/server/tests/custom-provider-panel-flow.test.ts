import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestServer } from './helpers/start-test-server';
import { stopTestProcess } from './helpers/stop-test-process';

test('real panel create, canonical key handoff, models validation and authoritative rejection', async () => {
 const dir=mkdtempSync(join(tmpdir(),'custom-panel-'));
 const calls: {path:string;method:string;auth:string|null}[]=[];
 let upstreamStatus=200;
 const upstream=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){calls.push({path:new URL(req.url).pathname,method:req.method,auth:req.headers.get('authorization')});return Response.json(upstreamStatus===200?{data:[{id:'synthetic-model'}]}:{error:'never echo upstream body or credential'},{status:upstreamStatus});}});
 const {proc,base}=await startTestServer(process.execPath,{cwd:join(import.meta.dir,'..'),env:{...process.env,DATA_DIR:dir,JWT_SECRET:'synthetic-panel-signing-only-0123456789',INITIAL_PASSWORD:'synthetic-panel-password',STORAGE_ENCRYPTION_KEY:'synthetic-panel-encryption-only'}});
 let vite:any,browser:any;
 try {
  const {build}=await import('../../panel/node_modules/vite/dist/node/index.js');
  const dist=join(dir,'panel-dist');await build({root:join(import.meta.dir,'../../panel'),cacheDir:join(dir,'vite-cache'),configFile:false,esbuild:{jsx:'automatic'},base:'/panel/',build:{outDir:dist,emptyOutDir:true}});
  vite=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){const u=new URL(req.url);if(u.pathname.startsWith('/api/')){const h=new Headers(req.headers);return fetch(base+u.pathname+u.search,{method:req.method,headers:h,body:req.body,redirect:'manual'});}const file=Bun.file(join(dist,u.pathname.replace(/^\/panel\//,'')));return new Response(await file.exists()?file:Bun.file(join(dist,'index.html')));}});
  const {chromium}=await import(process.env.PLAYWRIGHT_MODULE!);
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,env:{...process.env,TMPDIR:process.env.STYX_BROWSER_TMPDIR || process.env.TMPDIR!},args:['--no-sandbox']});
  const page=await browser.newPage({reducedMotion:'reduce'});page.setDefaultTimeout(10000);
  const origin=`http://127.0.0.1:${vite.port}`;
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto(origin+'/panel/login');
  await page.evaluate(async()=>{await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'synthetic-panel-password'})});});
  await page.goto(origin+'/panel/providers?tab=custom');
  const create=async(name:string)=>{await page.getByRole('button',{name:'New custom provider',exact:true}).first().click();const d=page.getByRole('dialog');await d.getByLabel('Name',{exact:true}).fill(name);await d.getByLabel('Request prefix',{exact:true}).fill('realfixture');await d.getByLabel('Base URL',{exact:true}).fill(`http://127.0.0.1:${upstream.port}/v1`);await d.getByRole('button',{name:'Create & add API key',exact:true}).click();};
  await create('Real fixture endpoint');
  const modal=page.getByRole('dialog',{name:'Add API key — Real fixture endpoint'});await modal.waitFor();
  const providerId=new URL(page.url()).pathname.split('/').at(-1)!;expect(providerId).toMatch(/^[0-9a-f-]{36}$/);
  expect(await modal.getByLabel('API key / token').getAttribute('type')).toBe('password');
  await modal.getByLabel('API key / token').fill('synthetic-browser-key-only');await modal.getByRole('button',{name:'Save key',exact:true}).click();await modal.waitFor({state:'hidden'});
  const connections=await page.evaluate(async()=>await (await fetch('/api/connections')).json());expect(connections.connections).toHaveLength(1);expect(connections.connections[0].provider).toBe(providerId);expect(JSON.stringify(connections)).not.toContain('synthetic-browser-key-only');
  const testKey=page.getByRole('button',{name:'Test',exact:true});await testKey.click();await page.getByText('key works ✓',{exact:true}).waitFor();
  expect(calls).toEqual([{path:'/v1/models',method:'GET',auth:'Bearer synthetic-browser-key-only'}]);
  upstreamStatus=403;await testKey.click();await page.getByText('failed: Models endpoint refused credential validation (HTTP 403)',{exact:true}).waitFor();expect(calls).toHaveLength(2);
  await page.goto(origin+'/panel/providers?tab=custom');await create('Duplicate fixture');
  await page.getByRole('alert').getByText('Provider node prefix already exists',{exact:true}).waitFor();
  expect(await page.getByRole('button',{name:'Create & add API key',exact:true}).isEnabled()).toBe(true);
  const nodes=await page.evaluate(async()=>await (await fetch('/api/provider-nodes')).json());expect(nodes.nodes).toHaveLength(1);
  // A response envelope named provider is not the actual canonical node contract.
  // Malformed success and lost responses must keep the duplicate-write fence.
  for (const response of [{provider:{id:'invented'}},{node:{id:123}},null]) {
   page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Cancel',exact:true}).click();
   let attempted=0;
   await page.route('**/api/provider-nodes',async route=>{if(route.request().method()!=='POST')return route.continue();attempted++;return response===null?route.abort('failed'):route.fulfill({status:201,json:response});});
   await create('Uncertain fixture');await page.getByRole('alert').getByText('Creation was not confirmed. Close and reload the provider list before creating again.',{exact:true}).waitFor();
   expect(await page.getByRole('button',{name:'Create & add API key',exact:true}).isDisabled()).toBe(true);
   await page.getByRole('dialog').evaluate(form=>form.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(attempted).toBe(1);
   await page.unroute('**/api/provider-nodes');
  }
 } finally {await browser?.close();await vite?.stop(true);await stopTestProcess(proc);upstream.stop(true);rmSync(dir,{recursive:true,force:true});}
},90000);
