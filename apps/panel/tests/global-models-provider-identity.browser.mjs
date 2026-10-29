import { test } from 'node:test';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.PANEL_TEST_URL || 'http://127.0.0.1:5198';
if (!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname)) throw Error('Local fixture only');
for (const width of [320, 1440]) test(`provider identity ${width}`, async () => {
 const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
 try {
  const page = await browser.newPage({viewport:{width,height:900}}), requests=[], errors=[];
  page.on('pageerror', e => errors.push(e.message));
  const rows=[{id:'alpha/shared',owned_by:'vendor',root:'shared',context_length:8192,capabilities:{vision:true}},{id:'alpha/shared-high',owned_by:'vendor',parent:'shared',capabilities:{tool_calling:true}},{id:'beta/shared',owned_by:'vendor',root:'shared',context_length:16384},{id:'custom/vendor/shared',owned_by:'vendor',capabilities:{vision:true}}];
  await page.route('**/*', async route=>{const req=route.request(),u=new URL(req.url()); if(u.pathname.startsWith('/api/')||u.pathname.startsWith('/v1/')) {requests.push(u); const fixtures={'/v1/models':{data:rows},'/api/providers':{providers:[{id:'alpha',name:'Alpha'},{id:'beta',name:'Beta'}]},'/api/provider-nodes':{nodes:[{id:'node-id',prefix:'custom',name:'Custom'}]},'/api/model-metadata':{model:{provider:u.searchParams.get('provider'),modelId:u.searchParams.get('modelId'),contextWindow:8192,supportsThinking:false,supportsVision:false,supportsTools:false,overrides:{contextWindow:null,supportsThinking:null,supportsVision:null,supportsTools:null}}}};return route.fulfill({status:fixtures[u.pathname]?200:501,json:fixtures[u.pathname]||{}});} if(u.origin!==new URL(origin).origin||req.method()!=='GET')return route.abort();return route.continue();});
  await page.goto(`${origin}/panel/tests/global-models.fixture.html`);
  await page.getByRole('button',{name:'Alpha (2)'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Beta (1)'}).count(),1);
  assert.equal(await page.getByRole('button',{name:'Custom (custom) (1)'}).count(),1);
  assert.equal(await page.getByText('beta/shared',{exact:true}).count(),1);
  await page.getByRole('button',{name:/alpha\/shared · 2 models/}).click();
  assert.equal(await page.getByText('alpha/shared-high',{exact:true}).count(),1);
  await page.getByLabel('Filter by capability').selectOption('Vision');
  assert.equal(await page.getByText('beta/shared',{exact:true}).count(),0);
  await page.getByLabel('Filter by provider').selectOption('custom');
  await page.getByRole('button',{name:'Configure'}).click();
  await page.getByRole('dialog').getByLabel('Context window (tokens)').waitFor();
  const lookup=requests.filter(u=>u.pathname==='/api/model-metadata').at(-1);
  assert.equal(lookup.searchParams.get('provider'),'node-id');assert.equal(lookup.searchParams.get('modelId'),'vendor/shared');
  await page.keyboard.press('Escape');await page.getByLabel('Filter by provider').selectOption('all');await page.getByLabel('Filter by capability').selectOption('all');
  await page.getByLabel('Search models').fill('Beta');assert.equal(await page.getByText('beta/shared',{exact:true}).count(),1);assert.equal(await page.getByText('custom/vendor/shared',{exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth),0);assert.deepEqual(errors,[]);
 } finally {await browser.close();}
});
