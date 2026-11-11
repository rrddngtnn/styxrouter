import {browserEvidencePath} from './browser-paths.mjs';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {known} from './redesign-api.fixture.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const out=browserEvidencePath('border-applied');
const phase=process.env.BORDER_PHASE||'after';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const results=[];
try {for(const width of [320,390,1280])for(const theme of ['light','dark']){
const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});page.setDefaultTimeout(15000);
const errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(theme=>localStorage.setItem('styx-panel-preferences',JSON.stringify({theme,language:'en'})),theme);
await page.route('**/*',async r=>{const u=new URL(r.request().url());if(u.origin!=='http://127.0.0.1:5198')return r.fulfill({body:'',contentType:'text/css'});if(/^\/(api|v1)\//.test(u.pathname)){if(r.request().method()!=='GET'){writes.push(u.pathname);return r.fulfill({status:501,json:{error:'write blocked'}});}return r.fulfill({json:u.pathname==='/api/usage/analytics'?{...known[u.pathname],range:u.searchParams.get('range')??'7d'}:known[u.pathname]??{}});}return r.continue();});
for(const route of ['','providers?tab=apikey','models','routing','keys','tools','quota','usage','activity','audit','settings']){
await page.goto('http://127.0.0.1:5198/panel/'+route);await page.locator('h1').waitFor();await page.waitForTimeout(650);if(route==='usage')await page.getByRole('heading',{name:'Monthly report',exact:true}).waitFor();
const name=route.split('?')[0]||'overview';
const record=await page.evaluate(()=>{function sample(e){const s=getComputedStyle(e);return {tag:e.tagName,cls:e.className,border:s.borderTopColor,borderWidth:s.borderTopWidth,bg:s.backgroundColor,outline:s.outline,focus:e.matches(':focus-visible'),width:e.getBoundingClientRect().width};}return {overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,heading:sample(document.querySelector('h1')),samples:[...document.querySelectorAll('.card,.settings-card,.quota-account,.provider-card,input,select,.toolbar,.rt-TextFieldRoot')].slice(0,15).map(sample)};});
await page.screenshot({path:`${out}/${phase}-${name}-${theme}-${width}.png`,fullPage:true});results.push({route:name,width,theme,...record});assert.equal(record.overflow,0,JSON.stringify(results.at(-1)));
}
assert.equal(writes.length,0);assert.equal(errors.length,0,errors.join('\n'));await page.close();
}}finally{await browser.close();await writeFile(`${out}/${phase}-measurements.json`,JSON.stringify(results,null,2));}
console.log(`PASS ${results.length} ${phase} route/theme/width captures, zero document overflow or API writes.`);
