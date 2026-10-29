import { test } from 'node:test';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.PANEL_TEST_URL || 'http://127.0.0.1:5198';
if (!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname)) throw Error('Local fixture only');
const rows = [{id:'shared/model',providerId:'openai',nodeId:null,localId:'model',origin:'image-registry',type:'image'}, {id:'shared/model',providerId:'node-uuid',nodeId:'node-uuid',localId:'model',origin:'manual'}, ...['embedding','rerank','audio','video','music','moderation'].map(type=>({id:`openai/${type}`,providerId:'openai',nodeId:null,localId:type,type,origin:`${type}-registry`}))];
for (const width of [320, 1440]) test(`inventory specialty filters at ${width}px`, async () => {
 const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
 try {
  const page = await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
  const requests = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {const req=route.request(),u=new URL(req.url()); if(u.pathname.startsWith('/api/')||u.pathname.startsWith('/v1/')) {requests.push(`${req.method()} ${u.pathname}`);const fixtures={'/v1/models':{data:[]},'/api/admin/provider-catalog':{data:rows},'/api/providers':{providers:[{id:'openai',name:'OpenAI'}]},'/api/provider-nodes':{nodes:[{id:'node-uuid',name:'Node',prefix:'shared'}]}};return route.fulfill({status:fixtures[u.pathname]&&req.method()==='GET'?200:501,json:fixtures[u.pathname]||{}});} if(u.origin!==new URL(origin).origin||req.method()!=='GET')return route.abort();return route.continue();});
  await page.goto(`${origin}/panel/tests/global-models.fixture.html`);
  const checkbox = page.getByRole('checkbox',{name:'Show provider inventory (partial; not the served catalog)'});
  await checkbox.check();
  assert.equal(await checkbox.isChecked(), true);
  await page.getByText('openai/embedding',{exact:true}).waitFor();
  assert.ok(requests.includes('GET /api/admin/provider-catalog'));
  if (process.env.SPECIALTY_SCREENSHOT_DIR) await page.screenshot({path:`${process.env.SPECIALTY_SCREENSHOT_DIR}/specialty-${width}.png`,fullPage:true});
  for(const type of ['image','embedding','rerank','audio','video','music','moderation','unknown']) {
   await page.getByLabel('Filter by type').selectOption(type);
   const expected = type === 'image' || type === 'unknown' ? 'shared/model' : `openai/${type}`;
   await page.getByText(expected,{exact:true}).waitFor();
   assert.equal(await page.locator('tbody tr').count(),1, type);
   if(type==='image') assert.equal(await page.getByRole('button',{name:'OpenAI (1)'}).count(),1);
   if(type==='unknown') assert.equal(await page.getByRole('button',{name:'Node (shared) (1)'}).count(),1);
  }
  assert.deepEqual(errors,[]);
 } finally {await browser.close();}
});
