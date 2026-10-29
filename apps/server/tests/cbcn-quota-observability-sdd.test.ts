import { expect, test } from "bun:test";
import { GET } from "../src/app/api/usage/quota/route";
import { createProviderConnection, updateProviderConnection } from "../src/lib/db/providers";
import { setProviderLimitsCache } from "../src/lib/db/providerLimits";
import { markAccountUnavailable } from "../src/sse/services/auth";
import { clearAllModelLockouts } from "../open-sse/services/accountFallback";

test("CBCN quota API separates unknown credit from model and account cooldowns", async () => {
  const c = await createProviderConnection({provider:"codebuddy-cn",authType:"oauth",accessToken:"synthetic",isActive:true} as any);
  const until = new Date(Date.now()+180000).toISOString();
  await markAccountUnavailable(c.id,429,'{"code":6000}',"codebuddy-cn","synthetic-model",null,{isCombo:true,persistUnavailableState:false,upstreamRetryAfterMs:120000});
  await updateProviderConnection(c.id, {rateLimitedUntil:until} as any);
  try {
    const response = await GET(new Request(`http://localhost/api/usage/quota?connectionId=${c.id}`));
    const row = (await response.json() as any).providers[0];
    expect(row.creditStatus).toBe("unknown");
    expect(row.accountCooldownUntil).toBe(until);
    expect(row.modelCooldowns).toEqual([expect.objectContaining({model:"synthetic-model",reason:expect.any(String),until:expect.any(String)})]);
    expect(row.quotaTotal).toBe(100); // existing legacy summary contract remains intact
  } finally { clearAllModelLockouts(); }
});

test("CBCN cached stale credit remains separate from model cooldown", async () => {
  const c = await createProviderConnection({provider:"codebuddy-cn",authType:"oauth",accessToken:"synthetic-stale",isActive:true} as any);
  setProviderLimitsCache(c.id, {quotas:{Monthly:{used:2,total:10}},plan:null,message:"failed",fetchedAt:new Date().toISOString(),refreshFailed:true});
  const row = ((await (await GET(new Request(`http://localhost/api/usage/quota?connectionId=${c.id}`))).json()) as any).providers[0];
  expect(row.creditStatus).toBe("stale");
  expect(row.windows[0].stale).toBe(true);
  expect(row.accountCooldownUntil).toBeNull();
  expect(row.modelCooldowns).toEqual([]);
});
