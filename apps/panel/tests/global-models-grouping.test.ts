import { expect, test } from 'bun:test';
import { groupCatalogModels, catalogProviderIdentity } from '../src/pages/Models.tsx';

test('canonical routing identity separates providers even when upstream owner is shared', () => {
  const known = new Set(['codex', 'openai', 'custom']);
  const rows = [
    { id: 'codex/gpt-x', owned_by: 'openai', root: 'gpt-x', capabilities: { vision: true } },
    { id: 'codex/gpt-x-high', owned_by: 'openai', parent: 'gpt-x' },
    { id: 'openai/gpt-x', owned_by: 'openai', root: 'gpt-x' },
    { id: 'custom/vendor/gpt-x', owned_by: 'openai' },
  ];
  const identity = (row: typeof rows[number]) => catalogProviderIdentity(row, known);
  expect(rows.map(identity)).toEqual(['codex', 'codex', 'openai', 'custom']);
  expect(groupCatalogModels(rows, rows, identity).map(g => g.rows.map(r => r.id))).toEqual([
    ['codex/gpt-x', 'codex/gpt-x-high'], ['openai/gpt-x'], ['custom/vendor/gpt-x'],
  ]);
});

test('groups only resolvable provider-local ancestry and preserves every catalog identity', () => {
  const rows = [
    { id: 'p/base', owned_by: 'p', root: 'base' },
    { id: 'p/variant', owned_by: 'p', root: 'variant', parent: 'base' },
    { id: 'p/other', owned_by: 'p', root: 'base' },
    { id: 'q/base', owned_by: 'q' },
    { id: 'q/orphan', owned_by: 'q', parent: 'p/base' },
    { id: 'q/base-high', owned_by: 'q' },
  ];
  const groups = groupCatalogModels(rows, rows);
  expect(groups.map(g => g.rows.map(r => r.id))).toEqual([
    ['p/base', 'p/variant', 'p/other'], ['q/base'], ['q/orphan'], ['q/base-high'],
  ]);
  expect(groups.flatMap(g => g.rows).map(r => r.id).sort()).toEqual(rows.map(r => r.id).sort());
});
