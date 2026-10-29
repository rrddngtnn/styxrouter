import { test } from 'node:test';
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseURL = process.env.PANEL_TEST_URL || 'http://127.0.0.1:5189/panel/';

test('session check failure offers a retry and recovers without a reload', async t => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 320, height: 640 } });
  let checks = 0;
  let available = false;
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/status') {
      checks++;
      return !available ? route.fulfill({ status: 503, json: { error: 'Unavailable' } }) : route.fulfill({ json: { authenticated: true } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto(`${baseURL}settings`);
  await page.getByRole('alert').getByText('Unable to check session.').waitFor({ timeout: 5000 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const initialChecks = checks;
  available = true;
  await page.getByRole('button', { name: 'Retry' }).click();
  await page.getByRole('button', { name: 'Open navigation' }).waitFor();
  assert.ok(checks > initialChecks);
});
