import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const origin=new URL(process.env.PANEL_TEST_URL??'http://127.0.0.1:5198').origin;
assert.equal(new URL(origin).hostname,'127.0.0.1');
const output=process.env.REDESIGN_EVIDENCE;
const widths=process.env.REDESIGN_WIDTHS?.split(',').map(Number)??[320,600,860,861,1280,1480];
await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
const analytics={range:'7d',summary:{totalRequests:24,promptTokens:1200,completionTokens:800,totalTokens:2000,uniqueModels:1,uniqueAccounts:1,successfulRequests:23,successRatePct:95.83,avgLatencyMs:320,totalCost:.02},dailyTrend:[{date:'2026-11-10',requests:10,promptTokens:500,completionTokens:300,totalTokens:800,cost:.01},{date:'2026-11-11',requests:14,promptTokens:700,completionTokens:500,totalTokens:1200,cost:.01}],byModel:[{provider:'openai',model:'openai/fixture-model',requests:24,totalTokens:2000,cost:.02,avgLatencyMs:320,successRatePct:95.83}],byProvider:[{provider:'openai',providerId:'openai',requests:24,totalTokens:2000,cost:.02,avgLatencyMs:320,successRatePct:95.83}],byAccount:[],byApiKey:[],errorBreakdown:[]};
const account={id:'synthetic-account',provider:'openai',name:'Synthetic QA account',authType:'apikey',isActive:true,testStatus:null,lastError:null,backoffLevel:0,rateLimitedUntil:null,tokenExpiresAt:null};
const known={
 '/api/auth/status':{authenticated:true},'/api/health/ping':{ok:true,uptime_seconds:100},
 '/api/providers':{providers:[{id:'openai',name:'OpenAI · synthetic fixture',authModes:['apikey'],vendor:'OpenAI'}]},
 '/api/connections':{connections:[account]},'/api/provider-nodes':{nodes:[]},'/api/oauth/providers':{providers:[]},
 '/api/usage/analytics':analytics,'/api/usage/call-logs':[],
 '/api/keys':{keys:[]},'/api/settings':{},'/api/routing/combos':{combos:[]},'/api/routing/trace':{entries:[],traces:[]},
 '/api/usage/quota':{providers:[{provider:'openai',connectionId:account.id,name:account.name,isActive:true,quotaSupported:false,quotaUsed:0,quotaTotal:null,percentRemaining:null,resetAt:null,tokenStatus:'unknown',windows:[]}]},
 '/api/quota/pools':{pools:[],total:0},'/api/audit-log':{entries:[],total:0},'/api/backups':{backups:[]},
 '/api/webhooks':{webhooks:[]},'/api/proxies/config':{global:null,providers:{},connections:{}},
 '/v1/models':{data:[{id:'openai/fixture-model',owned_by:'openai',type:'chat'}]},
 '/api/admin/provider-catalog':{data:[]},
 '/api/providers/openai/models':{providerId:'openai',prefix:'openai',catalogStatus:'known',models:[{id:'fixture-model',name:'Synthetic fixture model',type:'chat',origin:'built-in'}]},
 '/api/connections/import/providers':{providers:[]},'/api/model-metadata':{model:{provider:'openai',modelId:'fixture-model',contextWindow:4096,overrides:{}}},
 '/api/admin/env':{values:{},allowedKeys:[]},'/api/process-health/start':{startedAt:null},'/api/process-health/peak':{peakRssBytes:null},'/api/process-health/cpu':{userMicroseconds:0,systemMicroseconds:0},'/api/process-health/threads':{threadCount:null},'/api/process-health/token-scheduler':{},'/api/process-health/dispatch':{providers:[]},'/api/storage-health':{databaseBytes:null,walBytes:null},'/api/storage-health/vacuum':{lastSuccessfulSchedulerVacuumAt:null},
 '/api/versions/zcode/status':{},'/api/versions/antigravity/ide/status':{},'/api/versions/antigravity/cli/status':{},
};
const results=[];
try {
 for(const width of widths) for(const theme of ['light','dark']) for(const language of ['en','id']) {
 const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce',serviceWorkers:'block'});
 const page=await context.newPage();page.setDefaultTimeout(7000);
 const errors=[],unexpected=[],writes=[],blocked=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
 await page.addInitScript(p=>localStorage.setItem('styx-panel-preferences',JSON.stringify(p)),{theme,language,providerView:'cards'});
 await context.route('**/*',async route=>{
 const req=route.request(),u=new URL(req.url());
 if(u.origin!==origin){blocked.push(u.origin);if(u.hostname==='fonts.googleapis.com')return route.fulfill({contentType:'text/css',body:'/* External font delivery suppressed by offline QA fence; fallback fonts only. */'});return route.abort();}
 if(/^\/(api|v1)\//.test(u.pathname)) {
 if(req.method()!=='GET') {
 const record={path:u.pathname,method:req.method(),body:req.postDataJSON()};writes.push(record);
 if(u.pathname==='/api/model-test') {assert.deepEqual(record.body,{model:'openai/fixture-model',connectionId:account.id});assert.equal(req.headers().authorization,undefined);return route.fulfill({json:{ok:true,status:'success',model:'openai/fixture-model',output:'Synthetic completion — not live provider evidence',observedAt:'2026-11-11T00:00:00Z'}});}
 if(u.pathname===`/api/connections/${account.id}/test`)return route.fulfill({json:{ok:true,error:null}});
 unexpected.push(`${req.method()} ${u.pathname}`);return route.fulfill({status:501,json:{error:'Unexpected synthetic write'}});
 }
 if(u.pathname==='/api/usage/analytics')return route.fulfill({json:{...analytics,range:u.searchParams.get('range')??'7d',provider:u.searchParams.get('provider')??null}});
 if(Object.hasOwn(known,u.pathname))return route.fulfill({json:known[u.pathname]});
 unexpected.push(`GET ${u.pathname}`);return route.fulfill({status:501,json:{error:'Unknown fixture path'}});
 }
 return route.continue();
 });
 for(const route of ['', 'providers?tab=apikey','providers/openai?auth=apikey','models','routing','keys','tools','quota','usage','activity','audit','settings']) {
 await page.goto(`${origin}/panel/${route}`);await page.locator('h1').waitFor();await page.locator('.page').waitFor();if(route==='usage')await page.getByRole('heading',{name:language==='id'?'Laporan bulanan':'Monthly report',exact:true}).waitFor();
 // Explicit fixture marker belongs to evidence harness, never production UI.
 await page.evaluate(()=>{const n=document.createElement('p');n.textContent='SYNTHETIC QA FIXTURE · no live providers';n.style.cssText='font:12px monospace;margin:0;padding:4px;color:inherit';document.querySelector('main').prepend(n);});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
 const name=route.split('?')[0].replaceAll('/','-')||'overview';
 await page.screenshot({path:`${output}/${name}-${theme}-${language}-${width}.png`,fullPage:true});
 results.push({route,width,theme,language,overflow});assert.equal(overflow,0,`${route} overflow ${width}`);
 }
 assert.equal(writes.length,0,'navigation must never infer or refresh credentials');
 if(language==='en') {
  // Settings retain all four domains and their actionable forms.
  for(const [tab,expected] of [['Security','Management password'],['Database Backups','Database Backups'],['Advanced','Configuration inspector'],['Health & Versions','Upstream CLI Version Drift & Pinning']]) {
   if(width<=860)await page.getByLabel('Settings sections',{exact:true}).selectOption({'Security':'security','Database Backups':'backups','Advanced':'advanced','Health & Versions':'health'}[tab]);else await page.getByRole('tab',{name:tab,exact:true}).click();await page.getByRole('heading',{name:expected,exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth),0);
   await page.screenshot({path:`${output}/settings-${tab.replaceAll(' ','-')}-${theme}-${language}-${width}.png`,fullPage:true});
  }
  await page.goto(`${origin}/panel/routing`);
  await page.getByRole('button',{name:'New combo',exact:true}).click();
  await page.getByRole('dialog').getByLabel('Combo name').fill('Synthetic cancel-only combo');
  page.once('dialog',async dialog=>{assert.equal(dialog.type(),'confirm');await dialog.accept();});
  await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(writes.length,0);
  if(width<=860)await page.getByLabel('Routing workspace',{exact:true}).selectOption('policies');else await page.getByRole('tab',{name:'Failover & Aliases',exact:true}).click();
  const disabledFlags=page.locator('input[type="checkbox"][disabled][title="Excluded from publication candidate"]');
  await disabledFlags.first().waitFor();assert.equal(await disabledFlags.count(),2);for(const checkbox of await disabledFlags.all())assert.equal(await checkbox.isChecked(),false);
  await page.screenshot({path:`${output}/routing-policies-${theme}-${language}-${width}.png`,fullPage:true});
  if(width<=860)await page.getByLabel('Routing workspace',{exact:true}).selectOption('trace');else await page.getByRole('tab',{name:'Decision Trace',exact:true}).click();await page.getByRole('heading',{name:'Live Routing Decision Trace',exact:true}).waitFor();
  await page.goto(`${origin}/panel/settings`);
 }

 // Desktop is persistent nonmodal; mobile remains a focus-contained drawer.
 const trigger=page.locator('.shell-nav-trigger');
 if(width>860) {
  assert.equal(await page.getByRole('dialog').count(),0);
  assert.ok(await page.locator('.is-desktop .nav-link').first().isVisible());
  assert.equal(await page.locator('.is-desktop').evaluate(e=>e.getBoundingClientRect().width),248);
  await trigger.click();assert.equal(await page.locator('.is-desktop').evaluate(e=>e.getBoundingClientRect().width),64);
  assert.equal(await page.locator('.shell-workspace').evaluate(e=>e.inert),false);await trigger.click();
 } else {
  await trigger.focus();await page.keyboard.press('Enter');await page.getByRole('dialog',{name:language==='id'?'Navigasi utama':'Main navigation'}).waitFor();
  assert.equal(await trigger.getAttribute('aria-expanded'),'true');await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(()=>document.querySelector('.shell-drawer').contains(document.activeElement)),true);
  await page.keyboard.press('Escape');assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
 }
 assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
 // Native chart data alternatives work by keyboard without inference.
 await page.goto(`${origin}/panel/`);
 const chartSummary=page.locator('summary').filter({hasText:language==='id'?'Lihat data grafik':'View chart data'}).first();
 await chartSummary.focus();await page.keyboard.press('Enter');assert.equal(await page.locator('.chart-data-alternative[open] table').count(),1);
 // Exact account inference only after explicit confirmation.
 await page.goto(`${origin}/panel/providers/openai?auth=apikey`);
 if(width<=860)await page.getByRole('button',{name:account.name,exact:true}).click();
 await page.getByRole('button',{name:language==='id'?'Uji Model':'Test Model',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.getByLabel('Model',{exact:true}).selectOption('fixture-model');assert.equal(writes.length,0);
 await dialog.getByRole('button',{name:language==='id'?'Jalankan inferensi':'Run inference',exact:true}).click();await dialog.getByText('Synthetic completion — not live provider evidence',{exact:true}).waitFor();
 assert.equal(writes.length,1);await page.keyboard.press('Escape');
 await context.route('**/api/auth/status',r=>r.fulfill({json:{authenticated:false}}));
 await page.goto(`${origin}/panel/settings`);await page.locator('.login-card').waitFor();
 await page.screenshot({path:`${output}/login-${theme}-${language}-${width}.png`,fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth),0);

 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
 await writeFile(`${output}/ledger-${theme}-${language}-${width}.json`,JSON.stringify({synthetic:true,writes,errors,unexpected,blocked},null,2));
 await context.close();console.log(`PASS full-route fixture sweep ${width} ${theme} ${language}`);
 }
} finally {await browser.close();await writeFile(`${output}/route-matrix.json`,JSON.stringify(results,null,2));}
