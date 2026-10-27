import { test } from 'node:test';
import assert from 'node:assert/strict';

// Start NODE_ENV=development npm run dev -- --host 127.0.0.1 --port 5186.
// NODE_ENV must be development so the fixture's own JSX compiles against the
// dev runtime; a production server serves a prod React that has no `jsxDEV`.
// All service requests are blocked; this harness renders only local in-memory fixtures.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseURL = process.env.PANEL_TEST_URL || 'http://127.0.0.1:5186/panel/';

test('quota numbered pagination supports navigation, size, jump, resets and data shrink on mobile', async t => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 320, height: 760 } });
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error); });
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  await page.route('**/api/**', route => route.abort());
  await page.route('https://fonts.**/**', route => route.abort());
  // The fixture has to mount through PreferencesProvider: QuotaBrowser calls
  // usePreferences(), whose context default is the English translator. Rendering
  // it bare leaves the page on context defaults only by accident, and the dev
  // entry now also installs a router — so mirror the real provider tree.
  await page.route('**/src/main.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: `
    import React from '/panel/node_modules/.vite/deps/react.js';
    import ReactDOM from '/panel/node_modules/.vite/deps/react-dom_client.js';
    import { PreferencesProvider } from '/panel/src/lib/preferences.tsx';
    import { QuotaBrowser } from '/panel/src/pages/Quota.tsx';
    import '/panel/src/main.css';
    const root = ReactDOM.createRoot(document.getElementById('root'));
    const account = (id, provider = 'codex') => ({ connectionId: String(id), provider, name: 'Account ' + id, quotaUsed: 0, quotaTotal: null, percentRemaining: 100, resetAt: null, tokenStatus: 'valid' });
    const view = (count) => React.createElement(PreferencesProvider, null, React.createElement(QuotaBrowser, {
      rows: [...Array.from({ length: count }, (_, i) => account(i + 1)), account('other', 'claude')],
      names: new Map(), now: 0, live: {}, syncingAll: false, onRefresh() {}, onCheckGroup() {},
    }));
    window.renderAccounts = (count = 64) => root.render(view(count));
    window.renderAccounts();
  ` }));
  await page.goto(baseURL);
  const nav = page.getByRole('navigation', { name: 'Pagination', exact: true });
  const current = () => nav.locator('[aria-current="page"]');
  const providerButton = (label) => page.getByRole('button').filter({ hasText: label });
  await nav.getByText('1–8 of 64 accounts', { exact: true }).waitFor();
  await nav.getByRole('button', { name: 'Go to page 8', exact: true }).click();
  await nav.getByText('57–64 of 64 accounts', { exact: true }).waitFor();
  assert.equal(await current().innerText(), '8');
  assert.equal(await nav.getByRole('button', { name: 'Next', exact: true }).isDisabled(), true);
  await nav.getByRole('button', { name: 'Previous', exact: true }).click();
  await nav.getByText('Page 7 of 8', { exact: true }).waitFor();
  await nav.getByLabel('Go to page', { exact: true }).fill('4');
  await nav.getByRole('button', { name: 'Go', exact: true }).click();
  await nav.getByText('25–32 of 64 accounts', { exact: true }).waitFor();
  await nav.getByLabel('Go to page', { exact: true }).fill('99');
  await nav.getByRole('button', { name: 'Go', exact: true }).click();
  assert.equal(await current().innerText(), '4');
  await nav.getByLabel('Items per page').selectOption('16');
  await nav.getByText('1–16 of 64 accounts', { exact: true }).waitFor();
  assert.equal(await page.locator('.quota-account').count(), 16);
  await nav.getByRole('button', { name: 'Go to page 4', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search accounts' }).fill('Account 64');
  await nav.getByText('1–1 of 1 accounts', { exact: true }).waitFor();
  await page.getByRole('searchbox', { name: 'Search accounts' }).fill('');
  await nav.getByText('Page 1 of 4', { exact: true }).waitFor();
  await nav.getByRole('button', { name: 'Go to page 4', exact: true }).click();
  await page.evaluate(() => window.renderAccounts(3));
  await nav.getByText('1–3 of 3 accounts', { exact: true }).waitFor();
  await page.evaluate(() => window.renderAccounts(64));
  await nav.getByText('Page 1 of 4', { exact: true }).waitFor();
  await nav.getByRole('button', { name: 'Go to page 4', exact: true }).click();
  await providerButton('claude').click();
  await nav.getByText('Page 1 of 1', { exact: true }).waitFor();
  await providerButton('codex').click();
  await nav.getByLabel('Items per page').selectOption('8');
  await nav.getByText('Page 1 of 8', { exact: true }).waitFor();
  assert.equal(await nav.evaluate(el => el.scrollWidth <= el.clientWidth), true, 'pagination fits 320px');
  assert.deepEqual(errors, []);
});
