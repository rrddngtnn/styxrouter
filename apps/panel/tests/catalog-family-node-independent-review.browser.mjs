import { test } from 'node:test';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.PANEL_TEST_URL || 'http://127.0.0.1:5299';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw Error('Local fixture only');
test('inventory local family aliases stay inside their node', async () => {
 const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH, args:['--no-sandbox','--disable-dev-shm-usage']});
 try {
  const page = await browser.newPage(); const errors=[];
  page.on('pageerror', e => errors.push(e.message));
  const rows=[
   {id:'shared/vendor/base',localId:'vendor/base',providerId:'node-a',nodeId:'node-a',owned_by:'vendor'},
   {id:'shared/vendor/variant',localId:'vendor/variant',providerId:'node-a',nodeId:'node-a',owned_by:'vendor',parent:'vendor/base'},
   {id:'shared/vendor/base',localId:'vendor/base',providerId:'node-b',nodeId:'node-b',owned_by:'vendor'},
   {id:'shared/vendor/orphan',localId:'vendor/orphan',providerId:'node-b',nodeId:'node-b',owned_by:'vendor',parent:'vendor/variant'},
  ];
  await page.route('**/*', async route => {
   const req=route.request(), u=new URL(req.url());
   if(u.pathname.startsWith('/api/') || u.pathname.startsWith('/v1/')) {
    const fixtures={'/v1/models':{data:[]},'/api/admin/provider-catalog':{data:rows},'/api/providers':{providers:[]},'/api/provider-nodes':{nodes:[{id:'node-a',prefix:'a',name:'A'},{id:'node-b',prefix:'b',name:'B'}]}};
    return route.fulfill({status:fixtures[u.pathname]?200:501,json:fixtures[u.pathname]||{}});
   }
   if(u.origin!==new URL(origin).origin || req.method()!=='GET') return route.abort();
   return route.continue();
  });
  await page.goto(`${origin}/panel/tests/global-models.fixture.html`);
  await page.getByLabel('Show provider inventory (partial; not the served catalog)').check();
  const family=page.getByRole('button',{name:/shared\/vendor\/base · 2 models/});
  await family.waitFor(); assert.equal(await family.count(),1);
  await family.click(); await page.getByText('shared/vendor/variant',{exact:true}).waitFor();
  assert.equal(await page.getByText('shared/vendor/orphan',{exact:true}).count(),1);
  assert.deepEqual(errors,[]);
 } finally { await browser.close(); }
});
