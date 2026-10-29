import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin=process.env.PANEL_TEST_URL || 'http://127.0.0.1:5198';
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname)) throw Error('Local fixture only');
const row=(id,n)=>({provider:id==='alpha'?'Alpha':'Beta',providerId:id,requests:n,totalTokens:n*10,avgLatencyMs:10,successRatePct:100,cost:0});
function report(range, provider) {const rows=provider?[row(provider,provider==='alpha'?3:7)]:[row('alpha',3),row('beta',7)]; const n=rows.reduce((s,r)=>s+r.requests,0); return {range,provider:provider||null,summary:{totalRequests:n,promptTokens:n*5,completionTokens:n*5,avgLatencyMs:10,totalCost:0,successRatePct:100},dailyTrend:[{date:'2026-01-20',requests:n,totalTokens:n*10,cost:0}],byProvider:rows,byModel:rows.map(r=>({...r,model:r.providerId+'-model'})),byAccount:rows.map(r=>({account:r.providerId+'-account',requests:r.requests,totalTokens:r.totalTokens,lastUsed:null})),byApiKey:rows.map(r=>({apiKeyName:r.providerId+'-key',requests:r.requests,totalTokens:r.totalTokens,cost:0})),errorBreakdown:rows.map(r=>({errorType:r.providerId+'-error',count:r.requests}))};}
test('selecting a provider scopes every table and downloaded CSV content',async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try {const page=await browser.newPage({acceptDownloads:true}); const requests=[],errors=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());if(u.pathname.startsWith('/api/')){requests.push(u);let data;if(u.pathname==='/api/usage/analytics') data=report(u.searchParams.get('range'),u.searchParams.get('provider'));else if(u.pathname==='/api/providers')data={providers:[{id:'alpha',name:'Alpha'},{id:'beta',name:'Beta'}]};else if(u.pathname==='/api/provider-nodes')data={nodes:[]};else return route.fulfill({status:501,json:{error:'unexpected'}});return route.fulfill({json:data});} if(u.origin!==new URL(origin).origin||req.method()!=='GET')return route.abort();return route.continue();});
 await page.goto(`${origin}/panel/tests/usage-provider.fixture.html`); await page.locator('option[value="alpha"]').waitFor({state:'attached'});
 const providerSection=page.locator('section').filter({has:page.getByRole('heading',{name:'By provider'})});
 const focus=providerSection.getByRole('button',{name:'Focus Alpha'}); await focus.focus(); await page.keyboard.press('Enter'); await page.getByText('alpha-account',{exact:true}).waitFor();
 assert.equal(await page.getByLabel('Provider',{exact:true}).inputValue(),'alpha');
 assert.match(await providerSection.getByRole('link',{name:'Accounts Alpha'}).getAttribute('href'),/providers\/alpha/);
 const bar=page.getByLabel('2026-01-20: 3'); await bar.focus(); assert.equal(await page.locator('p[aria-live="polite"]').textContent(),'2026-01-20: 3');
 assert.equal(await page.getByText('Retained raw records only; older daily summaries cannot be attributed to accounts, so these totals may be incomplete.').count(),1);
 assert.equal(await page.getByText('Retained raw records only; older daily summaries cannot be attributed to API keys, so these totals may be incomplete.').count(),1);
 assert.equal(await page.getByText('beta-account',{exact:true}).count(),0);assert.equal(await page.getByText('beta-key',{exact:true}).count(),0);assert.equal(await page.getByText('beta-error',{exact:true}).count(),0);assert.ok(requests.some(u=>u.pathname==='/api/usage/analytics'&&u.searchParams.get('provider')==='alpha'));
 const section=page.locator('section').filter({has:page.getByRole('heading',{name:'By provider'})}); const [download]=await Promise.all([page.waitForEvent('download'),section.getByRole('button',{name:'CSV'}).click()]); const csv=await readFile(await download.path(),'utf8'); assert.match(csv,/"Alpha","3","30"/);assert.doesNotMatch(csv,/beta/i);assert.equal(download.suggestedFilename(),'usage-by-provider-30d-provider-alpha.csv');
 const monthly=page.locator('section').filter({has:page.getByRole('heading',{name:'Monthly report'})});const [d2]=await Promise.all([page.waitForEvent('download'),monthly.getByRole('button',{name:'CSV'}).click()]);const csv2=await readFile(await d2.path(),'utf8');assert.match(csv2,/"2026-01","3","30","0"/);
 await page.getByLabel('Provider',{exact:true}).selectOption('');await page.getByText('beta-account',{exact:true}).waitFor();assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});

test('duplicate model IDs remain attributed when focusing either provider', async () => {
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try {
  const page=await browser.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{const req=route.request(),u=new URL(req.url()); if(u.pathname.startsWith('/api/')) {let data;if(u.pathname==='/api/usage/analytics'){data=report(u.searchParams.get('range'),u.searchParams.get('provider'));data.byModel=data.byModel.map(m=>({...m,model:'shared-model',provider:m.providerId}));} else if(u.pathname==='/api/providers')data={providers:[{id:'alpha',name:'Alpha'},{id:'beta',name:'Beta'}]};else if(u.pathname==='/api/provider-nodes')data={nodes:[]};else return route.fulfill({status:501,json:{}});return route.fulfill({json:data});} if(u.origin!==new URL(origin).origin||req.method()!=='GET')return route.abort();return route.continue();});
  await page.goto(`${origin}/panel/tests/usage-provider.fixture.html`);
  const models=page.locator('section').filter({has:page.getByRole('heading',{name:'By model'})});
  await page.getByRole('button',{name:'Focus Alpha'}).waitFor();
  assert.equal(await models.getByText('shared-model',{exact:true}).count(),2);
  assert.match(await models.innerText(),/Alpha\s+3/); assert.match(await models.innerText(),/Beta\s+7/);
  await page.getByRole('button',{name:'Focus Beta'}).click();
  await page.getByText('beta-account',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Provider',{exact:true}).inputValue(),'beta');
  assert.equal(await models.getByText('shared-model',{exact:true}).count(),1);
  assert.match(await models.innerText(),/Beta\s+7/); assert.doesNotMatch(await models.innerText(),/Alpha/);
  await page.getByLabel('Provider',{exact:true}).selectOption('alpha'); await page.getByText('alpha-account',{exact:true}).waitFor();
  assert.match(await models.innerText(),/Alpha\s+3/); assert.doesNotMatch(await models.innerText(),/Beta/); assert.deepEqual(errors,[]);
 } finally {await browser.close();}
});

test('row and chart interactions work across viewports, languages and themes', async () => {
 const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try { for (const width of [320,390,1024,1440]) for (const language of ['en','id']) for (const theme of ['light','dark']) {
  const page=await browser.newPage({viewport:{width,height:800},reducedMotion:'reduce'}); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({language,theme})=>localStorage.setItem('styx-panel-preferences',JSON.stringify({language,theme})),{language,theme});
  await page.route('**/*',async route=>{const req=route.request(),u=new URL(req.url()); if(u.pathname.startsWith('/api/')) {let data;if(u.pathname==='/api/usage/analytics')data=report(u.searchParams.get('range'),u.searchParams.get('provider'));else if(u.pathname==='/api/providers')data={providers:[{id:'alpha',name:'Alpha'},{id:'beta',name:'Beta'}]};else if(u.pathname==='/api/provider-nodes')data={nodes:[]};else return route.fulfill({status:501,json:{}});return route.fulfill({json:data});} if(u.origin!==new URL(origin).origin||req.method()!=='GET')return route.abort();return route.continue();});
  await page.goto(`${origin}/panel/tests/usage-provider.fixture.html`); const button=page.getByRole('button',{name:language==='id'?'Fokus Alpha':'Focus Alpha'}); await button.waitFor();
  assert.equal(await page.locator('button a, a button').count(),0); await button.locator('xpath=../..').locator('td').nth(1).click(); await page.getByText('alpha-account',{exact:true}).waitFor();
  const bar=page.getByLabel('2026-01-20: 3'); await bar.hover(); assert.equal(await page.locator('p[aria-live="polite"]').textContent(),'2026-01-20: 3'); await bar.focus(); assert.equal(await page.locator('p[aria-live="polite"]').textContent(),'2026-01-20: 3');
  assert.match(await page.getByRole('link',{name:language==='id'?'Akun Alpha':'Accounts Alpha'}).getAttribute('href'),/\/panel\/providers\/alpha\?tab=accounts/); assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)); assert.deepEqual(errors,[]); await page.close();
 } } finally {await browser.close();}
}, 120000);
