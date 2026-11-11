import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {known,account} from './redesign-api.fixture.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const out=process.env.REDESIGN_EVIDENCE;await mkdir(out,{recursive:true});
known['/api/keys']={keys:[{id:'r5-key',name:'Workstation access',prefix:'sk-fixture',isActive:true,noLog:true,usageLimitEnabled:true,dailyUsageLimitUsd:5,maxRequestsPerMinute:10,allowedModels:['openai/fixture-model']}]};
known['/api/routing/combos']={combos:[{id:'r5-combo',name:'Coding fallback',enabled:true,strategy:'priority',steps:1,models:['openai/fixture-model']}]};
known['/api/usage/call-logs']=[{id:'r5-call',timestamp:'2026-11-11T00:00:00Z',model:'fixture-model',provider:'openai',account:'Synthetic account',status:200,duration:250}];
known['/api/audit-log']={entries:[{id:5,action:'key.create',actor:'Synthetic admin',timestamp:'2026-11-11T00:00:00Z',target:'Synthetic key',details:{safe:true},status:'ok'}],total:1};
const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});const results=[];
try{for(const width of [320,360,390,600,860,861,1280])for(const theme of ['light','dark'])for(const language of ['en','id']){
 const c=await b.newContext({viewport:{width,height:900},hasTouch:true,reducedMotion:'reduce',serviceWorkers:'block'});const errors=[],writes=[];
 await c.addInitScript(p=>localStorage.setItem('styx-panel-preferences',JSON.stringify(p)),{theme,language,density:'compact'});
 await c.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!=='http://127.0.0.1:5198')return r.abort();if(/^\/(api|v1)\//.test(u.pathname)){if(r.request().method()!=='GET'){writes.push(u.pathname);return r.fulfill({status:501,json:{error:'Unexpected mutation'}});}return r.fulfill({json:known[u.pathname]??{}});}return r.continue();});
 const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(5000);
 for(const route of ['keys','models','routing','activity','audit','tools','settings']){
  await p.goto('http://127.0.0.1:5198/panel/'+route);await p.locator('h1').waitFor();await p.waitForTimeout(80);
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${route} overflow ${width}`);
  if(width<=860&&['keys','models','routing','activity','audit'].includes(route)){
   const list=p.locator('ul.resource-rows');await list.waitFor();const target=list.locator('button').first();assert.ok((await target.boundingBox()).height>=44,'coarse resource target 44');await target.click();await p.locator('.resource-inspector').waitFor();assert.equal(await p.locator('.resource-inspector > h2').evaluate(el=>document.activeElement===el),true,'detail heading owns focus');assert.equal(await p.getByRole('dialog').count(),0);assert.ok(new URL(p.url()).searchParams.has('inspect'));
   await p.reload();await p.locator('.resource-inspector').waitFor();await p.goBack();await list.waitFor();
  }
  if(width<=860){const box=await p.locator('.shell-topbar').boundingBox();assert.equal(box.height,56);}
  if(width===390){await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:`${out}/${route}-${width}-${theme}-${language}.png`,fullPage:true});}
  results.push({route,width,theme,language,pass:true});
 }
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);console.log('PASS seven page resource composition',width,theme,language);await c.close();
}}finally{await b.close();await writeFile(`${out}/matrix.json`,JSON.stringify(results,null,2));}
