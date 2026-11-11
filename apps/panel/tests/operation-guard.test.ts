import {expect,test} from 'bun:test';
import {createOperationGuard} from '../src/lib/operation-guard';
test('duplicate same-tick mutations are rejected until first settles',async()=>{
 const guard=createOperationGuard();let release!:()=>void;let calls=0;
 const pending=guard.run(async()=>{calls++;await new Promise<void>(resolve=>release=resolve);return 42;});
 expect(await guard.run(async()=>{calls++;return 99;})).toBeUndefined();expect(calls).toBe(1);
 release();expect(await pending).toBe(42);expect(await guard.run(async()=>43)).toBe(43);
});
test('failure releases guard without automatically retrying the write',async()=>{
 const guard=createOperationGuard();let calls=0;
 await expect(guard.run(async()=>{calls++;throw new Error('synthetic write failure');})).rejects.toThrow('synthetic write failure');
 expect(calls).toBe(1);expect(await guard.run(async()=>7)).toBe(7);
});
