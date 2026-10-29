import { expect, test } from "bun:test";
import { GET } from "../src/app/api/usage/quota/route";
import { createProviderConnection } from "../src/lib/db/providers";
import { setProviderLimitsCache } from "../src/lib/db/providerLimits";

test("CBCN credits with an invalid observation time are unknown, not observed", async () => {
  const c = await createProviderConnection({provider:"codebuddy-cn",authType:"oauth",accessToken:"synthetic",isActive:true} as any);
  setProviderLimitsCache(c.id, {quotas:{Monthly:{used:2,total:10}},plan:null,message:null,fetchedAt:"not-a-date"});
  const response = await GET(new Request(`http://localhost/api/usage/quota?connectionId=${c.id}`));
  expect(response.status).toBe(200);
  const row = ((await response.json()) as any).providers[0];
  expect(row.creditStatus).toBe("unknown");
  expect(row.percentRemaining).toBeNull();
});
