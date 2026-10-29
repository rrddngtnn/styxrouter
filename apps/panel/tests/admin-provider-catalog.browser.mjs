import { test } from 'node:test';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.PANEL_TEST_URL || 'http://127.0.0.1:5198';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw Error('Local fixture only');
test('opt-in inventory configures the exact node and local ID for colliding public IDs', async () => {
 const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
 try {
  const page = await browser.newPage(), requests = [];
  const rows = [{id:'shared/vendor/model', owned_by:'vendor', providerId:'alpha', nodeId:null, localId:'vendor/model'}, {id:'shared/vendor/model', owned_by:'vendor', providerId:'node-uuid', nodeId:'node-uuid', localId:'vendor/model'}];
  await page.route('**/*', async route => {const u=new URL(route.request().url()); if(u.pathname.startsWith('/api/')||u.pathname.startsWith('/v1/')) {requests.push(u); const fixtures={'/v1/models':{data:[]},'/api/admin/provider-catalog':{coverage:{complete:false},data:rows},'/api/providers':{providers:[{id:'alpha',name:'Alpha'}]},'/api/provider-nodes':{nodes:[{id:'node-uuid',name:'Node',prefix:'shared'}]},'/api/model-metadata':{model:{provider:u.searchParams.get('provider'),modelId:u.searchParams.get('modelId'),contextWindow:8192,supportsThinking:false,supportsVision:false,supportsTools:false,overrides:{contextWindow:null,supportsThinking:null,supportsVision:null,supportsTools:null}}}};return route.fulfill({status:fixtures[u.pathname]?200:501,json:fixtures[u.pathname]||{}});} if(u.origin!==new URL(origin).origin||route.request().method()!=='GET')return route.abort();return route.continue();});
  await page.goto(`${origin}/panel/tests/global-models.fixture.html`);
  await page.getByLabel('Show provider inventory (partial; not the served catalog)').check();
  await page.getByRole('button',{name:'Node (shared) (1)'}).click();
  await page.getByRole('button',{name:'Configure'}).click();
  await page.getByRole('dialog').getByLabel('Context window (tokens)').waitFor();
  const lookup=requests.filter(u=>u.pathname==='/api/model-metadata').at(-1);
  assert.equal(lookup.searchParams.get('provider'),'node-uuid'); assert.equal(lookup.searchParams.get('modelId'),'vendor/model');
 } finally {await browser.close();}
});
