import {expect,test} from 'bun:test';
import {canRedeemCredit, redemptionOutcome} from '../src/lib/banked-reset';
test('only fresh eligible Codex inventory with exact selected token allows review',()=>{
 const lease={provider:'codex',isActive:true,loading:false,error:null,availableCount:1,credits:[{selectionToken:'exact'}]};
 expect(canRedeemCredit(lease,'exact')).toBe(true);
 for(const patch of [{provider:'claude'},{isActive:false},{loading:true},{error:'failed'},{availableCount:0},{availableCount:null},{credits:[]}])expect(canRedeemCredit({...lease,...patch},'exact')).toBe(false);
 expect(canRedeemCredit(lease,'other')).toBe(false);
});
test('only explicit server outcomes confirm redemption; quota failure is partial',()=>{
 expect(redemptionOutcome({ok:true,outcome:'reset',quotaRefreshed:true})).toBe('confirmed');
 expect(redemptionOutcome({ok:true,outcome:'alreadyRedeemed',quotaRefreshed:false})).toBe('partial');
 expect(redemptionOutcome({ok:true,outcome:'maybe'})).toBe('unknown');
 expect(redemptionOutcome({ok:false,outcome:'reset'})).toBe('unknown');
});
