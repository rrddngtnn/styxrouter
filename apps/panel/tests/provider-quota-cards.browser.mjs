// Run against a local panel server only, e.g.:
// PANEL_TEST_URL=http://127.0.0.1:5198/panel/ PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs CHROMIUM_PATH=/path/to/chrome node --test apps/panel/tests/provider-quota-cards.browser.mjs
// All API requests are fulfilled here; unexpected requests fail closed. No real credentials.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.PANEL_TEST_URL || 'http://127.0.0.1:5198/panel/');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('Only a local, isolated panel server may be tested');
const out = resolve(process.env.QUOTA_SCREENSHOTS || resolve(process.env.TMPDIR || process.cwd(), 'styxrouter-browser-tests', 'provider-quota-cards'));
const providers = [
  { id: 'alpha', name: 'Alpha Example', vendor: 'Example', authModes: ['oauth', 'apikey'] },
  { id: 'beta', name: 'Beta Example', vendor: 'Example', authModes: ['oauth', 'apikey'] },
  { id: 'gamma', name: 'Gamma Example', vendor: 'Example', authModes: ['oauth'] },
];
const windows = Array.from({length: 6}, (_, i) => ({key: `window-${i+1}`, label: `Fixture window ${i+1}`, used: 20, total: 100, remaining: 80, percentRemaining: 80, resetAt: '2030-01-01T12:00:00.000Z', unlimited: false, models: [`fixture-model-${i+1}`]}));
const row = (id, name, provider, extra = {}) => ({connectionId:id, name, provider, isActive:true, plan:'Fixture Plus', fetchedAt:'2026-10-27T12:00:00.000Z', tokenStatus:'valid', quotaSupported:true, quotaUsed:20, quotaTotal:100, percentRemaining:80, resetAt:'2030-01-01T12:00:00.000Z', windows, ...extra});
const rows = [row('alice','Alice Sample','alpha'), row('bob','Bob Fixture','alpha',{windows:[], fetchedAt:null, message:'Fixture quota error'}), row('betty','Betty Sample','beta',{windows:[],quotaSupported:false}), row('gwen','Gwen Sample','gamma',{windows:[],fetchedAt:null})];
const connections = rows.map(r => ({id:r.connectionId, name:r.name, provider:r.provider, isActive:true, testStatus:'active', lastError:null, backoffLevel:0}));
const viewports = [{width:1440,height:900},{width:1024,height:768},{width:768,height:1024},{width:390,height:844},{width:320,height:720}];
let browser;
test.before(async () => { await mkdir(out,{recursive:true}); browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']}); });
test.after(async () => { await browser?.close(); });
async function setup({viewport={width:1440,height:900},theme='light',language='en',reducedMotion='no-preference',fixtureRows=rows,refreshResponses=[]} = {}) {
  const context = await browser.newContext({viewport, reducedMotion});
  const page = await context.newPage(); const requests = [], errors = [], unexpected = [];
  page.setDefaultTimeout(5000);
  page.setDefaultNavigationTimeout(30000);
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(({theme,language}) => localStorage.setItem('styx-panel-preferences', JSON.stringify({theme,language,providerView:'cards'})), {theme,language});
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    if (path.startsWith('/api/') || path.startsWith('/v1/')) {
      requests.push({path,method:req.method()});
      let json;
      if (path === '/api/auth/status') json = {authenticated:true};
      else if (path === '/api/providers') json = {providers};
      else if (path === '/api/provider-nodes') json = {nodes:[]};
      else if (path === '/api/connections') json = {connections};
      else if (path === '/api/oauth/providers') json = {providers:[]};
      else if (path === '/api/usage/quota') json = {providers:fixtureRows};
      else if (path === '/api/usage/provider-limits' && req.method() === 'POST') json = {succeeded:3,total:3,failed:0};
      else if (path === '/api/usage/alice' && req.method() === 'GET') {
        const response = refreshResponses.shift();
        if (response) return route.fulfill(response);
        json = {quotas:{session:{used:20,total:100,remaining:80,remainingPercentage:80,resetAt:'2030-01-01T12:00:00.000Z'}}};
      }
      else { unexpected.push(`${req.method()} ${path}`); return route.fulfill({status:501,json:{error:'Unexpected fixture endpoint'}}); }
      return route.fulfill({json});
    }
    // The app currently references hosted font CSS. Block it rather than contacting Google;
    // use fallback fonts in these isolated screenshots.
    if (url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com') return route.abort();
    // Only allow local Vite assets; prevent third-party logos, telemetry and live APIs.
    if (url.origin !== base.origin || !['GET','HEAD'].includes(req.method())) { unexpected.push(`${req.method()} ${url.origin}${path}`); return route.abort(); }
    return route.continue();
  });
  return {context,page,requests,errors,unexpected};
}
async function go(page,path,marker) { await page.goto(new URL(path,base).href); await page.getByText(marker,{exact:true}).first().waitFor(); }
function clean(s) { assert.deepEqual(s.errors,[], 'uncaught page errors'); assert.deepEqual(s.unexpected,[], 'unexpected network requests'); }
async function close(s) { await s.context.close(); }

// Screenshots are taken before geometry assertions so a failing layout remains inspectable.
for (const viewport of viewports) for (const theme of ['light','dark']) for (const language of ['en','id']) {
  test(`screenshots ${viewport.width} ${theme} ${language}`, async () => {
    const s = await setup({viewport,theme,language,reducedMotion:'reduce'});
    try {
      const problems = [];
      for (const [path, marker] of [['quota','Alice Sample'],['providers?tab=oauth','Alpha Example']]) {
        await go(s.page,path,marker);
        await s.page.screenshot({path:resolve(out,`${path.startsWith('quota')?'quota':'providers'}-${viewport.width}-${theme}-${language}.png`),fullPage:true,animations:'disabled'});
        const state = await s.page.evaluate(() => ({overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth, theme:document.documentElement.dataset.theme, lang:document.documentElement.lang}));
        if (state.overflow > 0) problems.push(`${path}: page overflow ${state.overflow}px`);
        if (state.theme !== theme || state.lang !== language) problems.push(`${path}: preference mismatch ${JSON.stringify(state)}`);
        if (path === 'quota') {
          const metrics = await s.page.locator('.quota-page button:visible, .quota-page input:visible, .quota-page select:visible, .quota-page summary:visible').evaluateAll(els => els.map(el => { const r=el.getBoundingClientRect(), c=getComputedStyle(el); return {label:el.getAttribute('aria-label') || el.textContent.trim(), width:r.width,height:r.height,left:r.left,right:r.right,transition:c.transitionDuration,animation:c.animationDuration}; }));
          const small=metrics.filter(m=>m.width<44||m.height<44||m.left < -1||m.right>viewport.width+1);
          if (small.length) problems.push(`${path}: invalid targets ${JSON.stringify(small)}`);
          const moving=metrics.filter(m=>[...m.transition.split(','),...m.animation.split(',')].some(duration=>parseFloat(duration)>0));
          if (moving.length) problems.push(`${path}: reduced motion ${JSON.stringify(moving)}`);
        }
      }
      clean(s); assert.deepEqual(problems,[]);
    } finally { await close(s); }
  });
}

for (const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:720}]) for (const theme of ['light','dark']) for (const language of ['en','id']) {
  test(`CBCN credit and keyboard cooldown disclosure ${viewport.width} ${theme} ${language}`, async () => {
    const fixtureRows = [row('cbcn','CBCN fixture','codebuddy-cn',{windows:[],fetchedAt:null,percentRemaining:null,creditStatus:'unknown',accountCooldownUntil:'2030-01-01T12:00:00Z',modelCooldowns:[{model:'fixture-model',reason:'rate limited',until:'2030-01-01T13:00:00Z'}]})];
    const s = await setup({viewport,theme,language,fixtureRows});
    try {
      await go(s.page,'quota','CBCN fixture');
      const skip = s.page.locator('.shell-skip');
      const hiddenSkip = await skip.evaluate(el => ({bottom:el.getBoundingClientRect().bottom, focused:el === document.activeElement}));
      assert.ok(hiddenSkip.bottom <= 0 && !hiddenSkip.focused, `unfocused skip link must be offscreen: ${JSON.stringify(hiddenSkip)}`);
      const card = s.page.locator('.quota-account');
      assert.match(await card.innerText(), language === 'id' ? /Kredit: Tidak diketahui/ : /Credit: Unknown/);
      assert.doesNotMatch(await card.innerText(), /100%/);
      const summary = card.locator('summary');
      await summary.focus(); await s.page.keyboard.press('Enter');
      assert.equal(await card.getByText(/fixture-model/).isVisible(),true);
      assert.match(await summary.innerText(), language === 'id' ? /hanya proses ini/ : /this process only/);
      assert.equal(await s.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),0);
      const spacing = await summary.evaluate(el => { const d=el.parentElement, previous=d.previousElementSibling, content=el.nextElementSibling; return {before:d.getBoundingClientRect().top-previous.getBoundingClientRect().bottom, after:content.getBoundingClientRect().top-el.getBoundingClientRect().bottom}; });
      assert.ok(spacing.before >= 10 && spacing.after >= 8, `cooldown spacing ${JSON.stringify(spacing)}`);
      // Keyboard focus scrolls the viewport; restore its origin before a full-page capture
      // so fixed shell elements are not painted midway through the document.
      await summary.evaluate(el => el.blur());
      await s.page.evaluate(() => window.scrollTo(0, 0));
      await s.page.screenshot({path:resolve(out,`cbcn-${viewport.width}-${theme}-${language}.png`),fullPage:true});
      clean(s);
    } finally { await close(s); }
  });
}

test('quota: keyboard selection does not refresh, account-name search, and explicit per-account action', async () => {
  const s = await setup(); try {
    await go(s.page,'quota','Alice Sample');
    const beta = s.page.getByRole('button',{name:/Beta Example/});
    await beta.focus(); assert.equal(await beta.evaluate(el=>el===document.activeElement),true);
    const focus = await beta.evaluate(el=>{const c=getComputedStyle(el);return {outline:c.outlineStyle,shadow:c.boxShadow};});
    assert.ok(focus.outline !== 'none' || focus.shadow !== 'none', 'keyboard focus must be visible');
    const before = s.requests.filter(x=>x.path.startsWith('/api/usage/') && x.path !== '/api/usage/quota').length;
    await s.page.keyboard.press('Enter');
    assert.equal(await beta.getAttribute('aria-pressed'),'true');
    assert.equal(await s.page.getByText('Betty Sample',{exact:true}).count(),1);
    assert.equal(s.requests.filter(x=>x.path.startsWith('/api/usage/') && x.path !== '/api/usage/quota').length,before,'selecting provider must not refresh');
    await s.page.getByRole('button',{name:/Alpha Example/}).click();
    const search = s.page.getByRole('searchbox',{name:/Search accounts|Cari akun/i});
    await search.fill('aLiCe');
    assert.equal(await s.page.getByText('Alice Sample',{exact:true}).count(),1);
    assert.equal(await s.page.getByText('Bob Fixture',{exact:true}).count(),0);
    await search.fill('nonexistent'); assert.equal(await s.page.getByText('Alice Sample',{exact:true}).count(),0);
    await search.fill('Alice');
    await s.page.getByRole('button',{name:/Check now|Periksa sekarang/i}).click();
    await s.page.getByText(/Freshly checked/).first().waitFor();
    assert.equal(s.requests.filter(x=>x.path === '/api/usage/alice').length,1,'individual check must target only Alice');
    assert.equal(await s.page.getByText('Fixture window 1',{exact:true}).isVisible(),true,'partial fresh result must preserve cached windows');
    clean(s);
  } finally {await close(s);}
});

test('quota: many windows have accessible expandable complete data and visible error', async () => {
  const s=await setup(); try {
    await go(s.page,'quota','Alice Sample');
    assert.equal(await s.page.getByText('Fixture quota error',{exact:true}).first().isVisible(),true);
    const card=s.page.locator('article').filter({has:s.page.getByText('Alice Sample',{exact:true})});
    assert.equal(await card.getByText('Fixture window 1',{exact:true}).isVisible(),true);
    assert.equal(await card.getByText('Fixture window 6',{exact:true}).isVisible().catch(()=>false),false,'long list should start as a preview');
    const disclosure=card.locator('summary').filter({hasText:/more quota windows|show (all|more)|expand|all windows|lihat (semua|lainnya)/i}).first();
    await disclosure.focus(); await s.page.keyboard.press('Enter');
    assert.equal(await card.getByText('Fixture window 6',{exact:true}).isVisible(),true);
    const lastWindow=card.locator('section').filter({has:s.page.getByText('Fixture window 6',{exact:true})});
    await lastWindow.locator('summary').click();
    assert.equal(await card.getByText('fixture-model-6',{exact:false}).isVisible(),true);
    await s.page.screenshot({path:resolve(out,'quota-expanded.png'),fullPage:true,animations:'disabled'});
    await disclosure.click();
    assert.equal(await card.getByText('Fixture window 6',{exact:true}).isVisible().catch(()=>false),false);
    clean(s);
  } finally {await close(s);}
});

test('provider selector filtering and collapse are independent of account selection', async () => {
  const s=await setup(); try {
    await go(s.page,'quota','Alice Sample');
    const search=s.page.getByRole('searchbox',{name:'Search providers'});
    await search.fill('beta');
    assert.equal(await s.page.getByRole('button',{name:/Beta Example/}).count(),1);
    assert.equal(await s.page.getByRole('button',{name:/Gamma Example/}).count(),0);
    assert.equal(await s.page.getByText('Alice Sample',{exact:true}).isVisible(),true);
    await search.fill('');
    const hide=s.page.getByRole('button',{name:'Hide providers'});
    assert.equal(await hide.getAttribute('aria-expanded'),'true');
    await hide.click();
    const show=s.page.getByRole('button',{name:'Show providers'});
    assert.equal(await show.getAttribute('aria-expanded'),'false');
    assert.equal(await s.page.getByRole('button',{name:/Alpha Example/}).count(),0);
    assert.equal(await s.page.getByText('Alice Sample',{exact:true}).isVisible(),true);
    await show.click(); assert.equal(await s.page.getByRole('button',{name:/Alpha Example/}).count(),1);
    clean(s);
  } finally {await close(s);}
});

test('provider card body and independent action are not nested, both navigate', async () => {
  const s=await setup(); try {
    await go(s.page,'providers?tab=oauth','Alpha Example');
    const card=s.page.locator('article').filter({has:s.page.getByText('Alpha Example',{exact:true})});
    const action=card.getByRole('link',{name:/Manage|Connect|Kelola|Hubungkan/i}).first();
    assert.equal(await action.count(),1,'independent action exists');
    assert.equal(await action.evaluate(el=>!!el.parentElement?.closest('a,button,[role="link"],[role="button"]')),false,'action must not be nested in an interactive card');
    await action.click(); assert.match(new URL(s.page.url()).pathname,/\/providers\/alpha$/);
    await go(s.page,'providers?tab=oauth','Alpha Example');
    const body=s.page.getByRole('link',{name:/Alpha Example/}).first();
    await body.focus(); await s.page.keyboard.press('Enter'); assert.match(new URL(s.page.url()).pathname,/\/providers\/alpha$/);
    clean(s);
  } finally {await close(s);}
});

test('refresh success then HTTP error then stale response preserve prior quota windows', async () => {
  const s=await setup({refreshResponses:[
    {json:{quotas:{weekly:{used:10,total:100,remaining:90,remainingPercentage:90}}}},
    {status:503,json:{error:'Fixture upstream unavailable'}},
    {json:{_stale:true,_staleReason:'Fixture stale upstream',_staleSince:'2026-10-20T12:00:00.000Z',quotas:{session:{used:40,total:100,remaining:60,remainingPercentage:60}}}},
  ]});
  try {
    await go(s.page,'quota','Alice Sample');
    const card=s.page.locator('article').filter({has:s.page.getByText('Alice Sample',{exact:true})});
    const refresh=card.getByRole('button',{name:'Check now'});
    await refresh.click(); await card.getByText('Freshly checked',{exact:false}).waitFor();
    assert.equal(await card.getByText('Weekly',{exact:true}).isVisible(),true);
    assert.equal(await card.getByText('Fixture window 1',{exact:true}).isVisible(),true);
    await s.page.screenshot({path:resolve(out,'quota-refresh-success.png'),fullPage:true,animations:'disabled'});
    await refresh.click(); await card.getByText('Fixture upstream unavailable',{exact:true}).waitFor();
    assert.equal(await card.locator('.quota-fetched').getByText('Stale',{exact:false}).isVisible(),true);
    assert.equal(await card.getByText('Weekly',{exact:true}).isVisible(),true);
    await s.page.screenshot({path:resolve(out,'quota-refresh-error.png'),fullPage:true,animations:'disabled'});
    await refresh.click(); await card.getByText('Fixture stale upstream',{exact:true}).waitFor();
    assert.equal(await card.locator('.quota-fetched').getByText('Stale',{exact:false}).isVisible(),true);
    await card.locator('.quota-more > summary').click();
    assert.equal(await card.getByText('5h Session',{exact:true}).isVisible(),true);
    assert.equal(await card.getByText('Weekly',{exact:true}).isVisible(),true);
    await s.page.screenshot({path:resolve(out,'quota-refresh-stale.png'),fullPage:true,animations:'disabled'});
    assert.equal(s.requests.filter(x=>x.path==='/api/usage/alice').length,3);
    clean(s);
  } finally {await close(s);}
});

test('per-window snapshot provenance survives a partial refresh and browser reload', async () => {
  const oldTime='2026-01-01T00:00:00.000Z', newTime='2026-01-02T00:00:00.000Z';
  const oldWindow={key:'weekly',label:'Weekly',models:['weekly'],used:40,total:100,remaining:60,percentRemaining:60,resetAt:null,unlimited:false,fetchedAt:oldTime,stale:false};
  const session={key:'session',label:'5h Session',models:['session'],used:20,total:100,remaining:80,percentRemaining:80,resetAt:null,unlimited:false,fetchedAt:newTime,stale:false};
  const fixtureRows=[row('alice','Alice Sample','alpha',{fetchedAt:oldTime,windows:[oldWindow]})];
  const s=await setup({fixtureRows,refreshResponses:[{json:{quotas:{session:{used:20,total:100,remaining:80,remainingPercentage:80}}}}]});
  try {
    await go(s.page,'quota','Alice Sample');
    const card=s.page.locator('article').filter({has:s.page.getByText('Alice Sample',{exact:true})});
    // The next cached read represents the backend-persisted partial merge.
    fixtureRows[0]={...fixtureRows[0],fetchedAt:newTime,windows:[session,{...oldWindow,stale:true}]};
    await card.getByRole('button',{name:'Check now'}).click();
    await card.getByText('5h Session',{exact:true}).waitFor();
    await s.page.reload(); await s.page.getByText('Alice Sample',{exact:true}).waitFor();
    const sessionSection=card.locator('.quota-window').filter({hasText:'5h Session'});
    const weeklySection=card.locator('.quota-window').filter({hasText:'Weekly'});
    await weeklySection.getByText(/Stale/).waitFor();
    assert.match(await sessionSection.innerText(),/Cached.*01\/02\/2026/s);
    assert.match(await weeklySection.innerText(),/Stale.*01\/01\/2026/s);
    assert.doesNotMatch(await weeklySection.innerText(),/Fresh/);
    assert.equal(s.requests.filter(x=>x.path==='/api/usage/alice').length,1);
    clean(s);
  } finally {await close(s);}
});

test('account name search reaches later pages and resets pagination', async () => {
  const fixtureRows=[...rows, ...Array.from({length:10},(_,i)=>row(`extra-${i}`,`Extra ${i}`, 'alpha'))];
  const s=await setup({fixtureRows}); try {
    await go(s.page,'quota','Alice Sample');
    const search=s.page.getByRole('searchbox',{name:'Search accounts'});
    assert.equal(await s.page.getByText('Extra 9',{exact:true}).count(),0);
    await search.fill('ExTrA 9');
    assert.equal(await s.page.getByText('Extra 9',{exact:true}).isVisible(),true);
    assert.equal(await s.page.getByText('Alice Sample',{exact:true}).count(),0);
    await search.fill('');
    await s.page.getByRole('button',{name:'Go to page 2'}).click();
    assert.equal(await s.page.getByText('Extra 9',{exact:true}).isVisible(),true);
    await search.fill('alice');
    assert.equal(await s.page.getByText('Alice Sample',{exact:true}).isVisible(),true);
    assert.equal(await s.page.getByRole('button',{name:'Go to page 1'}).getAttribute('aria-current'),'page');
    clean(s);
  } finally {await close(s);}
});

test('mobile primary quota controls have 44px targets, no clipped visible actions, reduced motion', async () => {
  const s=await setup({viewport:{width:320,height:720},reducedMotion:'reduce'}); try {
    await go(s.page,'quota','Alice Sample');
    assert.equal(await s.page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),true);
    const controls=s.page.locator('.quota-page button:visible, .quota-page input:visible, .quota-page select:visible, .quota-page summary:visible');
    const metrics=await controls.evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect(), c=getComputedStyle(el);return {text:el.getAttribute('aria-label')||el.textContent.trim(),width:r.width,height:r.height,left:r.left,right:r.right,transition:c.transitionDuration,transitionProperty:c.transitionProperty,animation:c.animationDuration};}));
    await s.page.screenshot({path:resolve(out,'quota-320-reduced.png'),fullPage:true,animations:'disabled'});
    const problems=[];
    if (metrics.some(m=>m.width<44||m.height<44)) problems.push({type:'44px targets',controls:metrics.filter(m=>m.width<44||m.height<44)});
    if (metrics.some(m=>m.left < -1 || m.right > 321)) problems.push({type:'clipped actions',controls:metrics.filter(m=>m.left < -1 || m.right > 321)});
    if (metrics.some(m=>m.transition.split(',').some(x=>parseFloat(x)>0.01)||m.animation.split(',').some(x=>parseFloat(x)>0.01))) problems.push({type:'reduced motion',controls:metrics.filter(m=>m.transition.split(',').some(x=>parseFloat(x)>0.01)||m.animation.split(',').some(x=>parseFloat(x)>0.01))});
    clean(s); assert.deepEqual(problems,[]);
  } finally {await close(s);}
});
