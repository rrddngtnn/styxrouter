import {expect,test} from 'bun:test';
import {normalizePreferences,preferencesEqual} from '../src/lib/preferences-core';
test('old preference payload remains compatible and equality prevents redundant writes',()=>{
 const old=normalizePreferences({language:'id',theme:'dark',providerView:'rows'});
 expect(preferencesEqual(old,normalizePreferences({...old}))).toBe(true);
 expect(preferencesEqual(old,normalizePreferences({...old,theme:'light'}))).toBe(false);
 expect(normalizePreferences({theme:'corrupt',language:'bad',providerView:'bad'})).toEqual({theme:'system',language:'en',providerView:'cards',density:'comfortable'});
});
