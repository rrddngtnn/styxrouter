import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {known} from './redesign-api.fixture.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
known['/api/usage/call-logs']=[{id:'r5-call',timestamp:'2026-11-11T00:00:00Z',model:'fixture-model',provider:'openai',status:200,duration:250}];
known['/api/audit-log']={entries:[{id:5,action:'fixture.read',actor:'fixture',timestamp:'2026-11-11T00:00:00Z',target:'Synthetic fixture',details:{safe:true},status:'ok'}],total:1};
known['/api/routing/combos']={combos:[{id:'r5-combo',name:'Synthetic r5 combo',enabled:true,strategy:'priority',steps:1,models:['openai/fixture-model']}]};
known['/api/keys']={keys:[{id:'r5-key',name:'Synthetic r5 key',prefix:'sk-fixture',isActive:true,noLog:true,maxRequestsPerMinute:10}]};
const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const out=process.env.REDESIGN_EVIDENCE;await mkdir(out,{recursive:true});
try {
 const p=await b.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});const writes=[];
 await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.hostname!=='127.0.0.1')return r.abort();if(/^\/(api|v1)\//.test(u.pathname)){if(r.request().method()!=='GET'){writes.push(u.pathname);return r.fulfill({json:{ok:true}});}if(Object.hasOwn(known,u.pathname))return r.fulfill({json:known[u.pathname]});return r.fulfill({json:{}});}return r.continue();});
 await p.goto('http://127.0.0.1:5198/panel/keys?keep=r5');
 await p.getByRole('list',{name:'API keys'}).waitFor({timeout:4000});
 assert.equal(await p.locator('tbody tr').count(),0);
 await p.getByRole('list',{name:'API keys'}).getByRole('button').first().click();
 await p.locator('.resource-inspector').waitFor();assert.ok(new URL(p.url()).searchParams.get('inspect'));assert.equal(new URL(p.url()).searchParams.get('keep'),'r5');
 assert.equal(await p.getByRole('dialog').count(),0);await p.goBack();await p.getByRole('list',{name:'API keys'}).waitFor();assert.equal(writes.length,0);
 await p.goto('http://127.0.0.1:5198/panel/audit?keep=r5');
 await p.getByRole('list',{name:'Audit entries'}).waitFor({timeout:4000});await p.getByRole('list',{name:'Audit entries'}).getByRole('button').first().click();await p.locator('.resource-inspector').waitFor();assert.equal(await p.getByRole('dialog').count(),0);assert.ok(new URL(p.url()).searchParams.get('inspect'));await p.goBack();await p.getByRole('list',{name:'Audit entries'}).waitFor();
 await p.goto('http://127.0.0.1:5198/panel/activity?keep=r5');await p.getByRole('list',{name:'Requests'}).waitFor({timeout:4000});await p.getByRole('list',{name:'Requests'}).getByRole('button').first().click();await p.locator('.resource-inspector').waitFor();assert.equal(await p.getByRole('dialog').count(),0);await p.goBack();await p.getByRole('list',{name:'Requests'}).waitFor();assert.equal(writes.length,0);
 await p.goto('http://127.0.0.1:5198/panel/routing?keep=r5');await p.getByRole('list',{name:'Routing combos'}).waitFor({timeout:4000});await p.getByRole('list',{name:'Routing combos'}).getByRole('button').first().click();await p.locator('.resource-inspector').waitFor();assert.equal(await p.getByRole('dialog').count(),0);await p.goBack();await p.getByRole('list',{name:'Routing combos'}).waitFor();assert.equal(writes.length,0);
 await p.goto('http://127.0.0.1:5198/panel/models?keep=r5');await p.getByRole('list',{name:'Models'}).waitFor({timeout:4000});await p.getByRole('list',{name:'Models'}).getByRole('button').first().click();await p.locator('.resource-inspector').waitFor();assert.equal(await p.getByRole('dialog').count(),0);await p.goBack();await p.getByRole('list',{name:'Models'}).waitFor();assert.equal(await p.locator('.resource-inspector:visible').count(),0,'Back closes model inspector');assert.equal(writes.length,0);
 await p.goto('http://127.0.0.1:5198/panel/settings?keep=r5');await p.getByLabel('Settings sections',{exact:true}).selectOption('security');await p.getByRole('heading',{name:'Management password'}).waitFor({timeout:2000});assert.equal(new URL(p.url()).searchParams.get('tab'),'security');
 await p.goto('http://127.0.0.1:5198/panel/tools?keep=r5');await p.getByLabel('Integration mode',{exact:true}).selectOption('harnesses');await p.getByLabel('Client tools',{exact:true}).selectOption('codex');assert.equal(writes.length,0);
 await p.goto('http://127.0.0.1:5198/panel/keys');await p.getByRole('list',{name:'API keys'}).waitFor();await p.getByRole('button',{name:'Select',exact:true}).click();await p.getByRole('button',{name:'Cancel selection',exact:true}).click();
 known['/api/connections']={connections:Array.from({length:30},(_,i)=>({id:`anchor-${i}`,provider:'openai',name:`Anchor account ${i}`,authType:'apikey',isActive:true,testStatus:null,backoffLevel:0}))};
 await p.goto('http://127.0.0.1:5198/panel/providers/openai?auth=apikey');await p.getByRole('list',{name:'Connected accounts'}).waitFor();await p.evaluate(()=>history.scrollRestoration='manual');const anchor=p.getByRole('button',{name:'Anchor account 8',exact:true});await anchor.scrollIntoViewIfNeeded();const offset=await anchor.evaluate(el=>el.getBoundingClientRect().top);await anchor.click();await p.locator('.account-inspect').waitFor();await p.reload();await p.locator('.account-inspect').waitFor();await p.goto('http://127.0.0.1:5198/panel/keys');await p.goBack();await p.locator('.account-inspect').waitFor();await p.goBack();await p.getByRole('list',{name:'Connected accounts'}).waitFor();await p.waitForTimeout(150);const restored=await p.getByRole('button',{name:'Anchor account 8',exact:true}).evaluate(el=>el.getBoundingClientRect().top);assert.ok(Math.abs(restored-offset)<10,`anchor restored ${restored} vs ${offset}`);
 await p.goto('http://127.0.0.1:5198/panel/tools');await p.locator('.tools-snippet-head').first().waitFor();for(const header of await p.locator('.tools-snippet-head').all()){assert.ok(await header.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'snippet header contains Copy');}
 await p.goto('http://127.0.0.1:5198/panel/settings');await p.locator('.cli-version-section').first().waitFor();assert.equal(await p.locator('.cli-version-section[open]').count(),0);await p.locator('.cli-version-section summary').first().click();await p.getByLabel('ZCode CLI Pinned version',{exact:true}).waitFor();
 console.log('PASS Keys mobile rows/detail/history without writes');
}finally{await b.close();}
