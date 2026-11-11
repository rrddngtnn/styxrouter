import {test,expect} from 'bun:test';
import {applyEmergencyActivation} from '../src/lib/emergency-activation';
import {startTestServer} from '../../server/tests/helpers/start-test-server';
import {stopTestProcess} from '../../server/tests/helpers/stop-test-process';

test('frontend activation uses actual isolated Hono contract, bounded IDs and per-item results',async()=>{
 const {proc,base}=await startTestServer(process.execPath,{cwd:`${import.meta.dir}/../../server`,env:{...process.env,STYX_TEST_MODE:'1',JWT_SECRET:'fixture-jwt-secret-01234567890123456789',INITIAL_PASSWORD:'fixture-password',STORAGE_ENCRYPTION_KEY:'fixture-encryption-key'}});
 const original=globalThis.fetch;
 try {
  const login=await original(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'fixture-password'})});
  expect(login.status).toBe(200);const cookie=login.headers.get('set-cookie')!.split(';')[0];
  const post=(body:unknown)=>original(base+'/api/connections/bulk-activation',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(body)});
  const create=async(name:string)=>(await (await original(base+'/api/connections',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({provider:'openai',name,apiKey:`fixture-only-${name}`})})).json() as {id:string}).id;
  const selected=await create('selected'),other=await create('unselected');
  expect((await original(base+'/api/connections/bulk-activation',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ids:[selected],isActive:false})})).status).toBe(401);
  expect((await post({ids:Array.from({length:101},(_,i)=>`missing-${i}`),isActive:false})).status).toBe(400);
  expect((await post({ids:[],isActive:false})).status).toBe(400);
  expect((await post({ids:[selected,selected],isActive:false})).status).toBe(400);
  expect((await post({ids:[selected],isActive:false,extra:true})).status).toBe(400);
  const writes:{ids:string[];isActive:boolean}[]=[];
  globalThis.fetch=(async(input,init)=>{expect(String(input)).toBe('/api/connections/bulk-activation');writes.push(JSON.parse(String(init?.body)));return original(base+String(input),{...init,headers:{...init?.headers,cookie}});}) as typeof fetch;
  const ids=[selected,...Array.from({length:100},(_,i)=>`missing-${i}`)];
  expect(await applyEmergencyActivation(ids,false)).toEqual({succeeded:1,failed:100,unknown:0,total:101});
  expect(writes.map(w=>w.ids.length)).toEqual([100,1]);expect(writes.flatMap(w=>w.ids)).toEqual(ids);
  const rows=await (await original(base+'/api/connections',{headers:{cookie}})).json() as {connections:{id:string;isActive:boolean}[]};
  expect(rows.connections.find(r=>r.id===selected)?.isActive).toBe(false);expect(rows.connections.find(r=>r.id===other)?.isActive).toBe(true);
  expect(await applyEmergencyActivation([selected],true)).toEqual({succeeded:1,failed:0,unknown:0,total:1});
 }finally{globalThis.fetch=original;await stopTestProcess(proc);}
},60000);
