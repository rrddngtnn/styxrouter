import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const output=process.env.REDESIGN_EVIDENCE;
await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
const ledger=[];
try {
for(const width of [320,390,600,1280]) for(const theme of ['light','dark']) for(const language of ['en','id']) for(const density of ['comfortable','compact']) {
 const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce',serviceWorkers:'block'});
 await page.addInitScript(p=>localStorage.setItem('styx-panel-preferences',JSON.stringify(p)),{theme,language,density});
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 for(const route of ['providers/openai?auth=apikey','quota','routing']) {
 await page.goto(`http://127.0.0.1:5198/panel/${route}`);await page.locator('h1').waitFor();
 const name=`${route.split('?')[0].replaceAll('/','-')}-${width}-${theme}-${language}-${density}`;
 await page.screenshot({path:`${output}/${name}.png`,fullPage:true});
 const geometry=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth-innerWidth,filter:[...document.querySelectorAll('.tag-filter-trigger')].map(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})),oldFilter:[...document.querySelectorAll('form')].filter(e=>e.textContent.includes('tag')).map(e=>e.getBoundingClientRect().toJSON()),breadcrumb:!!document.querySelector('.shell-breadcrumbs ol'),logo:[...document.querySelectorAll('.shell-dialog-head img')].filter(e=>e.getClientRects().length).map(e=>({src:e.getAttribute('src'),width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}))}));
 ledger.push({name,...geometry});
 if(process.env.R3_ASSERT==='1') {
 assert.equal(geometry.overflow,0,name);
 if(route!=='routing') {
 const trigger=page.locator('.tag-filter-trigger');assert.equal(await trigger.count(),1,name+' single Tags trigger');
 assert.equal(geometry.filter[0].height,44);assert.ok(geometry.filter[0].width<180);
 await trigger.focus();await page.keyboard.press('Enter');
 const popup=page.locator('.tag-filter-popover');await popup.waitFor();
 assert.ok((await popup.boundingBox()).width<=width-24);
 await popup.locator('input').fill('qa-tag');
 await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement?.classList.contains('tag-filter-trigger'));assert.equal(await trigger.evaluate(e=>e===document.activeElement),true);
 }
 if(route.startsWith('providers')) {assert.equal(geometry.breadcrumb,true);assert.equal(await page.locator('.shell-breadcrumbs [aria-current="page"]').count(),1);}
 if(width===1280) {assert.equal(geometry.logo.length,1);assert.ok(geometry.logo[0].height>=30,'readable original artwork');}
 }
 }
 await page.close();console.log(`PASS ${width} ${theme} ${language} ${density}`);
}
} finally {await browser.close();await writeFile(`${output}/measurements.json`,JSON.stringify(ledger,null,2));}
