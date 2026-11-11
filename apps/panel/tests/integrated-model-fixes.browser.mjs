import assert from 'node:assert/strict';
import {known} from './redesign-api.fixture.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const mode=process.env.MODEL_FIX_CASE??'all';
const metadata=(modelId)=>({provider:'openai',modelId,contextWindow:4096,supportsThinking:false,supportsVision:true,supportsTools:true,overrides:{contextWindow:null,supportsThinking:null,supportsVision:null,supportsTools:null}});
const id=modelId=>`openai/openai/${modelId}/chat`;
const transition=(p,value)=>p.evaluate(value=>{const u=new URL(location.href);u.searchParams.set('inspect',value);history.pushState({},'',u);dispatchEvent(new PopStateEvent('popstate'));},id(value));
async function setup(){
 const p=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});const writes=[];const reads=[];const held=[];let holdId=null;let holdPatch=false;let holdCatalog=false;let patchStatus=503;
 await p.route('**/*',async r=>{const u=new URL(r.request().url());if(u.hostname!=='127.0.0.1')return r.abort();if(!/^\/(api|v1)\//.test(u.pathname))return r.continue();
  if(r.request().method()!=='GET'){
   assert.equal(u.pathname,'/api/model-metadata');assert.equal(r.request().method(),'PATCH');writes.push(r.request().postDataJSON());
   if(holdPatch)await new Promise(resolve=>held.push(resolve));
   return r.fulfill({status:patchStatus,json:patchStatus===200?{model:metadata('fixture-model')}:{error:'Synthetic unavailable; outcome unknown'}});
  }
  if(u.pathname==='/api/model-metadata'){const modelId=u.searchParams.get('modelId');reads.push(modelId);if(modelId===holdId)await new Promise(resolve=>held.push(resolve));return r.fulfill({json:{model:metadata(modelId)}});}
  if(u.pathname==='/v1/models'){if(holdCatalog)await new Promise(resolve=>held.push(resolve));return r.fulfill({json:{data:['fixture-model','other'].map(modelId=>({id:`openai/${modelId}`,owned_by:'openai',type:'chat'}))}});}
  return r.fulfill({json:known[u.pathname]??{}});
 });
 await p.goto('http://127.0.0.1:5198/panel/models');await p.getByRole('list',{name:'Models',exact:true}).getByRole('button').first().click();await p.locator('.model-editor').waitFor();
 return {p,writes,reads,holdRead:v=>holdId=v,holdPatch:v=>holdPatch=v,holdCatalog:v=>holdCatalog=v,status:v=>patchStatus=v,release:()=>{for(const resolve of held.splice(0))resolve();}};
}
try{
 if(mode==='identity'||mode==='all'){
  const t=await setup();const {p,writes,reads}=t;
  await transition(p,'missing');await p.getByText('Resource not found in loaded data.',{exact:true}).waitFor({timeout:3000});assert.equal(await p.locator('.model-editor').count(),0,'invalid inspection must remove old editable identity');assert.equal(writes.length,0);
  t.holdRead('other');await transition(p,'other');await p.waitForFunction(()=>document.body.textContent.includes('Loading'));assert.equal(await p.locator('.model-editor').count(),0,'delayed valid identity must not edit previous model');
  await transition(p,'missing');await p.getByText('Resource not found in loaded data.',{exact:true}).waitFor();t.release();await p.waitForTimeout(150);assert.equal(await p.locator('.model-editor').count(),0,'late metadata must not revive invalid inspection');
  t.holdRead(null);await transition(p,'other');await p.locator('.model-editor h2').filter({hasText:'openai/other'}).waitFor();assert.equal(await p.getByLabel('Context window (tokens)',{exact:true}).inputValue(),'4096');assert.deepEqual(reads,['fixture-model','other','other']);assert.equal(writes.length,0);
  await p.getByRole('button',{name:'← Back',exact:true}).click();await p.getByRole('button',{name:'Inspect custom model ID',exact:true}).click();await p.getByRole('dialog').getByLabel('Provider',{exact:true}).fill('openai');await p.getByRole('dialog').getByLabel('Model ID',{exact:true}).fill('custom-id');await p.getByRole('button',{name:'Inspect model',exact:true}).click();await p.locator('.model-editor h2').filter({hasText:'openai/custom-id'}).waitFor();assert.equal(writes.length,0);await p.close();console.log('PASS invalid transition, delayed identity, stale response and custom ID; 0 PATCH');
 }
 if(mode==='submit'||mode==='all'){
  const t=await setup();const {p,writes}=t;t.holdPatch(true);await p.getByLabel('Context window (tokens)',{exact:true}).fill('42');
  const submit=()=>p.locator('.model-editor').evaluate(form=>{form.requestSubmit();form.requestSubmit();});
  await submit();await p.waitForTimeout(200);assert.equal(writes.length,1,'same-task double submit must send exactly one PATCH');assert.equal(writes[0].modelId,'fixture-model');assert.equal(writes[0].contextWindow,42);assert.equal(await p.getByRole('button',{name:'Saving…',exact:true}).isDisabled(),true);
  await submit();await p.waitForTimeout(100);assert.equal(writes.length,1,'held transport cannot overlap');t.release();await p.getByRole('status').filter({hasText:'outcome unknown'}).waitFor();await p.waitForTimeout(150);assert.equal(writes.length,1,'uncertain failure must never auto retry');assert.equal(await p.getByLabel('Context window (tokens)',{exact:true}).inputValue(),'42');
  // A deliberate new submit is allowed only after the first operation has settled.
  t.holdPatch(false);await submit();await p.waitForTimeout(150);assert.equal(writes.length,2,'guard releases after failure, not before');
  t.status(200);t.holdCatalog(true);await submit();await p.waitForTimeout(200);assert.equal(writes.length,3);assert.equal(await p.getByRole('button',{name:'Saving…',exact:true}).isDisabled(),true,'guard remains held through catalog reconciliation');await submit();await p.waitForTimeout(100);assert.equal(writes.length,3,'reconciliation cannot overlap another PATCH');t.release();await p.getByRole('list',{name:'Models',exact:true}).waitFor();assert.equal(await p.locator('.model-editor').count(),0);await p.close();console.log('PASS same-task submit and pending exclusion; 3 explicit PATCH attempts, no automatic retry');
 }
}finally{await browser.close();}
