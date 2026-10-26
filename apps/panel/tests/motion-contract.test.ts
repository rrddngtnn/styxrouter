import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
const css = (name: string) => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
test('motion is scoped to state changes and disabled for reduced motion', () => {
  const base = css('main.css');
  expect(base).toContain('.page-motion');
  expect(base).toContain('.provider-card:hover');
  expect(base).toContain('.table tbody tr:hover');
  expect(base).toContain('.styx-modal');
  expect(base).toContain('@media (prefers-reduced-motion: reduce)');
  expect(base).not.toMatch(/\*\s*\{\s*animation:/);
});
test('selection and hover affordance exist for quota cards and tools', () => {
  const quota = css('pages/quota.css');
  const tools = css('pages/tools.css');
  expect(quota).toContain('.quota-provider[aria-pressed="true"]');
  expect(quota).toContain('.quota-provider:hover');
  expect(quota).toContain('.quota-account .btn-ghost:hover');
  expect(tools).toContain('.tools-tab.active');
  expect(tools).toContain('.tools-snippet-card .btn-ghost:hover');
});