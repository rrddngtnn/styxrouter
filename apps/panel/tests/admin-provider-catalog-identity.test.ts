import { expect, test } from 'bun:test';
import * as models from '../src/pages/Models.tsx';
const { catalogProviderIdentity } = models;

test('scoped rows use explicit node and local identity instead of public ID heuristics', () => {
  const row = { id: 'shared/vendor/model', owned_by: 'vendor', providerId: 'node-uuid', nodeId: 'node-uuid', localId: 'vendor/model' };
  expect(catalogProviderIdentity(row, new Set(['shared']))).toBe('node-uuid');
  expect((models as any).catalogMetadataIdentity(row)).toEqual({provider: 'node-uuid', modelId: 'vendor/model'});
});
