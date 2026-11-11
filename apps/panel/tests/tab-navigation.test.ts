import {expect,test} from 'bun:test';
import {nextTabIndex} from '../src/lib/tab-navigation';
test('tab keyboard wraps and supports Home End without swallowing unrelated keys',()=>{
 expect(nextTabIndex('ArrowRight',2,3)).toBe(0);expect(nextTabIndex('ArrowLeft',0,3)).toBe(2);
 expect(nextTabIndex('Home',2,3)).toBe(0);expect(nextTabIndex('End',0,3)).toBe(2);
 expect(nextTabIndex('Enter',1,3)).toBeNull();expect(nextTabIndex('ArrowRight',0,0)).toBeNull();
});
