import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
test('brand renders supplied light and dark icon-and-wordmark lockups with an accessible name', () => {
  const brand = source('../src/components/BrandMark.tsx');
  expect(brand).toContain('brand/styx-lockup.svg');
  expect(brand).toContain('brand/styx-lockup-dark.svg');
  expect(brand).toContain('aria-label="StyxRouter"');
  expect(source('../src/main.css')).not.toContain('var(--brand-icon-filter)');
});
