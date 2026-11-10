import { expect, test } from 'bun:test';
import { createProviderConnection, getProviderConnections, updateProviderConnection } from '../src/lib/db/providers';
import { getProviderCredentials, markAccountUnavailable } from '../src/sse/services/auth';
import { parseUpstreamError } from '../open-sse/utils/error';

const message = 'Too many requests, please wait before trying again.';
async function row(id:string) { return (await getProviderConnections({provider:'kiro'}) as any[]).find(x=>x.id===id); }
test('generic Kiro 429 preserves Retry-After independent of low local cooldown', async () => {
 const a = await createProviderConnection({provider:'kiro',authType:'oauth',accessToken:'synthetic',isActive:true} as any);
 const parsed = await parseUpstreamError(new Response(JSON.stringify({message,reason:'USER_REQUEST_RATE_EXCEEDED'}),{status:429,headers:{'retry-after':'120'}}),'kiro');
 const result = await markAccountUnavailable(a.id,429,message,'kiro','exact-model',{baseCooldownMs:500,maxCooldownMs:1800000,maxBackoffSteps:3,useUpstreamRetryHints:true} as any,{upstreamRetryAfterMs:parsed.retryAfterMs});
 expect(result.cooldownMs).toBeGreaterThanOrEqual(120000);
 const after:any = await row(a.id);
 expect(after.isActive).toBe(true);
 expect(after.testStatus).not.toBe('banned');
 expect(after.testStatus).not.toBe('credits_exhausted');
});

test('expired local rate cooldown does not erase failure streak before next request', async () => {
 const a = await createProviderConnection({provider:'kiro',authType:'oauth',accessToken:'synthetic',isActive:true} as any);
 await markAccountUnavailable(a.id,429,message,'kiro','exact-model');
 const before:any=await row(a.id);
 await updateProviderConnection(a.id,{rateLimitedUntil:new Date(Date.now()-1000).toISOString()});
 await getProviderCredentials('kiro',null,[a.id],'exact-model');
 const after:any=await row(a.id);
 expect(after.backoffLevel).toBe(before.backoffLevel);
 const again=await markAccountUnavailable(a.id,429,message,'kiro','exact-model');
 expect(again.cooldownMs).toBeGreaterThan(0);
 expect((await row(a.id)).backoffLevel).toBeGreaterThan(before.backoffLevel);
});

test('HTTP-date hint is respected and repeated no-hint throttles have bounded exponential backoff', async () => {
 const a=await createProviderConnection({provider:'kiro',authType:'oauth',accessToken:'synthetic',isActive:true} as any);
 const parsed=await parseUpstreamError(new Response(JSON.stringify({message}),{status:429,headers:{'retry-after':new Date(Date.now()+180000).toUTCString()}}),'kiro');
 const hinted=await markAccountUnavailable(a.id,429,message,'kiro','exact-model',{baseCooldownMs:500,maxCooldownMs:1800000,maxBackoffSteps:3,useUpstreamRetryHints:true} as any,{upstreamRetryAfterMs:parsed.retryAfterMs});
 expect(hinted.cooldownMs).toBeGreaterThan(178000);
 const waits:number[]=[];
 for(let i=0;i<12;i++) {
   await updateProviderConnection(a.id,{rateLimitedUntil:new Date(Date.now()-1000).toISOString()});
   waits.push((await markAccountUnavailable(a.id,429,message,'kiro','exact-model')).cooldownMs);
 }
 expect(waits[1]).toBeGreaterThan(waits[0]);
 expect(waits[11]).toBe(waits[10]);
 expect(waits[11]).toBeLessThanOrEqual(1800000);
 expect((await row(a.id)).isActive).toBe(true);
});
