import {expect,test} from 'bun:test';
import {creditIdentity,beginCreditAttempt,readCreditAttempts,settleCreditAttempt} from '../src/lib/banked-reset-ledger';
const storage=()=>{const data=new Map<string,string>();return {getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},data};};
test('unknown exact identity survives reconstruction without storing account or selection secrets',async()=>{
 const s=storage(),id=await creditIdentity('private-account','private-selection');
 const attempt=beginCreditAttempt(s,id);expect(attempt.attemptId).toMatch(/^[a-f0-9-]{36}$/);
 expect(readCreditAttempts(s,id.account)).toEqual([attempt]);
 expect(()=>beginCreditAttempt(s,id)).toThrow('Outcome unknown');
 expect(()=>beginCreditAttempt(s,{...id,credit:'f'.repeat(64)})).toThrow('Outcome unknown');
 expect(beginCreditAttempt(s,await creditIdentity('different-account','private-selection')).attemptId).not.toBe(attempt.attemptId);
 expect(JSON.stringify([...s.data])).not.toContain('private-');
});
test('only direct authoritative outcomes settle attempts; committed exact credits stay blocked',async()=>{
 const s=storage(),id=await creditIdentity('a','c'),a=beginCreditAttempt(s,id);
 settleCreditAttempt(s,id,a.attemptId,'committed');
 expect(()=>beginCreditAttempt(s,id)).toThrow('already confirmed');
 expect(beginCreditAttempt(s,await creditIdentity('a','different')).status).toBe('unknown');
});
test('known rejection permits deliberate reviewed retry with stable original attempt identifier',async()=>{
 const s=storage(),id=await creditIdentity('a','c'),a=beginCreditAttempt(s,id);
 settleCreditAttempt(s,id,a.attemptId,'rejected');
 expect(beginCreditAttempt(s,id).attemptId).toBe(a.attemptId);
});
test('denied or corrupted storage fails closed before dispatch',async()=>{
 const id=await creditIdentity('a','c');
 expect(()=>beginCreditAttempt({getItem:()=>null,setItem:()=>{throw Error('denied');}},id)).toThrow();
 expect(()=>readCreditAttempts({getItem:()=>'{broken',setItem:()=>{}},id.account)).toThrow();
});
