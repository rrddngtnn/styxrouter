import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {known,analytics} from './redesign-api.fixture.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
const origin='http://127.0.0.1:5198',results=[];
try{
 const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'}),page=await context.newPage();let calls=[];
 await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!==origin){if(u.hostname==='fonts.googleapis.com')return r.fulfill({contentType:'text/css',body:''});return r.abort();}if(/^\/(api|v1)\//.test(u.pathname)){calls.push({path:u.pathname,method:r.request().method()});if(u.pathname==='/api/usage/analytics')return r.fulfill({json:{...analytics,range:u.searchParams.get('range'),provider:null}});return r.fulfill({status:u.pathname in known?200:501,json:known[u.pathname]??{error:'Unknown fixture'}});}return r.continue();});
 await page.goto(origin+'/panel/settings');await page.getByRole('heading',{name:'Settings',exact:true}).waitFor();
 const mutations=()=>calls.filter(r=>r.method!=='GET');
 for(const mode of ['Light','Dark','System theme']){await page.getByRole('button',{name:'Appearance',exact:true}).click();await page.getByRole('menuitemradio',{name:mode,exact:true}).click();}
 const before=calls.length;await page.getByRole('button',{name:'Appearance',exact:true}).click();await page.getByRole('menuitemradio',{name:'System theme',exact:true}).click();assert.equal(calls.length,before);
 await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
 await page.emulateMedia({colorScheme:'light'});await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
 await page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'styx-panel-preferences',newValue:JSON.stringify({theme:'dark',language:'id',providerView:'rows'})})));
 await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark'&&document.documentElement.lang==='id');assert.equal(mutations().length,0);
 results.push({case:'same preference/system/storage changes',pass:true,mutationCount:0});
 await page.goto(origin+'/panel/activity');await page.getByRole('button',{name:'Live tail',exact:true}).click();
 await page.getByRole('tab',{name:'Webhook Notifikasi',exact:true}).click().catch(async()=>{await page.locator('[role="tab"]').nth(1).click();});
 const logCount=()=>calls.filter(r=>r.path==='/api/usage/call-logs').length;const stopped=logCount();await page.waitForTimeout(3300);assert.equal(logCount(),stopped);
 results.push({case:'activity inactive tab stops live read polling',pass:true});
 // 200% text is not a browser zoom substitute; recorded separately.
 for(const route of ['','providers?tab=apikey','routing','settings','usage']){
 await page.goto(origin+'/panel/'+route);await page.locator('h1').waitFor();await page.evaluate(()=>document.documentElement.style.fontSize='200%');
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);assert.equal(overflow,0,route+' text overflow');results.push({case:'200% root text scale',route,overflow});
 }
 await context.close();
}finally{await browser.close();await writeFile(process.env.REDESIGN_EVIDENCE+'/lifecycle.json',JSON.stringify(results,null,2));}
console.log('PASS theme idempotence/system/storage, inactive live polling, representative 200% text reflow');
