import { test, expect } from 'bun:test';
process.env.STYX_OPENCODE_QUOTA_URL='https://quota-fixture.invalid/observed';
test('operator quota endpoint exposes only observed windows, never invented dollar limits',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=(async()=>Response.json({quota:{window_5h:{used:1,limit:10}}})) as typeof fetch;
 try {
 const {getOpencodeUsage}=await import('../open-sse/services/usage/opencode.ts');
 const result:any=await getOpencodeUsage('fixture-observed','fixture');
 expect(Object.keys(result.quotas)).toEqual(['window_5h']);
 expect(result.quotas.window_5h.currency).toBeUndefined();
 expect(result.quotas.window_5h.remainingPercentage).toBe(90);
 expect(result.plan).not.toBe('OpenCode Go');
 globalThis.fetch=(async()=>Response.json({quota:{window_5h:{reset_at:123}}})) as typeof fetch;
 const {fetchOpencodeQuota}=await import('../open-sse/services/opencodeQuotaFetcher.ts');
 expect(await fetchOpencodeQuota('fixture-malformed',{apiKey:'fixture'})).toBeNull();
 }finally{globalThis.fetch=original;}
});
