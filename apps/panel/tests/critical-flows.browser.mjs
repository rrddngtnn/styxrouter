import { test } from 'node:test';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.PANEL_TEST_URL || 'http://127.0.0.1:5198/panel/';

test('provider cancellation, key issuance and model configuration use isolated fixtures', async t => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [], writes = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url());
    if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/v1/')) {
      if (req.method() !== 'GET') writes.push({path:u.pathname, method:req.method(), body:req.postDataJSON()});
      let data = {};
      if (u.pathname === '/api/auth/status') data = {authenticated:true};
      else if (u.pathname === '/api/providers') data = {providers:[{id:'demo',name:'Demo',authModes:['apikey'],vendor:'Test'}]};
      else if (u.pathname === '/api/connections') data = {connections:[]};
      else if (u.pathname === '/api/provider-nodes') data = {nodes:[]};
      else if (u.pathname === '/api/oauth/providers') data = {providers:[]};
      else if (u.pathname === '/api/keys') data = req.method() === 'POST' ? {key:'fixture-secret',name:'fixture'} : {keys:[]};
      else if (u.pathname === '/v1/models') data = {data:[{id:'demo/model-a',owned_by:'demo'}]};
      else if (u.pathname === '/api/model-metadata') data = {model:{provider:'demo',modelId:'model-a',contextWindow:4096,supportsThinking:false,supportsVision:false,supportsTools:true,overrides:{contextWindow:null,supportsThinking:null,supportsVision:null,supportsTools:null}}};
      return route.fulfill({json:data});
    }
    if (u.origin !== new URL(base).origin) return route.abort();
    return route.continue();
  });
  await page.goto(base+'providers?tab=custom');
  await page.getByRole('button',{name:'New custom provider'}).first().click();
  await page.getByRole('dialog').getByRole('button',{name:'Cancel'}).click();
  assert.equal(await page.getByText('Custom provider created').count(), 0, 'cancel must not claim provider was created');
  assert.equal(writes.length,0);
  await page.goto(base+'keys');
  await page.getByRole('button',{name:'Create key'}).first().click();
  await page.getByLabel('Key name').fill('fixture');
  await page.getByRole('dialog').getByRole('button',{name:'Create key'}).click();
  await page.getByText('fixture-secret').waitFor();
  assert.deepEqual(writes.at(-1),{path:'/api/keys',method:'POST',body:{name:'fixture'}});
  await page.goto(base+'models');
  await page.getByRole('button',{name:'Configure'}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Save',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  assert.equal(writes.at(-1).path,'/api/model-metadata');
  assert.deepEqual(errors,[]);
});
