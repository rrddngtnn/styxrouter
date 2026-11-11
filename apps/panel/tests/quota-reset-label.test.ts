import {test,expect} from 'bun:test';
import {quotaResetLabel} from '../src/lib/quota-reset-label';
test('reset accepts explicit zones, unknown units never guessed, elapsed is not recovered',()=>{
 for(const v of [null,0,1700000000,1700000000000,'1700000000','2026-01-01T12:00:00','not-a-time'])expect(quotaResetLabel(v,0).kind).toBe('unknown');
 expect(quotaResetLabel('2026-01-01T00:00:00Z',0).kind).toBe('scheduled');
 expect(quotaResetLabel('2026-01-01T00:00:00+07:00',Date.parse('2027-01-01T00:00:00Z')).kind).toBe('past');
});
