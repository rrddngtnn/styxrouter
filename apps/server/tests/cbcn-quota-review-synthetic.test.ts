import { expect, test } from 'bun:test';
import { getCodeBuddyCnUsage } from '../open-sse/services/usage/codebuddy-cn';
import { createProviderConnection, getProviderConnections } from '../src/lib/db/providers';
import { markAccountUnavailable } from '../src/sse/services/auth';
import { isModelLocked, clearAllModelLockouts } from '../open-sse/services/accountFallback';
import { parseUpstreamError } from '../open-sse/utils/error';
import { setQuotaCache } from '../src/domain/quotaCache';

test('one malformed package makes the entire balance observation unknown', async () => {
 const original = globalThis.fetch;
 globalThis.fetch = (async () => new Response(JSON.stringify({code:0,data:{Response:{Data:{Accounts:[
  {CycleStartTime:'2026-10-01',CycleEndTime:'2026-11-01',DeductionEndTime:'2027-01-01',CycleCapacitySize:500,CycleCapacityUsed:12},
  {CycleEndTime:'2026-11-01',DeductionEndTime:'2026-11-01',CapacitySize:100,CapacityUsed:'bad'}
 ]}}}}))) as typeof fetch;
 try { const result = await getCodeBuddyCnUsage('synthetic'); expect(result.quotas).toBeUndefined(); expect(result.message).toContain('incomplete'); }
 finally { globalThis.fetch = original; }
});

test('past cached reset does not create a past cooldown or error date', async () => {
 const conn = await createProviderConnection({provider:'codebuddy-cn',authType:'oauth',accessToken:'synthetic-old-reset',isActive:true} as any);
 const old = '2020-01-01T00:00:00.000Z';
 setQuotaCache(conn.id, 'codebuddy-cn', {Monthly:{used:500,total:500,resetAt:old}});
 const result = await markAccountUnavailable(conn.id,429,'quota exhausted', 'codebuddy-cn','deepseek-v3.2');
 expect(result.cooldownMs).toBeGreaterThan(0);
 const row:any = (await getProviderConnections({provider:'codebuddy-cn'}) as any[]).find(x=>x.id===conn.id);
 expect(Date.parse(row.rateLimitedUntil)).toBeGreaterThan(Date.now());
 expect(row.lastError).not.toContain(old);
});

test('combo 429 honors HTTP date for only the failed model', async () => {
 const conn = await createProviderConnection({provider:'codebuddy-cn',authType:'oauth',accessToken:'synthetic-combo',isActive:true} as any);
 const date = new Date(Date.now()+120000).toUTCString();
 const parsed = await parseUpstreamError(new Response('{"code":6000}',{status:429,headers:{'retry-after':date}}),'codebuddy-cn');
 try {
  const result = await markAccountUnavailable(conn.id,429,'{"code":6000}', 'codebuddy-cn','deepseek-v3.2',null,{isCombo:true,persistUnavailableState:false,upstreamRetryAfterMs:parsed.retryAfterMs});
  expect(result.cooldownMs).toBeGreaterThan(110000);
  expect(isModelLocked('codebuddy-cn',conn.id,'deepseek-v3.2')).toBe(true);
  expect(isModelLocked('codebuddy-cn',conn.id,'other-model')).toBe(false);
  const row:any = (await getProviderConnections({provider:'codebuddy-cn'}) as any[]).find(x=>x.id===conn.id);
  expect(row.rateLimitedUntil ?? null).toBeNull();
 } finally { clearAllModelLockouts(); }
});
