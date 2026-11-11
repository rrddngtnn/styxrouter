import {browserEvidencePath} from './browser-paths.mjs';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {known} from './redesign-api.fixture.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const out=browserEvidencePath('border-applied/integration');await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});const results=[];
try {for(const width of [320,1280])for(const theme of ['light','dark']){
 const p=await browser.newPage({viewport:{width,height:900},hasTouch:true,reducedMotion:'reduce'});const errors=[],writes=[];
 p.on('pageerror',e=>errors.push(e.message));await p.addInitScript(theme=>localStorage.setItem('styx-panel-preferences',JSON.stringify({theme,language:'en'})),theme);
 await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!=='http://127.0.0.1:5198')return r.fulfill({body:''});if(/^\/(api|v1)\//.test(u.pathname)){if(r.request().method()!=='GET')writes.push(u.pathname);return r.fulfill({json:known[u.pathname]??{}});}return r.continue();});
 await p.goto('http://127.0.0.1:5198/panel/tools');const heading=p.locator('h1');await heading.waitFor();
 await p.waitForFunction(()=>document.activeElement===document.querySelector('h1'));
 assert.equal(await heading.getAttribute('data-route-focus'),'programmatic','automatic route focus marked');assert.equal(await heading.evaluate(e=>getComputedStyle(e).outlineStyle),'none');
 await p.locator('.shell-skip').focus();assert.equal(await heading.getAttribute('data-route-focus'),null,'focus change clears suppression');await p.keyboard.press('Enter');await p.waitForFunction(()=>document.activeElement?.id==='main-content');assert.equal(await p.locator('#main-content').evaluate(e=>getComputedStyle(e).outlineWidth),'2px','keyboard skip destination retains visible focus');
 await p.keyboard.press('Tab');assert.equal(await heading.getAttribute('data-route-focus'),null,'keyboard clears suppression');
 // Start from a real shell button, then native Tab through actual navigation links.
 const trigger=p.locator('.shell-nav-trigger');await trigger.click();if(width>860)await trigger.click();
 if(width<=860){await p.keyboard.press('Escape');await trigger.focus();await p.keyboard.press('Enter');}
 else {await p.locator('.shell-drawer button').first().focus();}
 for(let i=0;i<24;i++){if(await p.evaluate(()=>document.activeElement?.getAttribute('aria-label')==='Connect Tools'))break;await p.keyboard.press('Tab');}
 assert.equal(await p.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Connect Tools');
 await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Quota');await p.keyboard.press('Enter');await p.waitForURL('**/quota');
 await p.waitForFunction(()=>document.activeElement===document.querySelector('h1'));
 assert.equal(await heading.getAttribute('data-route-focus'),null);assert.equal(await heading.evaluate(e=>e.matches(':focus-visible')),true);assert.equal(await heading.evaluate(e=>getComputedStyle(e).outlineWidth),'2px');
 await p.screenshot({path:`${out}/keyboard-heading-${width}-${theme}.png`});
 // Genuine pointer and touch route activation, not locator.focus() pretending to be keyboard.
 for(const modality of ['mouse','touch']){
 if(width<=860)await trigger.click();const link=p.getByRole('link',{name:'Connect Tools',exact:true});if(modality==='touch')await link.tap();else await link.click();await p.waitForURL('**/tools');await p.waitForFunction(()=>document.activeElement===document.querySelector('h1'));
 assert.equal(await heading.getAttribute('data-route-focus'),'programmatic');assert.equal(await heading.evaluate(e=>getComputedStyle(e).outlineStyle),'none');
 if(modality==='mouse'){if(width<=860)await trigger.click();await p.getByRole('link',{name:'Quota',exact:true}).click();await p.waitForURL('**/quota');}
 }
 await p.screenshot({path:`${out}/tools-${width}-${theme}.png`,fullPage:true});
 await p.locator('input[type=password]').fill('synthetic-only');const secret=p.locator('.tools-snippet-head button').nth(1);await secret.click();const dialog=p.locator('.styx-confirmation');await dialog.waitFor();const cancel=dialog.getByRole('button',{name:'Cancel',exact:true});await p.waitForFunction(()=>document.activeElement?.textContent==='Cancel');await p.keyboard.press('Tab');await p.keyboard.press('Shift+Tab');assert.equal(await cancel.evaluate(e=>e===document.activeElement),true);assert.equal(await cancel.evaluate(e=>getComputedStyle(e).outlineWidth),'2px');
 const samples=await p.locator('.tools-field input,.tools-field select,.styx-confirmation button,.tools-snippet-card,.tools-snippet-head,.styx-confirmation,.styx-confirmation-resource').evaluateAll(nodes=>{function bg(e){if(!e)return [255,255,255];const c=getComputedStyle(e).backgroundColor.match(/[\d.]+/g).map(Number),b=bg(e.parentElement);return c.slice(0,3).map((v,i)=>v*(c[3]??1)+b[i]*(1-(c[3]??1)));}return nodes.filter(e=>e.getBoundingClientRect().width).map(e=>{const s=getComputedStyle(e);return {cls:e.className,tag:e.tagName,border:s.borderTopColor,borderWidth:s.borderTopWidth,bg:s.backgroundColor,inside:bg(e),outside:bg(e.parentElement),edge:getComputedStyle(document.documentElement).getPropertyValue('--border-edge').trim(),rect:{right:e.getBoundingClientRect().right,left:e.getBoundingClientRect().left}};});});
 function lum(c){const a=c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return a[0]*.2126+a[1]*.7152+a[2]*.0722;}function contrast(a,b){return (Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);}
 for(const s of samples.filter(s=>['INPUT','SELECT','BUTTON'].includes(s.tag))){if(parseFloat(s.borderWidth)===0)continue;const c=s.border.match(/[\d.]+/g).map(Number);s.contrast={inside:contrast(c,s.inside),outside:contrast(c,s.outside)};assert.ok(s.contrast.inside>=3&&s.contrast.outside>=3,JSON.stringify(s));}
 assert.equal(await dialog.evaluate(e=>getComputedStyle(e).borderTopColor),await p.locator('.styx-confirmation-resource').evaluate(e=>getComputedStyle(e).borderTopColor));
 assert.ok(await dialog.evaluate(e=>e.getBoundingClientRect().right<=innerWidth&&e.getBoundingClientRect().left>=0));await p.screenshot({path:`${out}/confirmation-${width}-${theme}.png`});await p.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await secret.evaluate(e=>document.activeElement===e),true);
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);results.push({width,theme,pass:true,samples});await p.close();
}}finally{await browser.close();await writeFile(`${out}/results.json`,JSON.stringify(results,null,2));}
console.log(`PASS ${results.length} integration viewport/theme cases: native keyboard, mouse/touch route focus, dialog keyboard containment/restoration, no overflow or writes.`);
