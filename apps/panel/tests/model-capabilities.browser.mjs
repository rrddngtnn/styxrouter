import {browserEvidencePath} from './browser-paths.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {known} from './redesign-api.fixture.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const phase=process.env.CAPABILITIES_PHASE??'after';
const out=process.env.CAPABILITIES_EVIDENCE??browserEvidencePath('model-capabilities');
await fs.mkdir(out,{recursive:true});
const widths=process.env.CAPABILITIES_QUICK?[320,1280]:[320,360,390,600,860,861,1280];
const long='fixture-model-with-a-very-long-canonical-identifier-that-must-not-clip-or-change';
const metadata={provider:'openai',modelId:long,contextWindow:4096,supportsThinking:false,supportsVision:true,supportsTools:true,overrides:{contextWindow:null,supportsThinking:null,supportsVision:true,supportsTools:false}};
const records=[];
try{
for(const width of widths)for(const theme of ['light','dark'])for(const language of ['en','id']){
 const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<=860,reducedMotion:'reduce',serviceWorkers:'block'});
 await context.addInitScript(p=>localStorage.setItem('styx-panel-preferences',JSON.stringify(p)),{theme,language,density:'comfortable'});
 const writes=[];const errors=[];const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());console.log(`case ${width} ${theme} ${language}`);
 await context.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());if(u.origin!=='http://127.0.0.1:5198')return route.abort();if(!/^\/(api|v1)\//.test(u.pathname))return route.continue();
 if(req.method()!=='GET'){assert.equal(u.pathname,'/api/model-metadata');assert.equal(req.method(),'PATCH');writes.push(req.postDataJSON());return route.fulfill({json:{model:{...metadata,overrides:{...metadata.overrides,contextWindow:8192}}}});}
 if(u.pathname==='/v1/models')return route.fulfill({json:{data:[{id:`openai/${long}`,owned_by:'openai',name:long,type:'chat',context_length:4096,supportsThinking:true,supportsVision:true,supportsTools:true}]}});
 if(u.pathname==='/api/model-metadata')return route.fulfill({json:{model:metadata}});
 return route.fulfill({json:known[u.pathname]??{}});
 });
 await page.goto('http://127.0.0.1:5198/panel/models',{waitUntil:'networkidle'});
 const search=page.getByRole('searchbox',{name:language==='id'?'Cari model':'Search models',exact:true});await search.waitFor();
 const geometry=await page.evaluate(()=>{const search=document.querySelector('.r6-models input[type="search"]'),toolbar=search.closest('.toolbar');const r=search.getBoundingClientRect(),t=toolbar.getBoundingClientRect();return {overflow:document.documentElement.scrollWidth-innerWidth,searchWidth:r.width,searchHeight:r.height,toolbarHeight:t.height};});
 await page.screenshot({path:`${out}/${phase}-${width}-${theme}-${language}-catalog.png`,fullPage:true});
 if(width<=860)await page.getByRole('list',{name:language==='id'?'Model':'Models',exact:true}).getByRole('button').first().click();else await page.getByRole('button',{name:language==='id'?'Atur':'Configure',exact:true}).first().click();
 const editor=page.locator('.model-editor');await editor.waitFor();
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.screenshot({path:`${out}/${phase}-${width}-${theme}-${language}-editor.png`,fullPage:true});
 const detail=await editor.evaluate(form=>{const r=form.getBoundingClientRect();return {width:r.width,height:r.height,overflow:document.documentElement.scrollWidth-innerWidth,gap:getComputedStyle(form).gap,fields:[...form.querySelectorAll('input,select')].map(e=>{const b=e.getBoundingClientRect();return {width:b.width,height:b.height,right:b.right};}),buttons:[...form.querySelectorAll('button')].map(e=>({text:e.textContent,height:e.getBoundingClientRect().height})),dialog:form.closest('[role="dialog"]')?.getBoundingClientRect().toJSON()};});
 records.push({width,theme,language,catalog:geometry,editor:detail});
 if(phase!=='before'){
 assert.ok(geometry.searchWidth>=Math.min(width-48,160),'search must remain usable beside progressive filter');assert.ok(geometry.toolbarHeight<=112,`search/filter row must not become giant vertical stack: ${JSON.stringify({width,geometry})}`);assert.ok(geometry.overflow<=1);assert.ok(detail.overflow<=1);
 for(const field of detail.fields){assert.ok(field.width>=160);assert.ok(field.right<=width);if(width<=860)assert.ok(field.height>=44,'touch fields >=44px');}
 for(const button of detail.buttons)if(width<=860)assert.ok(button.height>=44,'touch buttons >=44px');
 const identityBounds=await editor.locator('h2 code').evaluate(code=>{const range=document.createRange();range.selectNodeContents(code);return [...range.getClientRects()].map(r=>({left:r.left,right:r.right}));});for(const bounds of identityBounds)assert.ok(bounds.left>=0&&bounds.right<=width,'canonical identity text must wrap without clipping');
 assert.equal(writes.length,0,'opening metadata never sends inference or mutations');
 // Real keyboard navigation through the native controls, no force clicks.
 const field=editor.locator('input[type="number"]');await field.focus();await page.keyboard.press('Tab');assert.ok(await editor.locator('button').first().evaluate(e=>e===document.activeElement));
 await editor.getByRole('button',{name:language==='id'?'Batal':'Cancel',exact:true}).click();await editor.waitFor({state:'detached'});assert.equal(writes.length,0);
 if(width<=860)await page.getByRole('list',{name:language==='id'?'Model':'Models',exact:true}).getByRole('button').first().click();else await page.getByRole('button',{name:language==='id'?'Atur':'Configure',exact:true}).first().click();
 await editor.waitFor();await editor.locator('input[type="number"]').fill('8192');
 await editor.getByRole('button',{name:language==='id'?'Batal':'Cancel',exact:true}).click();
 const review=page.locator('.styx-confirmation');await review.waitFor();await page.keyboard.press('Escape');await review.waitFor({state:'detached'});assert.equal(await editor.locator('input[type="number"]').inputValue(),'8192');assert.equal(writes.length,0);
 await editor.getByRole('button',{name:language==='id'?'Batal':'Cancel',exact:true}).click();await review.waitFor();await review.getByRole('button').last().click();await editor.waitFor({state:'detached'});assert.equal(writes.length,0);
 if(width<=860)await page.getByRole('list',{name:language==='id'?'Model':'Models',exact:true}).getByRole('button').first().click();else await page.getByRole('button',{name:language==='id'?'Atur':'Configure',exact:true}).first().click();
 await editor.waitFor();await editor.locator('input[type="number"]').fill('8192');await editor.getByRole('button',{name:language==='id'?'Simpan':'Save',exact:true}).click();await editor.waitFor({state:'detached'});
 assert.deepEqual(writes,[{provider:'openai',modelId:long,contextWindow:8192,supportsThinking:null,supportsVision:true,supportsTools:false}]);
 assert.deepEqual(errors,[]);
 }
 await context.close();
}
await fs.writeFile(`${out}/${phase}-geometry.json`,JSON.stringify(records,null,2));console.log(`${phase}: ${records.length} viewport/theme/locale cases captured${phase==='before'?'':'; geometry, keyboard, Cancel and exact Save payload verified'}`);
}finally{await browser.close();}
