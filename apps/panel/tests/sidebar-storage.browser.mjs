import assert from 'node:assert/strict';
import {known} from './redesign-api.fixture.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try {
 for(const denied of (process.env.STORAGE_CASE?[process.env.STORAGE_CASE]:['getItem','setItem','getter','none'])){
  const p=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'});let writes=0;
  await p.addInitScript(denied=>{
   localStorage.setItem('styx-panel-preferences',JSON.stringify({language:'en',theme:'light'}));
   if(denied==='none')localStorage.setItem('styx-sidebar-expanded','false');
   if(denied==='getter')Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Synthetic storage denied','SecurityError');}});
   else if(denied!=='none'){const native=Storage.prototype[denied];Storage.prototype[denied]=function(key,...args){if(key==='styx-sidebar-expanded')throw new DOMException('Synthetic storage denied','SecurityError');return native.call(this,key,...args);};}
  },denied);
  await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!=='http://127.0.0.1:5198')return r.abort();if(/^\/(api|v1)\//.test(u.pathname)){if(r.request().method()!=='GET'){writes++;return r.abort();}return r.fulfill({json:known[u.pathname]??{}});}return r.continue();});
  await p.goto('http://127.0.0.1:5198/panel/tools');
  await p.getByRole('heading',{name:'Connect tools',exact:true}).waitFor({timeout:5000});
  assert.equal(await p.getByText('Unexpected Application Error!',{exact:true}).count(),0);
  const trigger=p.locator('.shell-nav-trigger'),nav=p.locator('.shell-nav-scroller');
  const expanded=denied!=='none';assert.equal(await nav.evaluate(e=>e.getBoundingClientRect().width),expanded?248:64);
  await trigger.focus();await p.keyboard.press('Enter');assert.equal(await nav.evaluate(e=>e.getBoundingClientRect().width),expanded?64:248);
  await p.locator('#styx-nav').getByRole('link',{name:'Models',exact:true}).click();await p.getByRole('heading',{name:'Model Capabilities',exact:true}).waitFor();
  assert.equal(await nav.evaluate(e=>e.getBoundingClientRect().width),expanded?64:248,'route keeps in-memory choice');
  await p.setViewportSize({width:390,height:900});await trigger.click();const drawer=p.getByRole('dialog',{name:'Main navigation'});await drawer.waitFor();await p.keyboard.press('Escape');assert.ok(await trigger.evaluate(e=>e===document.activeElement));
  await p.setViewportSize({width:1280,height:900});assert.equal(await nav.evaluate(e=>e.getBoundingClientRect().width),expanded?64:248);
  await trigger.click();assert.equal(await nav.evaluate(e=>e.getBoundingClientRect().width),expanded?248:64);
  if(denied==='none'){await p.reload();await p.getByRole('heading',{name:'Model Capabilities',exact:true}).waitFor();assert.equal(await nav.evaluate(e=>e.getBoundingClientRect().width),64,'collapsed preference survives reload');}
  assert.equal(writes,0);console.log(`PASS sidebar storage ${denied}: heading, native keyboard, 248/64, route memory, mobile Escape, zero writes`);await p.close();
 }
}finally{await browser.close();}
