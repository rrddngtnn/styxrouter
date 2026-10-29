import { test } from 'node:test';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const origin = process.env.PANEL_TEST_URL;
if (!origin || new URL(origin).hostname !== '127.0.0.1') throw Error('loopback only');

test('legacy overlay is explained without offering manual actions on synced models', async () => {
 const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] });
 try {
  for (const viewport of [{width: 1440,height:900}, {width: 375,height:812}]) for (const language of ['en','id']) {
   const page = await browser.newPage({viewport});
   await page.addInitScript(language => localStorage.setItem('styx-panel-preferences', JSON.stringify({language,theme:'dark'})), language);
   let writes = 0;
   await page.route('**/api/**', route => {
    if (route.request().method() !== 'GET') writes++;
    if (new URL(route.request().url()).pathname === '/api/providers/node-uuid/models') return route.fulfill({json:{prefix:'node',models:[{id:'shared',name:'Synced authority',origin:'synced',manualOverlay:{id:'shared',name:'Legacy manual',apiFormat:'embeddings',supportsVision:true}},{id:'plain',name:'Plain synced',origin:'synced'},{id:'manual',name:'Manual model',origin:'manual'}]}});
    return route.fulfill({status: 404, json:{error:'Unexpected fixture request'}});
   });
   await page.route('**/v1/**', route => { writes++; return route.fulfill({status: 403}); });
   await page.goto(origin + '/panel/tests/provider-model-overlay.fixture.html');
   const conflict = page.locator('[data-model-id="shared"]');
   await conflict.getByText('Synced authority').waitFor();
   assert.match(await conflict.innerText(), language === 'id' ? /catatan manual lama/i : /legacy manual record/i);
   assert.match(await conflict.innerText(), language === 'id' ? /tersinkron/ : /synced/);
   assert.equal(await conflict.getByRole('button',{name:/^(Edit|Delete|Ubah|Hapus)$/}).count(),0);
   assert.equal(await page.locator('[data-model-id="plain"]').getByText(/legacy manual record|catatan manual lama/i).count(),0);
   const manual = page.locator('[data-model-id="manual"]');
   assert.equal(await manual.getByRole('button',{name: /^(Edit|Ubah)$/}).count(),1);
   assert.equal(await manual.getByRole('button',{name: /^(Delete|Hapus)$/}).count(),1);
   const testButton = conflict.getByRole('button').nth(1);
   await testButton.focus();
   await page.keyboard.press('Enter');
   const dialog = page.getByRole('dialog');
   await dialog.waitFor();
   await page.keyboard.press('Escape');
   await dialog.waitFor({state:'hidden'});
   assert.equal(await testButton.evaluate(el => el === document.activeElement), true);
   assert.equal(writes,0);
   await page.close();
  }
 } finally { await browser.close(); }
});
