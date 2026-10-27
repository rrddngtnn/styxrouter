import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
test('brand assets resolve from the panel base, not a nested route', () => {
  expect(source('../src/App.tsx')).not.toContain('src="brand/');
  expect(source('../index.html')).toContain('href="%BASE_URL%brand/styx-icon.svg"');
  expect(source('../index.html')).toContain('href="%BASE_URL%favicon.ico"');
});
test('shell does not import its parent App', () => {
  expect(source('../src/components/shell/ShellFrame.tsx')).not.toContain('../../App.tsx');
});
