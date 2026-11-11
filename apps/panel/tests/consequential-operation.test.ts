import {test,expect} from 'bun:test';
import {createConsequentialOperation} from '../src/lib/consequential-operation';
test('uncertain write blocks replay until authoritative reread, never automatically retries',async()=>{
 const operation=createConsequentialOperation();let writes=0,reads=0;
 await operation.run(async()=>{writes++;throw Error('connection lost');},async()=>{reads++;});
 expect(operation.state).toBe('uncertain');expect(writes).toBe(1);expect(reads).toBe(1);
 await operation.run(async()=>{writes++;},async()=>{reads++;});expect(writes).toBe(1);
 await operation.reconcile(async()=>{reads++;});expect(operation.state).toBe('idle');expect(writes).toBe(1);
});
test('success waits for onDone reread and does not replay if reread fails',async()=>{
 const operation=createConsequentialOperation();let finish!:()=>void;
 const pending=operation.run(async()=>({key:'fixture'}),()=>new Promise<void>(r=>finish=r));
 await Promise.resolve();await Promise.resolve();expect(operation.state).toBe('reconciling');finish();expect(await pending).toEqual({key:'fixture'});expect(operation.state).toBe('idle');
});
