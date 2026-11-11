import {test,expect} from 'bun:test';
import {translate} from '../src/lib/preferences-core';
test('account inference dialog translates safety and controls without translating identity',()=>{
 for(const text of ['Test Model','Run inference','Choose a model','Model inventory unavailable.','Account synced inventory; not proof of entitlement or inference.','Inventory unknown — provider inventory only, not account entitlement.'])expect(translate('id',text)).not.toBe(text);
 expect(translate('id','Test Model — {account}',{account:'exact/account-id'})).toBe('Uji Model — exact/account-id');
});
