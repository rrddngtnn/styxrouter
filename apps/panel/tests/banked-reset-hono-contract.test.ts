import {test,expect} from 'bun:test';
import {startTestServer} from '../../server/tests/helpers/start-test-server';
import {stopTestProcess} from '../../server/tests/helpers/stop-test-process';
test('actual isolated Hono reset API preserves auth body and non-Codex guards without upstream traffic',async()=>{
 const {proc,base}=await startTestServer(process.execPath,{cwd:`${import.meta.dir}/../../server`,env:{...process.env,STYX_TEST_MODE:'1',JWT_SECRET:'fixture-jwt-secret-01234567890123456789',INITIAL_PASSWORD:'fixture-password',STORAGE_ENCRYPTION_KEY:'fixture-encryption-key'}});
 try{
 const path='/api/usage/codex-reset-credit';
 expect((await fetch(base+path+'?connectionId=missing')).status).toBe(401);
 expect((await fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({connectionId:'missing',creditId:'exact',idempotencyKey:'fixture-attempt'})})).status).toBe(401);
 const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'fixture-password'})});expect(login.status).toBe(200);
 const cookie=login.headers.get('set-cookie')!.split(';')[0];const headers={cookie,'content-type':'application/json'};
 expect((await fetch(base+path,{headers})).status).toBe(400);
 expect((await fetch(base+path,{method:'POST',headers,body:JSON.stringify({connectionId:'missing',creditId:'exact'})})).status).toBe(400);
 const made=await (await fetch(base+'/api/connections',{method:'POST',headers,body:JSON.stringify({provider:'openai',name:'Synthetic unsupported reset account',apiKey:'fixture-not-a-real-key'})})).json() as {id:string};expect(made.id).toBeString();
 const response=await fetch(base+path+'?connectionId='+encodeURIComponent(made.id),{headers});expect(response.status).toBe(400);expect(await response.json()).toMatchObject({ok:false});
 const consume=await fetch(base+path,{method:'POST',headers,body:JSON.stringify({connectionId:made.id,creditId:'exact',idempotencyKey:'fixture-attempt'})});expect(consume.status).toBe(400);expect(await consume.json()).toMatchObject({ok:false});
 }finally{await stopTestProcess(proc);}
},60000);
