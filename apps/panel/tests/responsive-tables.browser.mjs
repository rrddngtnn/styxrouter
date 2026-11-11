// Isolated local browser regression. API calls are mocked and all non-local traffic blocked.
// PANEL_TEST_URL=http://127.0.0.1:5197/panel/ PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs CHROMIUM_PATH=/path/to/chrome node --test apps/panel/tests/responsive-tables.browser.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.PANEL_TEST_URL || 'http://127.0.0.1:5198/panel/');
if (!['localhost','127.0.0.1','[::1]'].includes(base.hostname)) throw new Error('local server required');
const out = resolve(process.env.TABLE_SCREENSHOTS || resolve(process.env.TMPDIR || process.cwd(), 'styxrouter-browser-tests', 'responsive-tables'));
const longIdentity = 'fixture-identity-' + 'abcdefghijklmno'.repeat(5);
const row = {id:'fixture',timestamp:'2026-01-01T00:00:00Z',method:'POST',path:'/v1/messages',status:200,model:'fixture-model',provider:'demo',account:'Example account',duration:50,tokens:{in:20,out:10},apiKeyName:'Example key'};
const metrics={requests:12,totalTokens:900,avgLatencyMs:40,successRatePct:95,cost:0.1};
const fixtures={
  '/api/auth/status':{authenticated:true}, '/api/providers':{providers:[{id:'demo',name:'Demo',authModes:['oauth']}]}, '/api/provider-nodes':{nodes:[]},
  '/api/usage/call-logs':[row], '/v1/models':{data:[{id:'demo/fixture-model',owned_by:'demo',context_length:4096}]},
  '/api/keys':{keys:[{id:'k1',name:'Example key',prefix:'fixture',isActive:true,createdAt:'2026-01-01'}]},
  '/api/routing/combos':{combos:[{id:'c1',name:'Example combo',strategy:'priority',models:['demo/fixture-model'],steps:1,enabled:true}]},
  '/api/audit-log':{entries:[{id:1,timestamp:'2026-01-01T00:00:00Z',action:'fixture.action',actor:'Example actor',target:'Example target',details:{example:'value'},status:'ok'}]},
  '/api/settings':{fallbackStrategy:'priority',exampleSetting:'Example value'},
  '/api/versions/zcode/status':{}, '/api/versions/antigravity/ide/status':{}, '/api/versions/antigravity/cli/status':{},
  '/api/process-health/start':{startedAt:null}, '/api/process-health/peak':{peakRssBytes:null},
  '/api/process-health/cpu':{userMicroseconds:0,systemMicroseconds:0}, '/api/process-health/threads':{threadCount:null},
  '/api/process-health/token-scheduler':{}, '/api/process-health/dispatch':{providers:[]},
  '/api/routing/trace':{events:[]}, '/api/storage-health':{databaseBytes:null,walBytes:null},
  '/api/storage-health/vacuum':{lastSuccessfulSchedulerVacuumAt:null},
  '/api/backups':{backups:[{id:'b1',filename:'example.sqlite',reason:'manual',size:400,createdAt:'2026-01-01T00:00:00Z'}]},
  '/api/connections':{connections:[{id:'a1',provider:'demo',name:'Example account',isActive:true,testStatus:'active',backoffLevel:0}]},
  '/api/oauth/providers':{providers:[]}, '/api/usage/quota':{providers:[]},
  '/api/usage/analytics':{summary:{totalRequests:12,promptTokens:300,completionTokens:600,avgLatencyMs:40,successRatePct:95,totalCost:0.1},dailyTrend:[{date:'2026-01-01',requests:12,totalTokens:900,cost:0.1}],byProvider:[{provider:'demo',...metrics}],byModel:[{model:'fixture-model',provider:'demo',...metrics}],byAccount:[{account:'Example account',lastUsed:'2026-01-01T00:00:00Z',...metrics}],byApiKey:[{apiKeyName:'Example key',...metrics}],errorBreakdown:[{errorType:'429',count:1}]},
};
test('checkbox-first tables keep selection and identity visible when scrolled', async () => {
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  try {
    const page=await browser.newPage({viewport:{width:900,height:900},reducedMotion:'reduce'});
    await page.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());if(u.pathname.startsWith('/api/')||u.pathname.startsWith('/v1/')) return route.fulfill({status:fixtures[u.pathname]?200:501,json:fixtures[u.pathname]||{error:'unexpected'}});if(u.origin!==base.origin||req.method()!=='GET') return route.abort();return route.continue();});
    for(const [path,text] of [['keys','Example key'],['routing','Example combo'],['providers/demo','Example account']]) {
      await page.goto(new URL(path,base).href);
      const cell=page.locator('tbody tr').filter({hasText:text}).first().locator('td').nth(1); await cell.waitFor();
      const region=cell.locator('xpath=ancestor::*[@role="region"]').first();
      const checkbox=cell.locator('xpath=../td[1]//input[@type="checkbox"]');
      await checkbox.focus(); await page.keyboard.press('Space'); assert.equal(await checkbox.isChecked(),true,`${path} keyboard selection`);
      await region.evaluate(e=>{e.scrollLeft=e.scrollWidth;});
      const geometry=await cell.evaluate(e=>{const r=e.closest('[role=region]').getBoundingClientRect(),a=e.previousElementSibling.getBoundingClientRect(),b=e.getBoundingClientRect();return {r:r.left,a:a.left,ar:a.right,b:b.left,br:b.right,rr:r.right,position:getComputedStyle(e).position};});
      assert.equal(geometry.position,'sticky',`${path} identity sticky`);
      assert.ok(Math.abs(geometry.a-geometry.r)<2 && Math.abs(geometry.b-geometry.ar)<2 && geometry.br<geometry.rr,`${path} identity geometry ${JSON.stringify(geometry)}`);
    }
  } finally {await browser.close();}
});

test('long identities remain usable across viewport, theme and language', async () => {
  await mkdir(out,{recursive:true});
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  try {
    for(const width of [861,1024,1280]) for(const theme of ['light','dark']) for(const language of ['en','id']) {
      const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
      const errors=[]; page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript(p=>localStorage.setItem('styx-panel-preferences',JSON.stringify(p)),{theme,language});
      await page.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());if(u.pathname.startsWith('/api/')||u.pathname.startsWith('/v1/')) {let value=fixtures[u.pathname];if(u.pathname==='/api/keys') value={keys:[{...fixtures[u.pathname].keys[0],name:longIdentity}]};if(u.pathname==='/api/routing/combos') value={combos:[{...fixtures[u.pathname].combos[0],name:longIdentity}]};if(u.pathname==='/api/connections') value={connections:[{...fixtures[u.pathname].connections[0],name:longIdentity}]};return route.fulfill({status:value?200:501,json:value||{error:'unexpected'}});}if(u.origin!==base.origin||req.method()!=='GET')return route.abort();return route.continue();});
      for(const path of ['keys','routing','providers/demo']) {
        await page.goto(new URL(path,base).href); const cell=page.locator('tbody tr').filter({hasText:longIdentity}).first().locator('td').nth(1);await cell.waitFor();
        const region=cell.locator('xpath=ancestor::*[@role="region"]').first(), checkbox=cell.locator('xpath=../td[1]//input[@type="checkbox"]');
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth),0,`${path} page overflow`);
        const dims=await region.evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth,theme:document.documentElement.dataset.theme}));assert.equal(dims.theme,theme);
        await checkbox.focus();await page.keyboard.press('Space');assert.equal(await checkbox.isChecked(),true);
        if(dims.scroll>dims.width+1) {await region.focus();await page.keyboard.press('ArrowRight');await region.evaluate(e=>new Promise(resolve=>{const start=performance.now();const poll=()=>e.scrollLeft>0||performance.now()-start>2000?resolve():requestAnimationFrame(poll);poll();}));assert.ok(await region.evaluate(e=>e.scrollLeft)>0);}
        await region.evaluate(e=>{e.scrollLeft=e.scrollWidth;});
        const g=await cell.evaluate(e=>{const r=e.closest('[role=region]').getBoundingClientRect(),a=e.previousElementSibling.getBoundingClientRect(),b=e.getBoundingClientRect(),inner=e.querySelector('.table-identity');return {left:r.left,right:r.right,a:a.left,ar:a.right,b:b.left,br:b.right,innerScroll:inner.scrollWidth,innerWidth:inner.clientWidth};});
        assert.ok((width>1023 || (Math.abs(g.a-g.left)<2 && Math.abs(g.b-g.ar)<2 && g.br<g.right)) && g.innerScroll<=g.innerWidth+1,`${path} sticky long identity ${JSON.stringify(g)}`);
        await page.screenshot({path:resolve(out,`${path.replaceAll('/','-')}-${width}-${theme}-${language}-scrolled.png`),fullPage:true,animations:'disabled'});
      }
      assert.deepEqual(errors,[]);await page.close();
    }
  } finally {await browser.close();}
});

test('Activity table is a keyboard-scrollable labelled region without page overflow', async () => {
  await mkdir(out,{recursive:true});
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  try {
    const page = await browser.newPage({viewport:{width:900,height:720},reducedMotion:'reduce'});
    const errors=[]; page.on('pageerror', e=>errors.push(e.message));
    await page.route('**/*', async route => {
      const r=route.request(), u=new URL(r.url());
      if(u.pathname.startsWith('/api/') || u.pathname.startsWith('/v1/')) {

        return route.fulfill({status:fixtures[u.pathname] ? 200 : 501,json:fixtures[u.pathname] || {error:'unexpected fixture endpoint'}});
      }
      if(u.origin!==base.origin || r.method()!=='GET') return route.abort();
      return route.continue();
    });
    await page.goto(new URL('activity',base).href);
    await page.getByText('fixture-model',{exact:true}).waitFor();
    await page.screenshot({path:resolve(out,'activity-320.png'),fullPage:true,animations:'disabled'});
    const region=page.getByRole('region',{name:'Activity table'});
    assert.equal(await region.count(),1,'table needs a named region');
    assert.equal(await region.getAttribute('tabindex'),'0');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth),0);
    await region.focus();
    const before=await region.evaluate(e=>e.scrollLeft);
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(250);
    assert.ok(await region.evaluate(e=>e.scrollLeft)>before,'keyboard must move horizontal scroll');
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});

test('Activity and audit detail rows can be opened by keyboard', async () => {
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
  try {
    const page=await browser.newPage({viewport:{width:900,height:720}});
    await page.route('**/*',async route=>{const req=route.request(),u=new URL(req.url()); if(u.pathname.startsWith('/api/')||u.pathname.startsWith('/v1/')) return route.fulfill({status:fixtures[u.pathname]?200:501,json:fixtures[u.pathname]||{error:'unexpected'}}); if(u.origin!==base.origin||req.method()!=='GET') return route.abort(); return route.continue();});
    for(const path of ['activity','audit']) {
      await page.goto(new URL(path,base).href);
      const button=page.locator('.table-scroll-region tbody tr').first().getByRole('button'); await button.waitFor();
      await button.focus(); assert.equal(await button.evaluate(e=>document.activeElement===e),true,`${path} detail button must be focusable`);
      await page.keyboard.press('Enter'); assert.equal(await page.getByRole('dialog').count(),1,`${path} Enter opens details`);
      await page.keyboard.press('Escape');
    }
  } finally {await browser.close();}
});

test('provider account table audit at requested widths', async () => {
  await mkdir(out,{recursive:true});
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
  try {
    for(const width of [861,1024,1280]) {
      const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
      await page.route('**/*',async route=>{const req=route.request(),u=new URL(req.url()); if(u.pathname.startsWith('/api/')||u.pathname.startsWith('/v1/')) return route.fulfill({status:fixtures[u.pathname]?200:501,json:fixtures[u.pathname]||{error:'unexpected'}}); if(u.origin!==base.origin||req.method()!=='GET') return route.abort(); return route.continue();});
      await page.goto(new URL('providers/demo',base).href);
      await page.getByText('Example account',{exact:true}).first().waitFor();
      await page.screenshot({path:resolve(out,`provider-accounts-${width}.png`),fullPage:true,animations:'disabled'});
      const region=page.getByRole('region',{name:'Connected accounts'});
      const result=await region.evaluate(p=>({global:document.documentElement.scrollWidth-document.documentElement.clientWidth,label:p.getAttribute('aria-label'),tab:p.getAttribute('tabindex'),overflow:getComputedStyle(p).overflowX,width:p.clientWidth,scroll:p.scrollWidth,first:getComputedStyle(p.querySelector('tbody td:nth-child(2)')).position}));
      console.log(`provider-accounts-${width}: ${JSON.stringify(result)}`);
      assert.ok(result.label,'provider accounts region must be labelled');
      assert.equal(result.global,0);
      if(result.scroll>result.width) {await region.focus();await page.keyboard.press('ArrowRight');await page.waitForTimeout(150);assert.ok(await region.evaluate(el=>el.scrollLeft)>0,'provider table keyboard scroll');}
      await page.close();
    }
  } finally {await browser.close();}
});

test('Indonesian dark scroll hint and label are visible on overflow', async () => {
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
  try {
    const page=await browser.newPage({viewport:{width:900,height:844},reducedMotion:'reduce'});
    await page.addInitScript(()=>localStorage.setItem('styx-panel-preferences',JSON.stringify({language:'id',theme:'dark'})));
    await page.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());if(u.pathname.startsWith('/api/')||u.pathname.startsWith('/v1/')) return route.fulfill({status:fixtures[u.pathname]?200:501,json:fixtures[u.pathname]||{error:'unexpected'}});if(u.origin!==base.origin||req.method()!=='GET')return route.abort();return route.continue();});
    await page.goto(new URL('activity',base).href);
    const region=page.getByRole('region',{name:'Tabel aktivitas'}); await region.waitFor();
    assert.equal(await page.getByText('Geser tabel ke samping ↔').isVisible(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');
    await region.focus(); await region.evaluate(e=>{e.scrollLeft=e.scrollWidth;});
    await page.screenshot({path:resolve(out,'activity-390-dark-id-scrolled.png'),fullPage:true,animations:'disabled'});
    assert.ok(await region.evaluate(e=>e.scrollLeft)>0);
  } finally {await browser.close();}
});

for (const width of [861,1024,1280]) test(`populated panel tables at ${width}px`, async () => {
  await mkdir(out,{recursive:true});
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  try {
    const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
    const errors=[],unexpected=[],problems=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',async route=>{
      const req=route.request(),u=new URL(req.url());
      if(u.pathname.startsWith('/api/')||u.pathname.startsWith('/v1/')) {
        if(req.method()!=='GET'||!fixtures[u.pathname]) {unexpected.push(`${req.method()} ${u.pathname}`);return route.fulfill({status:501,json:{error:'unexpected fixture endpoint'}});}
        return route.fulfill({json:fixtures[u.pathname]});
      }
      if(u.origin!==base.origin||req.method()!=='GET') return route.abort();
      return route.continue();
    });
    for(const [path,label,tab,expected] of [
      ['activity','Activity table',null,1],['usage','Usage by provider table',null,6],['models','Models table',null,1],
      ['keys','API keys table',null,1],['routing','Routing combos table',null,1],['audit','Audit log table',null,1],
      ['settings','Database backups table','Database Backups',1],['settings','Configuration table','Advanced',1],
    ]) {
      await page.goto(new URL(path,base).href);
      if(tab) await page.getByRole('tab',{name:tab}).click();
      const target=page.getByRole('region',{name:label});
      try {await target.waitFor({timeout:7000});} catch {problems.push(`${path}/${tab}: missing table`);continue;}
      await page.screenshot({path:resolve(out,`${path}${tab?'-'+tab.replaceAll(' ','-').toLowerCase():''}-${width}.png`),fullPage:true,animations:'disabled'});
      const regions=page.locator('.table-scroll-region');
      if(await regions.count()!==expected) problems.push(`${path}: expected ${expected} tables, got ${await regions.count()}`);
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
      if(overflow>0) problems.push(`${path}/${tab}: document overflow ${overflow}px`);
      for(const region of await regions.all()) {
        const geom=await region.evaluate(e=>({label:e.getAttribute('aria-label'),tab:e.tabIndex,width:e.clientWidth,scroll:e.scrollWidth,sticky:!!e.closest('.table-scroll-sticky') && innerWidth<=1023,hint:!!e.parentElement.querySelector('.table-scroll-hint')}));
        if(!geom.label||geom.tab!==0) problems.push(`${path}: unlabeled/unfocusable ${JSON.stringify(geom)}`);
        if(geom.hint!==(geom.scroll>geom.width+1)) problems.push(`${path}: incorrect overflow hint ${JSON.stringify(geom)}`);
        if(geom.scroll<=geom.width+1) continue;
        await region.focus(); await page.keyboard.press('ArrowRight');
        await region.evaluate(el=>new Promise(resolve=>{const start=performance.now();const poll=()=>el.scrollLeft>0||performance.now()-start>2000?resolve():requestAnimationFrame(poll);poll();}));
        const moved=await region.evaluate(e=>e.scrollLeft);
        if(moved<=0) problems.push(`${path}: keyboard did not scroll ${geom.label}`);
        if(geom.sticky) {
          const sticky=await region.locator('tbody td:first-child').first().evaluate(e=>({pos:getComputedStyle(e).position,left:e.getBoundingClientRect().left,parent:e.closest('.table-scroll-region').getBoundingClientRect().left}));
          if(sticky.pos!=='sticky'||Math.abs(sticky.left-sticky.parent)>2) problems.push(`${path}: sticky failure ${JSON.stringify(sticky)}`);
        }
      }
    }
    assert.deepEqual(errors,[],'page errors'); assert.deepEqual(unexpected,[],'unexpected requests'); assert.deepEqual(problems,[],'layout problems');
  } finally {await browser.close();}
});
