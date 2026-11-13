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
  { id: 'antigravity', name: 'Antigravity', authModes: ['oauth'] },
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
      else if (path === '/api/quota/pools') json = {pools:[],groups:[]};
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


for (const width of [320,390,861,1280]) for(const theme of ['light','dark']) for(const language of ['en','id']) {
 test(`Hydrogen ${width} ${theme} ${language}`, async()=>{
  const models=['low','medium','high','xhigh'].map(t=>`gemini-4-hydrogen-${t}`);
  const fixtureRows=[row('fixture','Hydrogen fixture','antigravity',{windows:[],quotaTotal:null,percentRemaining:null,unreportedQuotaModels:models})];
  const s=await setup({viewport:{width,height:900},theme,language,reducedMotion:'reduce',fixtureRows});
  try {
   await go(s.page,'quota','Hydrogen fixture');
   await s.page.getByText(language==='en'?'Quota not provided':'Kuota tidak diberikan',{exact:false}).waitFor();
   for(const id of models) assert.ok((await s.page.locator('.quota-page').innerText()).includes(id));
   assert.equal(await s.page.locator('.quota-window').count(),0);
   assert.equal(await s.page.locator('[role="progressbar"]').count(),0);
   const overflow=await s.page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
   assert.equal(overflow,0);
   assert.equal(s.requests.filter(r=>!['GET','HEAD'].includes(r.method)).length,0);
   await s.page.screenshot({path:resolve(out,`hydrogen-${width}-${theme}-${language}.png`),fullPage:true,animations:'disabled'});
   clean(s);
  } finally {await close(s)}
 });
}
