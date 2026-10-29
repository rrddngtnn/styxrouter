import { expect, test } from 'bun:test';
import { groupCatalogModels } from '../src/pages/Models';

test('provider-local family references resolve even when another provider has the same unqualified id', () => {
  const rows = [
    { id: 'base', owned_by: 'other' },
    { id: 'p/base', owned_by: 'p' },
    { id: 'p/variant', owned_by: 'p', parent: 'base' },
  ];
  expect(groupCatalogModels(rows, rows).map(group => group.rows.map(row => row.id))).toEqual([
    ['base'], ['p/base', 'p/variant'],
  ]);
});
