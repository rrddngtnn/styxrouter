import { expect, test } from 'bun:test';
import { createProviderConnection, getProviderConnections } from '../src/lib/db/providers';
import { markAccountUnavailable } from '../src/sse/services/auth';
import { capScaledCooldownMs } from '../open-sse/services/accountFallback/cooldownCap';
import { parseUpstreamError } from '../open-sse/utils/error';
const profile = { baseCooldownMs: 500, maxCooldownMs: 2000, maxBackoffSteps: 3, useUpstreamRetryHints: true } as any;
async function mark(hint: number, overrides = {}) {
 const a = await createProviderConnection({provider:'kiro',authType:'oauth',accessToken:'synthetic',isActive:true} as any);
 const result = await markAccountUnavailable(a.id,429,'rate limited','kiro','exact-model',{...profile,...overrides},{upstreamRetryAfterMs:hint});
 const saved = (await getProviderConnections({provider:'kiro'}) as any[]).find(c => c.id === a.id);
 return {result,saved};
}
for (const steps of [NaN, Infinity, -1, Number.MAX_VALUE]) test(`invalid or huge backoff steps ${steps} remain bounded`, async () => {
 const {result,saved} = await mark(0,{maxBackoffSteps:steps,maxCooldownMs:2000});
 expect(Number.isFinite(result.cooldownMs)).toBe(true);
 expect(result.cooldownMs).toBeGreaterThan(0);
 expect(result.cooldownMs).toBeLessThanOrEqual(2000);
 expect(Number.isFinite(saved.backoffLevel)).toBe(true);
});

test('operator upstream-hints opt-out retains bounded local cooldown', async () => {
 const {result} = await mark(120000,{useUpstreamRetryHints:false});
 expect(result.cooldownMs).toBe(500);
});
test('valid upstream minimum exceeds local maximum but short hint cannot reduce local backoff', async () => {
 expect((await mark(120000)).result.cooldownMs).toBe(120000);
 expect((await mark(1)).result.cooldownMs).toBe(500);
});
for (const hint of [-1, NaN, Infinity]) test(`invalid parsed hint ${hint} uses local cooldown`, async () => {
 const {result,saved} = await mark(hint);
 expect(result.cooldownMs).toBe(500);
 expect(Number.isFinite(new Date(saved.rateLimitedUntil).getTime())).toBe(true);
});
for (const cap of [-1,0,NaN,Infinity]) test(`invalid local max ${cap} uses finite fallback`, () => {
 expect(capScaledCooldownMs(Infinity,cap,1800000)).toBe(1800000);
});
for (const header of ['-1','NaN','Infinity','not-a-date','999999999999999999999999999999999999999']) test(`hostile Retry-After ${header} remains finite`, async () => {
 const parsed = await parseUpstreamError(Response.json({message:'rate limited'},{status:429,headers:{'Retry-After':header}}),'kiro');
 expect(parsed.retryAfterMs === null || (Number.isFinite(parsed.retryAfterMs) && parsed.retryAfterMs > 0 && parsed.retryAfterMs <= 86400000)).toBe(true);
});

test('quota observation is not generation recovery for a generic Kiro rate-limit streak', async () => {
 const {saved} = await mark(120000);
 const { updateProviderConnection } = await import('../src/lib/db/providers');
 await updateProviderConnection(saved.id,{rateLimitedUntil:new Date(Date.now()-1000).toISOString()});
 const current = (await getProviderConnections({provider:'kiro'}) as any[]).find(c=>c.id===saved.id);
 const { maybeClearRecoveredQuotaState } = await import('../src/lib/usage/providerLimits');
 await maybeClearRecoveredQuotaState(current,{quotas:{credits:{used:0,limit:1000,remaining:1000}}});
 const after = (await getProviderConnections({provider:'kiro'}) as any[]).find(c=>c.id===saved.id);
 expect(after.backoffLevel).toBe(saved.backoffLevel);
 expect(String(after.errorCode)).toBe('429');
});

test('huge finite direct hint retains parser safety ceiling', async () => {
 expect((await mark(Number.MAX_VALUE)).result.cooldownMs).toBe(86400000);
});
