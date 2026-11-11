import assert from 'node:assert/strict';
import {known,account} from './redesign-api.fixture.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try {
 for(const scenario of ['partial','missing','batch','unknown','enable-cancel','enable']) {
  const page=await browser.newPage({viewport:{width:1280,height:900}}); const writes=[]; let readsAfterWrite=0;
  const ids=Array.from({length:scenario==='batch'||scenario==='unknown'?201:3},(_,i)=>`active-${i}`);
  await page.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());if(u.hostname!=='127.0.0.1')return route.abort();if(/^\/(api|v1)\//.test(u.pathname)) {
   if(req.method()!=='GET') {const body=req.postDataJSON();writes.push({path:u.pathname,body});if(u.pathname!=='/api/connections/bulk-activation')return route.fulfill({status:404,json:{error:'Not Found'}});
    assert.ok(body.ids.length<=100);assert.equal(new Set(body.ids).size,body.ids.length);
    if(scenario==='unknown')return route.fulfill({status:503,json:{error:'Synthetic transport failure'}});
    return route.fulfill({json:{results:body.ids.filter(id=>scenario!=='missing'||id!=='active-2').map(id=>id==='active-1'&&scenario==='partial'?{id,success:false,error:'Connection not found'}:{id,success:true,isActive:body.isActive})}});
   }
   if(u.pathname==='/api/connections'){if(writes.length)readsAfterWrite++;return route.fulfill({json:{connections:[...ids.map(id=>({...account,id,isActive:true})),{...account,id:'intentional-off',isActive:false}]}});}
   if(Object.hasOwn(known,u.pathname))return route.fulfill({json:known[u.pathname]});return route.fulfill({json:{}});
  }return route.continue();});
  await page.goto('http://127.0.0.1:5198/panel/settings?tab=security');
  const pause=page.getByRole('button',{name:'Disable all active accounts',exact:true});await pause.waitFor();assert.deepEqual(writes,[]);
  if(scenario.startsWith('enable')) {await page.getByRole('button',{name:'Enable all inactive accounts',exact:true}).click();const review=page.locator('.styx-confirmation');await review.waitFor();assert.match(await review.innerText(),/ALL 1 inactive/);assert.match(await review.innerText(),/intentionally disabled/);await review.getByRole('button').nth(scenario==='enable'?1:0).click();if(scenario==='enable-cancel'){assert.deepEqual(writes,[]);await page.close();continue;}await page.getByText('Enabled 1 account(s)',{exact:true}).waitFor();assert.deepEqual(writes,[{path:'/api/connections/bulk-activation',body:{ids:['intentional-off'],isActive:true}}]);
  } else {await pause.click();assert.deepEqual(writes,[]);await page.locator('.styx-confirmation').waitFor();assert.match(await page.locator('.styx-confirmation').innerText(),new RegExp(`${ids.length} active account IDs`));await page.getByRole('button',{name:'Confirm disable all',exact:true}).click();
   await page.waitForFunction(()=>Boolean(document.querySelector('[data-sonner-toast]')));
   assert.equal(writes[0]?.path,'/api/connections/bulk-activation');
   const expected=scenario==='batch'?'Deactivated 201 account(s)':scenario==='partial'?'Deactivated 2 of 3 account(s); 1 failed; 0 unknown.':scenario==='missing'?'Deactivated 2 of 3 account(s); 0 failed; 1 unknown.':'Deactivated 0 of 201 account(s); 0 failed; 201 unknown.';
   await page.getByText(expected,{exact:true}).waitFor();
   assert.deepEqual(writes.flatMap(w=>w.body.ids),scenario==='unknown'?ids.slice(0,100):ids);assert.ok(writes.every(w=>w.body.isActive===false));
   if(scenario==='unknown'){assert.equal(writes.length,1);assert.equal(await pause.isEnabled(),false);}
   if(scenario==='partial'||scenario==='missing'||scenario==='unknown')assert.equal(await page.locator('[data-sonner-toast][data-type="success"]').count(),0);
  }
  assert.equal(readsAfterWrite,0,'No automatic refresh or retry after mutation');await page.close();console.log('PASS emergency '+scenario);
 }
}finally{await browser.close();}
