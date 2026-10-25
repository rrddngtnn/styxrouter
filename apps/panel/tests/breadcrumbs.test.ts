import { expect, test } from 'bun:test';
import { breadcrumbs } from '../src/components/shell/breadcrumbs.ts';
test('provider details retain directory parent and readable identifier', () => {
 expect(breadcrumbs('/providers/antigravity')).toEqual([{label:'Providers',to:'/providers'},{label:'Antigravity',to:null}]);
 expect(breadcrumbs('/')).toEqual([{label:'Overview',to:null}]);
});
