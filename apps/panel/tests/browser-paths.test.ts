import { test, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('browser evidence tooling contains no machine-specific absolute paths', () => {
  const dir = new URL('./', import.meta.url);
  for (const name of readdirSync(dir).filter(name => name.endsWith('.browser.mjs'))) {
    const source = readFileSync(new URL(name, dir), 'utf8');
    expect(source, name).not.toMatch(/(?:\/home\/|\/Users\/|[A-Z]:\\Users\\)/);
  }
});

test('browser evidence paths derive from the module, not the working directory', async () => {
  const { browserEvidencePath, repoRoot } = await import('./browser-paths.mjs');
  expect(repoRoot).toBe(fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, ''));
  expect(browserEvidencePath('suite', 'result.json', {})).toBe(`${repoRoot}/evidence/browser/suite/result.json`);
  expect(browserEvidencePath('suite', 'result.json', { REDESIGN_EVIDENCE: `${repoRoot}/evidence/override` })).toBe(`${repoRoot}/evidence/override/suite/result.json`);
});
