import {expect,test} from 'bun:test';
import {filterKeys,filterCombos,visibleSelectedIds} from '../src/lib/table-search.ts';
test('keys search names prefixes and active status without mutating rows',()=>{
 const rows=[{id:'a',name:'Laptop',prefix:'sk-abc',isActive:true},{id:'b',name:'Work',isActive:false}];
 expect(filterKeys(rows,' LAPTOP ').map(r=>r.id)).toEqual(['a']);
 expect(filterKeys(rows,'sk-ABC').map(r=>r.id)).toEqual(['a']);
 expect(filterKeys(rows,'revoked').map(r=>r.id)).toEqual(['b']);
 expect(visibleSelectedIds(filterKeys(rows,'Work'),new Set(['a','b','stale']))).toEqual(['b']);
 expect(rows.length).toBe(2);
});
test('combo search covers object targets and preserves global order',()=>{
 const rows=[{id:'a',name:'Fast',strategy:'priority',enabled:true,models:['codex/test']},{id:'b',name:'Backup',strategy:'round-robin',enabled:false,models:[{model:'glm/flash'}]}];
 expect(filterCombos(rows,'FLASH').map(r=>r.id)).toEqual(['b']);
 expect(filterCombos(rows,'disabled').map(r=>r.id)).toEqual(['b']);
 expect(filterCombos(rows,'priority').map(r=>r.id)).toEqual(['a']);
 expect(filterCombos(rows,'').map(r=>r.id)).toEqual(['a','b']);
});
