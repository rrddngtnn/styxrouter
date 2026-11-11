import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
test('account rows offer a separate model inference dialog', () => {
 const page=readFileSync(join(import.meta.dir,'../src/pages/Providers.tsx'),'utf8');
 expect(page).toContain('AccountModelTest');
 const component=readFileSync(join(import.meta.dir,'../src/components/AccountModelTest.tsx'),'utf8');
 expect(component).toContain('connectionId: account.id');
 expect(component).toContain('Test Model');
 expect(component).toContain('observedAt');
 expect(component).toContain('?connectionId=');
 expect(component).toContain('Inventory unknown');
 expect(component).toContain('HTTP');
 expect(component).toContain('Selected:');
 expect(component).toContain('Model: {result.model}');
});
