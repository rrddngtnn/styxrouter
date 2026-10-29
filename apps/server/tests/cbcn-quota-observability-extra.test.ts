import { expect, test } from "bun:test";
import { GET } from "../src/app/api/usage/quota/route";
import { createProviderConnection, updateProviderConnection } from "../src/lib/db/providers";
import { setProviderLimitsCache } from "../src/lib/db/providerLimits";

test("credit status reports fresh, past-reset and missing observations without treating cooldown as credit", async () => {
  const add = async (name: string) => createProviderConnection({provider:"codebuddy-cn",name,authType:"oauth",accessToken:`synthetic-${name}`,isActive:true} as any);
  const fresh = await add("fresh");
  const past = await add("past");
  const unknown = await add("unknown");
  const now = new Date().toISOString();
  for (const [c,resetAt] of [[fresh, new Date(Date.now()+3600000).toISOString()], [past,"2020-01-01T00:00:00.000Z"]] as const) {
    setProviderLimitsCache(c.id,{quotas:{Monthly:{used:1,total:10,resetAt}},plan:null,message:null,fetchedAt:now});
  }
  const incomplete = await add("incomplete");
  setProviderLimitsCache(incomplete.id,{quotas:{Monthly:{used:1,total:10},Bonus:{used:null,total:10}},plan:null,message:null,fetchedAt:now});
  await updateProviderConnection(unknown.id,{rateLimitedUntil:"2020-01-01T00:00:00.000Z"} as any);
  const result = await (await GET(new Request("http://localhost/api/usage/quota?provider=codebuddy-cn"))).json() as any;
  const rows = Object.fromEntries(result.providers.map((p: any) => [p.connectionId,p])) as Record<string,any>;
  expect(rows[fresh.id].creditStatus).toBe("observed");
  expect(rows[past.id].creditStatus).toBe("stale");
  expect(rows[unknown.id].creditStatus).toBe("unknown");
  expect(rows[incomplete.id].creditStatus).toBe("unknown");
  expect(rows[unknown.id].accountCooldownUntil).toBeNull();
  expect(rows[fresh.id].modelCooldowns).toEqual([]);
});
