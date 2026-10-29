import { expect, test, spyOn } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { createProviderConnection } = await import('../src/lib/db/providers');
const { getProviderLimitsCache, getProviderLimitsCacheSnapshot, setProviderLimitsCache, updateProviderLimitsCache } = await import('../src/lib/db/providerLimits');
const { getDbInstance, SQLITE_FILE } = await import('../src/lib/db/core');
const { GET: refresh } = await import('../src/app/api/usage/[connectionId]/route');
const { mergeProviderLimitsCacheEntry, toProviderLimitsCacheEntry } = await import('../src/lib/usage/providerLimitsCache');
const old = '2025-01-01T00:00:00.000Z';
const seed = { quotas: {session:{remaining:20},weekly:{remaining:40}}, plan:'plus', message:null, fetchedAt:old };
async function child(sql:string, id:string, value?:string) {
 const dir=mkdtempSync(join(process.env.TMPDIR!, 'quota-review-barrier-'));
 const ready=join(dir,'ready'), done=join(dir,'done');
 const script = `const {Database}=require('bun:sqlite');const fs=require('node:fs');(async()=>{while(!fs.existsSync(process.argv[4])) await Bun.sleep(5);const db=new Database(process.argv[1]);db.run(process.argv[2],JSON.parse(process.argv[3]));db.close();fs.writeFileSync(process.argv[5],'done')})().catch(e=>{console.error(e);process.exit(1)})`;
 const p=Bun.spawn([process.execPath,'-e',script,SQLITE_FILE,sql,JSON.stringify(value===undefined?[id]:[value,id]),ready,done],{stdout:'pipe',stderr:'pipe'});
 try {
  writeFileSync(ready,'go');
  const code=await p.exited;
  if(code!==0) throw new Error(await new Response(p.stderr).text());
  expect(existsSync(done)).toBe(true);
 } finally {p.kill(); rmSync(dir,{recursive:true,force:true});}
}
async function pauseRefresh(id:string, mutate:()=>Promise<void>) {
 let started!:()=>void, release!:()=>void; const ready=new Promise<void>(r=>started=r);const barrier=new Promise<void>(r=>release=r);
 const orig=globalThis.fetch;
 globalThis.fetch=(async()=>{started(); await barrier; return Response.json({plan_type:'plus',rate_limit:{primary_window:{used_percent:30,limit_window_seconds:18000}}});}) as typeof fetch;
 try { const pending=refresh(new Request('http://localhost'),{params:Promise.resolve({connectionId:id})}); await Promise.race([ready,new Promise((_,r)=>setTimeout(()=>r(new Error('timeout')),5000))]); await mutate(); release(); const response=await pending; expect(response.status).toBe(200); } finally {release();globalThis.fetch=orig;}
}
test('cross-process concurrent snapshot deletion is not resurrected',async()=>{
 const c=await createProviderConnection({provider:'codex',name:'delete-race',authType:'oauth',accessToken:'test-token',isActive:true});setProviderLimitsCache(c.id,seed);
 await pauseRefresh(c.id,()=>child("DELETE FROM key_value WHERE namespace='providerLimitsCache' AND key=?",c.id));
 expect(getProviderLimitsCache(c.id)).toBeNull();
},10000);
test('cross-process delete and identical recreate fences older partial refresh',async()=>{
 const c=await createProviderConnection({provider:'codex',name:'aba',authType:'oauth',accessToken:'test-token',isActive:true});setProviderLimitsCache(c.id,seed);
 const before=getProviderLimitsCache(c.id)!;
 await pauseRefresh(c.id,async()=>{
  const script=`const {Database}=require('bun:sqlite');const db=new Database(process.argv[1]);db.run('BEGIN IMMEDIATE');const row=db.query("SELECT value FROM key_value WHERE namespace='providerLimitsCache' AND key=?").get(process.argv[2]);db.run("DELETE FROM key_value WHERE namespace='providerLimitsCache' AND key=?",[process.argv[2]]);db.run("INSERT INTO key_value(namespace,key,value) VALUES('providerLimitsCache',?,?)",[process.argv[2],row.value]);db.run('COMMIT');db.close();`;
  const p=Bun.spawn([process.execPath,'-e',script,SQLITE_FILE!,c.id],{stderr:'pipe'}); const code=await p.exited; if(code!==0) throw new Error(await new Response(p.stderr).text());
 });
 expect(getProviderLimitsCache(c.id)).toEqual(before);
},10000);
test('revision only tracks actual changes for the exact cache key',()=>{
 const db=getDbInstance(); const id='revision-precision'; setProviderLimitsCache(id,seed);
 const before=getProviderLimitsCacheSnapshot(id).revision;
 db.prepare("UPDATE key_value SET value=value WHERE namespace='providerLimitsCache' AND key=?").run(id);
 db.prepare("INSERT OR REPLACE INTO key_value(namespace,key,value) VALUES('other',?,?)").run(id,'x');
 setProviderLimitsCache('another-key',seed);
 expect(getProviderLimitsCacheSnapshot(id).revision).toBe(before);
 updateProviderLimitsCache(id, previous=>previous);
 expect(getProviderLimitsCacheSnapshot(id).revision).toBe(before);
});
test('older thrown error does not mark an identical recreated cache stale',async()=>{
 const c=await createProviderConnection({provider:'codex',name:'error-aba',authType:'oauth',accessToken:'test-token',isActive:true});setProviderLimitsCache(c.id,seed);
 const before=getProviderLimitsCache(c.id); let entered!:()=>void, release!:()=>void;
 const started=new Promise<void>(r=>entered=r), barrier=new Promise<void>(r=>release=r);
 const lease=await import('../src/lib/exclusiveLeaseIsolation');
 const spy=spyOn(lease,'isConnectionUnavailableToAuxiliaryActivity').mockImplementation(async id=>{if(id===c.id){entered();await barrier;throw new Error('older error');}return false;});
 try {
  const pending=refresh(new Request('http://localhost'),{params:Promise.resolve({connectionId:c.id})});
  await started;
  const script=`const {Database}=require('bun:sqlite');const db=new Database(process.argv[1]);db.run('BEGIN IMMEDIATE');const r=db.query("SELECT value FROM key_value WHERE namespace='providerLimitsCache' AND key=?").get(process.argv[2]);db.run("DELETE FROM key_value WHERE namespace='providerLimitsCache' AND key=?",[process.argv[2]]);db.run("INSERT INTO key_value(namespace,key,value) VALUES('providerLimitsCache',?,?)",[process.argv[2],r.value]);db.run('COMMIT');db.close();`;
  const p=Bun.spawn([process.execPath,'-e',script,SQLITE_FILE!,c.id],{stderr:'pipe'}); if(await p.exited) throw new Error(await new Response(p.stderr).text());
  release(); expect((await pending).status).toBe(500); expect(getProviderLimitsCache(c.id)).toEqual(before);
 } finally {release();spy.mockRestore();}
},10000);
test('cross-process per-window ABA with another window changed fences the older refresh',async()=>{
 const c=await createProviderConnection({provider:'codex',name:'window-aba',authType:'oauth',accessToken:'test-token',isActive:true});setProviderLimitsCache(c.id,seed);
 await pauseRefresh(c.id,async()=>{
  const script=`const {Database}=require('bun:sqlite');const db=new Database(process.argv[1]);const id=process.argv[2];db.run('BEGIN IMMEDIATE');const row=db.query("SELECT value FROM key_value WHERE namespace='providerLimitsCache' AND key=?").get(id);const v=JSON.parse(row.value);v.quotas.session={remaining:999};db.run("UPDATE key_value SET value=? WHERE namespace='providerLimitsCache' AND key=?",[JSON.stringify(v),id]);db.run('COMMIT');db.run('BEGIN IMMEDIATE');v.quotas.session={remaining:20};v.quotas.weekly={remaining:75};db.run("UPDATE key_value SET value=? WHERE namespace='providerLimitsCache' AND key=?",[JSON.stringify(v),id]);db.run('COMMIT');db.close();`;
  const p=Bun.spawn([process.execPath,'-e',script,SQLITE_FILE!,c.id],{stderr:'pipe'}); if(await p.exited) throw new Error(await new Response(p.stderr).text());
 });
 expect(getProviderLimitsCache(c.id)!.quotas!.session).toEqual({remaining:20});
 expect(getProviderLimitsCache(c.id)!.quotas!.weekly).toEqual({remaining:75});
},10000);
test('cross-process latest changed window remains fresh',async()=>{
 const c=await createProviderConnection({provider:'codex',name:'update-race',authType:'oauth',accessToken:'test-token',isActive:true});setProviderLimitsCache(c.id,seed);
 const concurrent={...seed,quotas:{...seed.quotas,weekly:{remaining:75}},fetchedAt:'2025-01-02T00:00:00.000Z'};
 await pauseRefresh(c.id,()=>child("UPDATE key_value SET value=? WHERE namespace='providerLimitsCache' AND key=?",c.id,JSON.stringify(concurrent)));
 const result=getProviderLimitsCache(c.id)!;expect(result.quotas!.weekly).toEqual({remaining:75});expect(result.staleWindows).not.toContain('weekly');expect(result.windowFetchedAt!.weekly).toBe(concurrent.fetchedAt);
},10000);
test('concurrently removed window is not resurrected by older observation',async()=>{
 const c=await createProviderConnection({provider:'codex',name:'window-delete',authType:'oauth',accessToken:'test-token',isActive:true});setProviderLimitsCache(c.id,seed);
 const concurrent={...seed,quotas:{weekly:{remaining:40}},fetchedAt:'2025-01-02T00:00:00.000Z'};
 await pauseRefresh(c.id,()=>child("UPDATE key_value SET value=? WHERE namespace='providerLimitsCache' AND key=?",c.id,JSON.stringify(concurrent)));
 expect(getProviderLimitsCache(c.id)!.quotas!.session).toBeUndefined();
},10000);
test('same timestamp freshness-only update survives concurrent partial refresh',async()=>{
 const c=await createProviderConnection({provider:'codex',name:'freshness-only',authType:'oauth',accessToken:'test-token',isActive:true});
 const prior={...seed,staleWindows:['weekly'],windowFetchedAt:{session:old,weekly:old}}; setProviderLimitsCache(c.id,prior);
 const concurrent={...prior,staleWindows:['session']};
 await pauseRefresh(c.id,()=>child("UPDATE key_value SET value=? WHERE namespace='providerLimitsCache' AND key=?",c.id,JSON.stringify(concurrent)));
 expect(getProviderLimitsCache(c.id)!.staleWindows).not.toContain('weekly');
},10000);
test('empty-quota error preserves old top-level observation timestamp',()=>{
 const next=mergeProviderLimitsCacheEntry('kiro',toProviderLimitsCacheEntry({quotas:{},message:'authentication rejected'},'manual','2025-01-02T00:00:00.000Z'),seed);
 expect(next.fetchedAt).toBe(old);expect(next.refreshFailed).toBe(true);
});
test('empty successful observations and self-hosted informational messages remain successful',()=>{
 const at='2025-01-02T00:00:00.000Z';
 const empty=mergeProviderLimitsCacheEntry('codex',toProviderLimitsCacheEntry({quotas:{}},'manual',at),null);
 expect(empty.quotas).toEqual({}); expect(empty.fetchedAt).toBe(at); expect(empty.refreshFailed).not.toBe(true);
 const local=mergeProviderLimitsCacheEntry('firecrawl',toProviderLimitsCacheEntry({quotas:{},plan:'Firecrawl · Self-Hosted Local',message:'Connected to self-hosted Firecrawl instance (http://localhost)'},'manual',at),seed);
 expect(local.fetchedAt).toBe(at); expect(local.refreshFailed).not.toBe(true);
});
test('error with only invalid windows does not advance the observation',()=>{
 const next=mergeProviderLimitsCacheEntry('kiro',toProviderLimitsCacheEntry({quotas:{session:null,weekly:{}},message:'unavailable'},'manual','2025-01-02T00:00:00.000Z'),seed);
 expect(next.fetchedAt).toBe(old); expect(next.refreshFailed).toBe(true);
});
test('an error cannot advance even a legitimate empty prior observation',()=>{
 const previous={...seed,quotas:{}};
 const next=mergeProviderLimitsCacheEntry('kiro',toProviderLimitsCacheEntry({quotas:{},message:'unavailable'},'manual','2025-01-02T00:00:00.000Z'),previous);
 expect(next.fetchedAt).toBe(old); expect(next.refreshFailed).toBe(true); expect(next.quotas).toEqual({});
});
test('atomic cache update rolls back failed insert',()=>{
 const id='rollback';setProviderLimitsCache(id,seed);const db=getDbInstance();db.exec("CREATE TRIGGER review_fail_provider_cache BEFORE INSERT ON key_value WHEN NEW.namespace='providerLimitsCache' AND NEW.key='rollback' BEGIN SELECT RAISE(ABORT,'review injected failure'); END");
 try {expect(()=>updateProviderLimitsCache(id,p=>({...p!,message:'changed'}))).toThrow('review injected failure');expect(getProviderLimitsCache(id)).toEqual(expect.objectContaining(seed));} finally {db.exec('DROP TRIGGER review_fail_provider_cache');}
});
