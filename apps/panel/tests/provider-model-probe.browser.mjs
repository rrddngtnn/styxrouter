import { test } from 'node:test';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const origin = process.env.PANEL_TEST_URL;
if (!origin || new URL(origin).hostname !== '127.0.0.1') throw Error('loopback only');
test('probe verifies completion and shows safe specific error', async () => {
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
 const page=await browser.newPage(); let mode='error', calls=0;
 try {
  await page.route('**/api/providers/*/models',r=>r.fulfill({json:{prefix:'dynamic-node',models:[{id:'vendor/model',name:'Model',origin:'manual'}]}}));
  await page.route('**/v1/chat/completions',r=>{calls++;assert.equal(r.request().headers().authorization,'Bearer fixture-secret');assert.equal(r.request().postDataJSON().model,'dynamic-node/vendor/model');return r.fulfill({status:mode==='error'?429:200,json:mode==='error'?{error:{message:'Quota exhausted fixture-secret'}}:mode==='bad'?{error:{message:'unexpected'}}:{choices:[{message:{role:'assistant',content:'OK'}}]}})});
  await page.goto(origin+'/panel/tests/provider-model-probe.fixture.html');
  await page.getByRole('button',{name:'Test model'}).click(); const d=page.getByRole('dialog');
  assert.equal(calls,0); assert.match(await d.innerText(),/may incur usage charges/);
  await d.getByLabel('API key').fill('fixture-secret'); await d.getByRole('button',{name:'Run test'}).click();
  await d.getByText(/Quota exhausted/).waitFor(); assert.doesNotMatch(await d.innerText(),/fixture-secret/);
  mode='bad'; await d.getByLabel('API key').fill('fixture-secret'); await d.getByRole('button',{name:'Run test'}).click(); await d.getByText(/Test failed/).waitFor();
  mode='good'; await d.getByLabel('API key').fill('fixture-secret'); await d.getByRole('button',{name:'Run test'}).click(); await d.getByText('Test succeeded').waitFor(); assert.equal(calls,3);
 } finally { await browser.close(); }
});
