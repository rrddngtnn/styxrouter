import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const origin='http://127.0.0.1:5198',output=process.env.REDESIGN_EVIDENCE;
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
const records=[];
try{
for(const width of [320,600,860,861,1280,1480])for(const theme of ['light','dark'])for(const language of ['en','id']){
 const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce',serviceWorkers:'block'}),page=await context.newPage(),errors=[];
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(p=>localStorage.setItem('styx-panel-preferences',JSON.stringify(p)),{theme,language,providerView:'rows'});
 await page.goto(`${origin}/panel/tests/redesign-specimen.fixture.html`);await page.getByRole('heading',{name:'Controls and states'}).waitFor();
 assert.equal(await page.locator('[data-card-family]').count(),5);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth),0);
 const primary=page.locator('[data-fixture="primary"]');await primary.focus();assert.equal(await primary.evaluate(el=>getComputedStyle(el).outlineStyle),'solid');
 const focus=await primary.evaluate(el=>({outline:getComputedStyle(el).outlineWidth,offset:getComputedStyle(el).outlineOffset,height:el.getBoundingClientRect().height,color:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor}));assert.equal(focus.outline,'2px');assert.equal(focus.offset,'2px');assert.ok(focus.height>=44);
 await primary.hover();await page.mouse.down();const pressed=await primary.evaluate(el=>getComputedStyle(el).backgroundColor);await page.mouse.up();
 await page.screenshot({path:`${output}/specimen-${theme}-${language}-${width}.png`,fullPage:true});
 await page.getByRole('button',{name:'Open fixture dialog'}).click();const dialog=page.getByRole('dialog');await dialog.waitFor();
 for(let i=0;i<8;i++){await page.keyboard.press('Tab');assert.equal(await dialog.evaluate(el=>el.contains(document.activeElement)),true);}
 await page.screenshot({path:`${output}/specimen-dialog-${theme}-${language}-${width}.png`});await page.keyboard.press('Escape');
 assert.equal(await page.getByRole('button',{name:'Open fixture dialog'}).evaluate(el=>el===document.activeElement),true);
 await page.getByRole('button',{name:'Fixture menu',exact:true}).click();await page.getByRole('menu').waitFor();await page.keyboard.press('ArrowDown');await page.screenshot({path:`${output}/specimen-menu-${theme}-${language}-${width}.png`});await page.keyboard.press('Escape');
 assert.deepEqual(errors,[]);records.push({width,theme,language,focus,pressed,overflow:0,errors});await context.close();
 console.log(`PASS component specimen ${width} ${theme} ${language}`);
}
}finally{await browser.close();await writeFile(`${output}/specimen-results.json`,JSON.stringify(records,null,2));}
