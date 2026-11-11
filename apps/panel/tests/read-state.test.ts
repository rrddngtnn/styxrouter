import {expect,test} from 'bun:test';
import {applyReadResult} from '../src/lib/read-state';
test('late response cannot overwrite a newer request generation',()=>{
 expect(applyReadResult(1,2,{value:'old'})).toBeNull();
 expect(applyReadResult(2,2,{value:'current'})).toEqual({value:'current'});
});
