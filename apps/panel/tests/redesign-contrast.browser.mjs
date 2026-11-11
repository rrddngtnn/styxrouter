import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
function luminance(rgb){const v=rgb.match(/[\d.]+/g).slice(0,3).map(Number).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return .2126*v[0]+.7152*v[1]+.0722*v[2];}
const ratio=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05),records=[];
try{for(const theme of ['light','dark']){
 const page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'});
 await page.addInitScript(theme=>localStorage.setItem('styx-panel-preferences',JSON.stringify({theme,language:'en'})),theme);
 await page.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:5198'?route.continue():route.abort());
 await page.goto('http://127.0.0.1:5198/panel/tests/redesign-specimen.fixture.html');await page.locator('[data-fixture="primary"]').waitFor();
 for(const selector of ['[data-fixture="primary"]','button.btn-danger','button.btn-add:disabled','.status-badge[data-status="success"]','.status-badge[data-status="error"]','.status-badge[data-status="warning"]','.status-badge[data-status="unknown"]']){
 const colors=await page.locator(selector).first().evaluate(el=>{const s=getComputedStyle(el);return {fg:s.color,bg:s.backgroundColor};});const contrast=ratio(colors.fg,colors.bg);records.push({theme,selector,...colors,contrast});assert.ok(contrast>=4.5,JSON.stringify(records.at(-1)));
 }
 await page.close();
}}finally{await browser.close();await writeFile(process.env.REDESIGN_EVIDENCE+'/rendered-contrast.json',JSON.stringify(records,null,2));}
console.log(`PASS ${records.length} actual computed opaque foreground/background pairs. Alpha/focus/whole-application AA not certified.`);
