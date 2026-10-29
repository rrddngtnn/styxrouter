import { test } from 'node:test';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.PANEL_TEST_URL || 'http://127.0.0.1:5198';
if (!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname)) throw Error('Local fixture only');
test('family pagination and filtering preserve model counts', async () => {
 const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args:['--no-sandbox','--disable-dev-shm-usage'] });
 try {
  const page=await browser.newPage();
  const rows=Array.from({length:25},(_,i)=>({id:`p/model-${i}`,owned_by:'p'}));
  rows.push({id:'p/variant',owned_by:'p',parent:'model-0'});
  await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.pathname.startsWith('/api/')||u.pathname.startsWith('/v1/')) return route.fulfill({json:u.pathname==='/v1/models'?{data:rows}:u.pathname==='/api/providers'?{providers:[{id:'p'}]}:{nodes:[]}});if(u.origin!==new URL(origin).origin||route.request().method()!=='GET')return route.abort();return route.continue();});
  await page.goto(`${origin}/panel/tests/global-models.fixture.html`);
  const nav=page.getByRole('navigation',{name:'Models pagination'});
  await nav.getByText('1–20 of 25 families').waitFor();
  assert.equal(await page.getByText('26 models',{exact:true}).count(),1);
  await nav.getByRole('button',{name:'Next'}).click();
  await nav.getByText('21–25 of 25 families').waitFor();
  assert.equal(await page.getByText('p/model-24',{exact:true}).count(),1);
  await page.getByRole('searchbox').fill('model-24');
  await nav.getByText('1–1 of 1 families').waitFor();
  assert.equal(await page.getByText('1 model',{exact:true}).count(),1);
 } finally {await browser.close();}
});
