import {browserEvidencePath} from './browser-paths.mjs';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {known} from './redesign-api.fixture.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const out=browserEvidencePath('geometry');await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
const results=[];
try{for(const width of [320,390,1280])for(const theme of ['light','dark']){
 const p=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});const errors=[],writes=[];
 p.on('pageerror',e=>errors.push(e.message));await p.addInitScript(theme=>localStorage.setItem('styx-panel-preferences',JSON.stringify({theme,language:'en'})),theme);
 await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!=='http://127.0.0.1:5198')return r.abort();if(/^\/(api|v1)\//.test(u.pathname)){if(r.request().method()!=='GET')writes.push(u.pathname);return r.fulfill({json:known[u.pathname]??{}});}return r.continue();});
 await p.goto('http://127.0.0.1:5198/panel/tools');await p.locator('h1').waitFor();await p.evaluate(()=>document.fonts.ready);
 const trigger=p.locator('.shell-nav-trigger');if(width<=860)await trigger.click();
 await p.getByRole('link',{name:'Settings',exact:true}).waitFor({state:'visible'});
 const geometry=p.locator('.geometry-quiet-space');
 const boundary=await p.locator('.tools-field input').first().evaluate(e=>{const s=getComputedStyle(e);return {border:s.borderColor,bg:s.backgroundColor,color:s.color};});
 for(const mode of ['off','on']){
  await geometry.evaluate((e,mode)=>e.style.visibility=mode==='off'?'hidden':'visible',mode);
  await p.screenshot({path:`${out}/${width}-${theme}-open-${mode}.png`});
 }
 const measurements=await p.evaluate(()=>{const e=document.querySelector('.geometry-quiet-space'),r=e.getBoundingClientRect(),n=e.parentElement,last=n.querySelector('.nav-section:last-of-type')??n.querySelectorAll('.nav-section')[4];const links=[...n.querySelectorAll('.nav-link')].map(e=>{const r=e.getBoundingClientRect();return {name:e.getAttribute('aria-label'),bottom:r.bottom,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e||e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};});return {rect:{x:r.x,y:r.y,width:r.width,height:r.height},links,scrollHeight:n.scrollHeight,clientHeight:n.clientHeight,overflow:document.documentElement.scrollWidth-innerWidth,inert:e.inert,pointer:getComputedStyle(e).pointerEvents};});
 assert.equal(measurements.overflow,0);assert.equal(measurements.inert,true);assert.equal(measurements.pointer,'none');assert.ok(measurements.rect.y>=Math.max(...measurements.links.map(e=>e.bottom))-1);assert.ok(measurements.links.every(e=>e.hit));assert.ok(measurements.rect.height>20);
 await p.getByRole('link',{name:'Settings',exact:true}).focus();await p.keyboard.press('Tab');assert.equal(await geometry.evaluate(e=>e.contains(document.activeElement)),false);
 const after=await p.locator('.tools-field input').first().evaluate(e=>{const s=getComputedStyle(e);return {border:s.borderColor,bg:s.backgroundColor,color:s.color};});assert.deepEqual(boundary,after);
 if(width<=860)await p.keyboard.press('Escape');else await trigger.click();
 await p.screenshot({path:`${out}/${width}-${theme}-closed-on.png`});
 if(width>860)assert.equal(await geometry.isVisible(),false);
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 // Short viewport: geometry cannot steal scroll space from the last navigation entry.
 await p.setViewportSize({width,height:600});if(width<=860)await trigger.click();else await trigger.click();await p.getByRole('link',{name:'Settings',exact:true}).scrollIntoViewIfNeeded();
 assert.equal(await p.getByRole('link',{name:'Settings',exact:true}).isVisible(),true);
 results.push({width,theme,measurements,boundary,errors,writes});await p.close();
}}finally{await browser.close();await writeFile(`${out}/results.json`,JSON.stringify(results,null,2));}
console.log(`PASS ${results.length} geometry cases: off/on, open/closed, hit tests, inert focus, unchanged fields, zero overflow/writes, short-screen Settings reachable.`);
