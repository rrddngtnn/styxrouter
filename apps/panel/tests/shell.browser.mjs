import { test } from 'node:test';
import assert from 'node:assert/strict';

// Run a development-mode Vite server first (NODE_ENV=development npm run dev),
// then: PANEL_TEST_URL=http://127.0.0.1:5173/panel/ node --test tests/shell.browser.mjs
// NODE_ENV must be development: under production React resolves the JSX dev
// runtime to its prod build, whose default export drops `jsxDEV`, so the page
// stub below would throw "_jsxDEV is not a function" and every test would time
// out instead of failing meaningfully.
// Install Playwright externally and set PLAYWRIGHT_MODULE to its index.mjs if needed.
// Every API call is intercepted; these tests never connect to a live database.
// Use an existing Playwright install without changing the panel's dependencies.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseURL = process.env.PANEL_TEST_URL || 'http://127.0.0.1:5173/panel/';
async function setup(t, viewport = { width: 390, height: 844 }) {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'No uncaught browser errors'));
  const requests = [];
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    const body = path === '/api/auth/status' ? { authenticated: true } : path === '/api/providers' ? { providers: [{ id: 'test/provider', name: 'Test Provider' }, { id: 'codex', name: 'OpenAI Codex' }] } : {};
    return route.fulfill({ json: body });
  });
  // Isolate the shell from concurrently edited feature pages and all live services.
  await page.route('**/src/main.tsx*', async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace(/^import \{ ([^}]+) \} from .*\/src\/pages\/.*;$/gm,
      (_, names) => names.split(',').map(name => `const ${name.trim()} = () => _jsxDEV('h1', { children: 'Settings' });`).join('\n'));
    await route.fulfill({ response, body });
  });
  await page.goto(`${baseURL}settings`);
  await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
  return { page, requests };
}

test('mobile navigation is a modal drawer with focus, Escape, backdrop and route dismissal', async t => {
  const { page } = await setup(t);
  const trigger = page.getByRole('button', { name: 'Open navigation' });
  await trigger.waitFor({ timeout: 3000 });
  assert.equal(await page.getByRole('navigation', { name: 'Main navigation' }).isVisible(), false);
  if (process.env.SHELL_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SHELL_SCREENSHOT_DIR}/shell-mobile.png` });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Navigation' });
  await dialog.waitFor();
  assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true);
  for (let i = 0; i < 17; i++) await page.keyboard.press('Tab');
  assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
  await trigger.click();
  await page.mouse.click(380, 400);
  await dialog.waitFor({ state: 'hidden' });
  await trigger.click();
  await dialog.getByRole('link', { name: 'API Keys', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.match(page.url(), /\/keys$/);
});

test('shell fits a 320px viewport and closes a drawer when switching to desktop', async t => {
  const { page } = await setup(t, { width: 320, height: 568 });
  await page.goto(`${baseURL}tools`);
  const trigger = page.getByRole('button', { name: 'Open navigation' });
  await trigger.waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await trigger.click();
  await page.getByRole('dialog', { name: 'Main navigation' }).waitFor();
  await page.setViewportSize({ width: 1440, height: 900 });
  // One transient drawer at every viewport: crossing the breakpoint closes it and
  // returns focus to the trigger, leaving no stranded modal over the workspace.
  await page.getByRole('dialog', { name: 'Main navigation' }).waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('navigation', { name: 'Main navigation' }).isVisible(), false);
  assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
  assert.equal(await page.locator('.shell-workspace').evaluate(el => el.inert), false);
});

test('provider lookup failure leaves route search working and can be retried', async t => {
  const { page } = await setup(t);
  await page.route('**/api/providers', route => route.fulfill({ status: 503, json: { error: 'Unavailable' } }));
  await page.getByRole('button', { name: 'Search pages and providers' }).click();
  const dialog = page.getByRole('dialog', { name: 'Go to' });
  await dialog.getByText('Provider lookup unavailable. Pages are still available; reopen to retry.').waitFor();
  await dialog.getByRole('combobox').fill('routing');
  await page.keyboard.press('Enter');
  assert.match(page.url(), /\/routing$/);
  await page.unroute('**/api/providers');
  await page.getByRole('button', { name: 'Search pages and providers' }).click();
  await dialog.getByRole('combobox').fill('codex');
  await dialog.getByRole('option', { name: /OpenAI Codex/ }).waitFor();
});

test('tabbing out of an open drawer wraps inside it instead of leaving', async t => {
  const { page } = await setup(t);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const dialog = page.getByRole('dialog', { name: 'Main navigation' });
  await dialog.waitFor();
  // Backwards from the first stop must land on the last, never on the workspace.
  await page.keyboard.press('Shift+Tab');
  assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true);
  for (let i = 0; i < 20; i++) await page.keyboard.press('Tab');
  assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true);
});

test('drawer links navigate and leave the workspace interactive again', async t => {
  const { page } = await setup(t);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const dialog = page.getByRole('dialog', { name: 'Main navigation' });
  await dialog.waitFor();
  // The header behind the drawer is inert while it owns modality, so the drawer's
  // own link list is the only interactive surface and must dismiss on click.
  assert.equal(await page.locator('.shell-workspace').evaluate(el => el.inert), true);
  await dialog.getByRole('link', { name: 'Models', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.match(page.url(), /\/models$/);
  assert.equal(await page.locator('.shell-workspace').evaluate(el => el.inert), false);
});

test('Ctrl+K searches routes and lazily loaded providers with keyboard selection', async t => {
  const { page, requests } = await setup(t, { width: 1440, height: 900 });
  assert.equal(requests.includes('/api/providers'), false);
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Go to' });
  await dialog.waitFor({ timeout: 3000 });
  const input = dialog.getByRole('combobox', { name: 'Search pages and providers' });
  assert.equal(await input.evaluate(el => el === document.activeElement), true);
  await input.fill('quota');
  await page.keyboard.press('Enter');
  await dialog.waitFor({ state: 'hidden' });
  assert.match(page.url(), /\/quota$/);
  await page.keyboard.press('Meta+k');
  await input.fill('test/provider');
  await dialog.getByRole('option', { name: /Test Provider/ }).waitFor();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await dialog.waitFor({ state: 'hidden' });
  assert.match(page.url(), /\/providers\/test%2Fprovider$/);
  await page.getByRole('button', { name: 'Search pages and providers' }).click();
  await input.fill('nothing-matches');
  await dialog.getByText('No matching pages or providers.').waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('button', { name: 'Search pages and providers' }).evaluate(el => el === document.activeElement), true);
});
