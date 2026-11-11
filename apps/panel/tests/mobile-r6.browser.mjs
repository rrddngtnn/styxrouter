import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {known} from './redesign-api.fixture.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const out=process.env.REDESIGN_EVIDENCE;await mkdir(out,{recursive:true});
known['/api/usage/call-logs']=Array.from({length:45},(_,i)=>({id:`call-${i}`,timestamp:'2026-11-11T00:00:00Z',model:`Model ${i}`,provider:'openai',status:i%2?500:200,duration:100}));
known['/api/audit-log']={entries:Array.from({length:45},(_,i)=>({id:i+1,action:i%2?'key.create':'settings.update',actor:'fixture',timestamp:'2026-11-11T00:00:00Z',target:`Target ${i}`,details:{safe:true},status:'ok'})),total:145};
known['/v1/models']={data:Array.from({length:45},(_,i)=>({id:`openai/model-${i}`,owned_by:'openai',providerId:'openai',localId:`model-${i}`,name:`Model ${i}`,type:i%2?'embedding':'chat',supportsVision:true}))};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});const results=[];let writes=0;
try{for(const width of [320,360,390,1280])for(const theme of ['light','dark']){
 const p=await browser.newPage({viewport:{width,height:844},reducedMotion:'reduce'});
 await p.addInitScript(theme=>localStorage.setItem('styx-panel-preferences',JSON.stringify({theme,language:'en',density:'compact'})),theme);
 await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.hostname!=='127.0.0.1')return r.abort();if(/^\/(api|v1)\//.test(u.pathname)){if(r.request().method()!=='GET'){writes++;return r.abort();}return r.fulfill({json:known[u.pathname]??{}});}return r.continue();});
 for(const [route,label,field,value] of [['models','Models','Filter by type','embedding'],['activity','Requests','Fetch window','100'],['audit','Audit entries','Filter by action','key.create']]){
 await p.goto(`http://127.0.0.1:5198/panel/${route}?keep=r6`);await p.getByRole(width<=860?'list':'table').first().waitFor();
 if(width<=860){
 const trigger=p.getByRole('button',{name:/^Filters/});await trigger.click();await p.getByRole('dialog').getByLabel(field,{exact:true}).selectOption(value);await p.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(new URL(p.url()).searchParams.get(route==='models'?'type':route==='activity'?'limit':'action'),null);
 await trigger.click();await p.getByRole('dialog').getByLabel(field,{exact:true}).selectOption(value);await p.keyboard.press('Escape');assert.equal(await p.getByRole('dialog').count(),0);
 await trigger.click();await p.getByRole('dialog').getByLabel(field,{exact:true}).selectOption(value);await p.getByRole('button',{name:'Apply filters',exact:true}).click();
 const key=route==='models'?'type':route==='activity'?'limit':'action';assert.equal(new URL(p.url()).searchParams.get(key),value);assert.equal(new URL(p.url()).searchParams.get('keep'),'r6');
 await p.goBack();await trigger.click();assert.notEqual(await p.getByRole('dialog').getByLabel(field,{exact:true}).inputValue(),value);await p.keyboard.press('Escape');await p.goForward();
 await p.reload();await p.getByRole('list',{name:label,exact:true}).waitFor();await trigger.click();assert.equal(await p.getByRole('dialog').getByLabel(field,{exact:true}).inputValue(),value);await p.keyboard.press('Escape');
 await p.getByRole('list',{name:label,exact:true}).getByRole('button').first().click();await p.locator('.resource-inspector').waitFor();const id=new URL(p.url()).searchParams.get('inspect');await p.goBack();await p.getByRole('list',{name:label,exact:true}).waitFor();await p.goForward();await p.locator('.resource-inspector').waitFor();assert.equal(new URL(p.url()).searchParams.get('inspect'),id);await p.goBack();
 }else{assert.ok(await p.getByLabel(field,{exact:true}).isVisible());assert.equal(await p.getByRole('button',{name:/^Filters/}).count(),0);}
 assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await p.screenshot({path:`${out}/${route}-${width}-${theme}.png`,fullPage:true});results.push({route,width,theme});
 }
 await p.goto('http://127.0.0.1:5198/panel/tools?keep=r6');await p.locator('.tools-snippet-card').first().waitFor();
 const snippet=p.locator('.tools-snippet-card');const example=p.getByRole('combobox',{name:/^Example/});
 assert.equal(await snippet.count(),1);assert.ok((await snippet.locator('strong').innerText()).trim());assert.ok((await snippet.locator('pre').innerText()).trim());
 assert.equal(await p.getByRole('combobox',{name:/^Client tools/}).inputValue(),'claude-code');assert.match(await snippet.innerText(),/ANTHROPIC_BASE_URL/);
 if(await example.count())assert.ok(await example.locator('option').count()>1,'selector is useful only for multiple recipes');
 else assert.ok((await snippet.locator('pre').innerText()).trim(),'single recipe stays usable without selector');
 for(const label of ['Router base URL','Client API key','Target model'])assert.ok(await p.locator('.tools-settings').getByLabel(label,{exact:false}).isVisible());
 assert.ok(await p.getByRole('button',{name:'Generate key for Claude Code',exact:true}).isVisible());assert.ok(await p.getByRole('button',{name:'Router request test',exact:true}).isVisible());
 await p.getByRole('combobox',{name:/^Client tools/}).selectOption('python');await p.waitForFunction(()=>document.querySelector('.tools-snippet-card pre')?.textContent?.includes('from openai import OpenAI'));await example.waitFor();assert.ok(await example.locator('option').count()>1);
 await example.selectOption('1');await p.waitForFunction(()=>document.querySelector('.tools-snippet-card pre')?.textContent?.includes('import OpenAI from'));assert.equal(await snippet.count(),1);assert.equal(new URL(p.url()).searchParams.get('example'),'1');assert.equal(new URL(p.url()).searchParams.get('client'),'python');assert.match(await snippet.locator('pre').innerText(),/import OpenAI from/);assert.equal(await snippet.locator('strong').innerText(),await example.locator('option:checked').innerText());
 assert.ok(await example.evaluate(el=>{const r=el.getBoundingClientRect();return r.right<=innerWidth&&r.left>=0}),'example selector contains its arrow');await p.reload();assert.equal(await example.inputValue(),'1');assert.equal(await p.getByRole('combobox',{name:/^Client tools/}).inputValue(),'python');assert.match(await snippet.locator('pre').innerText(),/import OpenAI from/);
 await p.getByRole('tab',{name:'Network access',exact:true}).click();await p.getByLabel('SSH port',{exact:true}).waitFor();assert.equal(await p.locator('.tools-page').getByLabel('Client API key',{exact:false}).count(),0);assert.equal(await p.getByRole('button',{name:'Router request test',exact:true}).count(),0);assert.ok(await p.getByLabel('SSH port',{exact:true}).isVisible());
 await p.getByRole('tab',{name:'Connect client',exact:true}).click();await p.screenshot({path:`${out}/tools-${width}-${theme}.png`,fullPage:true});await p.close();
 }
 const p=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
 await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.hostname!=='127.0.0.1')return r.abort();if(/^\/(api|v1)\//.test(u.pathname)){if(r.request().method()!=='GET'){writes++;return r.abort();}if(u.pathname==='/api/model-metadata')return r.fulfill({json:{model:{provider:'openai',modelId:new URL(r.request().url()).searchParams.get('modelId'),contextWindow:128000,supportsThinking:false,supportsVision:true,supportsTools:true,overrides:{contextWindow:null,supportsThinking:null,supportsVision:null,supportsTools:null}}}});return r.fulfill({json:known[u.pathname]??{}});}return r.continue();});
 await p.goto('http://127.0.0.1:5198/panel/models');await p.getByRole('list',{name:'Models',exact:true}).getByRole('button').first().click();await p.getByLabel('Context window (tokens)',{exact:true}).fill('42');
 let nativeDialogs=0;p.on('dialog',async d=>{nativeDialogs++;await d.dismiss();});const confirmation=p.locator('.styx-confirmation');
 await p.evaluate(()=>history.back());await confirmation.waitFor();assert.match(await confirmation.innerText(),/Discard/);await confirmation.getByRole('button',{name:'Cancel',exact:true}).click();await confirmation.waitFor({state:'hidden'});assert.ok(new URL(p.url()).searchParams.get('inspect'));assert.equal(await p.getByLabel('Context window (tokens)',{exact:true}).inputValue(),'42');assert.equal(writes,0);
 await p.evaluate(()=>history.back());await confirmation.waitFor();await confirmation.getByRole('button',{name:'Discard changes',exact:true}).click();await p.getByRole('list',{name:'Models',exact:true}).waitFor();assert.equal(new URL(p.url()).searchParams.get('inspect'),null);assert.equal(nativeDialogs,0,'shared review replaces native confirm');assert.equal(writes,0);
 for(const route of ['models','activity','audit']){await p.goto(`http://127.0.0.1:5198/panel/${route}?inspect=missing&page=9999&keep=r6`);await p.getByText('Resource not found in loaded data.',{exact:true}).waitFor();await p.getByRole('button',{name:'← Back',exact:true}).click();await p.getByRole('list').last().waitFor();assert.equal(new URL(p.url()).searchParams.get('page'),'3');assert.equal(new URL(p.url()).searchParams.get('keep'),'r6');}
 // Indonesian labels, populated sheet screenshots, search never serialized.
 await p.addInitScript(()=>localStorage.setItem('styx-panel-preferences',JSON.stringify({theme:'dark',language:'id',density:'compact'})));
 await p.goto('http://127.0.0.1:5198/panel/models?keep=r6');await p.getByRole('button',{name:'Filter',exact:true}).click();await p.getByRole('button',{name:'Terapkan filter',exact:true}).waitFor();assert.ok(await p.getByRole('button',{name:'Terapkan filter',exact:true}).evaluate(el=>el.getBoundingClientRect().height>=44));await p.screenshot({path:`${out}/models-sheet-390-dark-id.png`});await p.getByRole('button',{name:'Batal',exact:true}).click();
 const search=p.locator('input[type=search]').last();await search.fill('sk-artificial-secret-sentinel');await p.waitForTimeout(300);assert.ok(!p.url().includes('sentinel'));await search.fill('');
 // An inventory response from the previous scope may not replace the served catalog.
 let release;const pending=new Promise(resolve=>release=resolve);
 await p.route('**/api/admin/provider-catalog',async r=>{await pending;await r.fulfill({json:{data:[{id:'inventory/old',owned_by:'inventory',name:'Old inventory'}]}});});
 await p.getByRole('button',{name:'Filter',exact:true}).click();await p.getByRole('dialog').getByRole('checkbox').check();await p.getByRole('button',{name:'Terapkan filter',exact:true}).click();
 await p.getByRole('button',{name:/^Filter/}).click();await p.getByRole('dialog').getByRole('checkbox').uncheck();await p.getByRole('button',{name:'Terapkan filter',exact:true}).click();await p.getByRole('list').last().waitFor();release();await p.waitForTimeout(250);assert.equal(await p.getByRole('button',{name:'Old inventory',exact:true}).count(),0,'late inventory cannot replace served catalog');
 await p.close();assert.equal(writes,0);await writeFile(`${out}/results.json`,JSON.stringify({results,writes},null,2));console.log(`PASS ${results.length} populated filter/history cases; Tools single example; ${writes} writes`);
}finally{await browser.close();}
