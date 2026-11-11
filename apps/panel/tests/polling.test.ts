import {expect,test} from 'bun:test';
import {pollEligible} from '../src/lib/polling';
test('live read polling stops when hidden inactive disabled or request pending',()=>{
 expect(pollEligible({enabled:true,visible:true,active:true,pending:false})).toBe(true);
 for(const change of [{enabled:false},{visible:false},{active:false},{pending:true}])expect(pollEligible({enabled:true,visible:true,active:true,pending:false,...change})).toBe(false);
});
