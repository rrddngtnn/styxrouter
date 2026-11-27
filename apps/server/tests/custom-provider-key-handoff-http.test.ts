import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestServer } from './helpers/start-test-server';
import { stopTestProcess } from './helpers/stop-test-process';

test('authenticated custom-node key handoff stores real encrypted credential for exact returned provider ID', async () => {
 const dir=mkdtempSync(join(tmpdir(),'styx-custom-key-http-'));
 const encryption='synthetic-custom-key-encryption';
 process.env.STORAGE_ENCRYPTION_KEY=encryption;
 const {proc,base}=await startTestServer(process.execPath,{cwd:join(import.meta.dir,'..'),env:{...process.env,DATA_DIR:dir,STYX_TEST_MODE:'1',JWT_SECRET:'synthetic-custom-key-jwt-0123456789',INITIAL_PASSWORD:'synthetic-custom-password',STORAGE_ENCRYPTION_KEY:encryption}});
 try {
  const post=(path:string,body:unknown,cookie='')=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)});
  expect((await post('/api/provider-nodes',{})).status).toBe(401);
  const login=await post('/api/auth/login',{password:'synthetic-custom-password'});expect(login.status).toBe(200);
  const cookie=login.headers.get('set-cookie')!.split(';')[0]!;
  const created=await post('/api/provider-nodes',{type:'openai-compatible',name:'Synthetic custom',prefix:'synthetic-custom',apiType:'chat',baseUrl:'https://fixture.invalid/v1'},cookie);expect(created.status).toBe(201);
  const {node}=await created.json() as any; expect(typeof node.id).toBe('string');
  const secret='synthetic-custom-credential-only';
  const saved=await post('/api/connections',{provider:node.id,name:'Synthetic account',apiKey:secret},cookie);expect(saved.status).toBe(201);
  const connection=await saved.json() as any;expect(connection.id).toBeTruthy();
  const list=await fetch(base+'/api/connections',{headers:{cookie}});expect(list.status).toBe(200);
  const body=await list.json() as any;expect(body.connections.some((c:any)=>c.id===connection.id&&c.provider===node.id)).toBe(true);
  expect(JSON.stringify(body)).not.toContain(secret);
  const db=new Database(join(dir,'storage.sqlite'),{readonly:true});
  try {const row=db.query('SELECT * FROM provider_connections WHERE id = ?').get(connection.id) as any;expect(row.provider).toBe(node.id);expect(row.api_key).toStartWith('enc:');expect(row.api_key).not.toBe(secret);const {decrypt}=await import('../src/lib/db/encryption');expect(decrypt(row.api_key)).toBe(secret);} finally {db.close();}
 } finally {await stopTestProcess(proc);rmSync(dir,{recursive:true,force:true});delete process.env.STORAGE_ENCRYPTION_KEY;}
},60000);
