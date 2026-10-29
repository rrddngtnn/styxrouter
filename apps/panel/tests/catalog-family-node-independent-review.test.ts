import { expect, test } from 'bun:test';
import { groupCatalogModels, catalogProviderIdentity } from '../src/pages/Models.tsx';

test('inventory families resolve local aliases under node identity rather than routing prefix', () => {
  const rows = [
    { id: 'shared/vendor/base', localId: 'vendor/base', providerId: 'node-a', nodeId: 'node-a', owned_by: 'vendor' },
    { id: 'shared/vendor/variant', localId: 'vendor/variant', providerId: 'node-a', nodeId: 'node-a', owned_by: 'vendor', parent: 'vendor/base' },
    { id: 'shared/vendor/base', localId: 'vendor/base', providerId: 'node-b', nodeId: 'node-b', owned_by: 'vendor' },
    { id: 'shared/vendor/orphan', localId: 'vendor/orphan', providerId: 'node-b', nodeId: 'node-b', owned_by: 'vendor', parent: 'vendor/variant' },
  ];
  const identity = (row: typeof rows[number]) => catalogProviderIdentity(row, new Set(['shared']));
  expect(groupCatalogModels(rows, rows, identity).map(g => g.rows.map(r => `${r.providerId}:${r.localId}`))).toEqual([
    ['node-a:vendor/base', 'node-a:vendor/variant'], ['node-b:vendor/base'], ['node-b:vendor/orphan'],
  ]);
});
