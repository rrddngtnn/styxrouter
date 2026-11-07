import { test } from 'node:test';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const origin = process.env.PANEL_TEST_URL;
if (!origin || new URL(origin).hostname !== '127.0.0.1') throw Error('loopback only');
test('dashboard model test needs no API key and reports sanitized results', async () => {
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
 const page=await browser.newPage(); let mode='error', calls=0;
 try {
  await page.route('**/api/providers/*/models',r=>r.fulfill({json:{prefix:'dynamic-node',models:[{id:'vendor/model',name:'Model',origin:'manual'}]}}));
  await page.route('**/api/model-test',r=>{calls++;assert.equal(r.request().headers().authorization,undefined);assert.deepEqual(r.request().postDataJSON(),{model:'dynamic-node/vendor/model'});return r.fulfill({status:mode==='error'?429:200,json:mode==='error'?{error:'secret'}:{ok:true}})});
  await page.goto(origin+'/panel/tests/provider-model-probe.fixture.html');
  await page.getByRole('button',{name:'Test model'}).click(); const d=page.getByRole('dialog');
  assert.equal(await d.getByLabel('API key').count(),0); assert.match(await d.innerText(),/may incur usage charges/);
  await d.getByRole('button',{name:'Run test'}).click(); await d.getByText(/Quota exhausted/).waitFor(); assert.doesNotMatch(await d.innerText(),/secret/);
  mode='good'; await d.getByRole('button',{name:'Run test'}).click(); await d.getByText('Test succeeded').waitFor(); assert.equal(calls,2);
 } finally { await browser.close(); }
});
