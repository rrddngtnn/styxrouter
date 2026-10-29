import { expect, test } from "bun:test";
import { getCodeBuddyCnUsage } from "../open-sse/services/usage/codebuddy-cn";
import { createProviderConnection } from "../src/lib/db/providers";
import { fetchAndPersistProviderLimits } from "../src/lib/usage/providerLimits";
import { GET } from "../src/app/api/usage/quota/route";
import { setProviderLimitsCache } from "../src/lib/db/providerLimits";

test("upstream error cannot expose a synthetic secret through quota dashboard", async () => {
  const marker = "synthetic-private-secret-marker";
  const c = await createProviderConnection({provider:"codebuddy-cn",authType:"oauth",accessToken:"synthetic-access",isActive:true} as any);
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({code:123,msg:marker}), {status:200,headers:{"content-type":"application/json"}})) as typeof fetch;
  try {
    await fetchAndPersistProviderLimits(c.id, "scheduled");
    const result = await (await GET(new Request(`http://localhost/api/usage/quota?connectionId=${c.id}`))).text();
    expect(result).not.toContain(marker);
    expect((JSON.parse(result).providers[0]).percentRemaining).toBeNull();
  } finally { globalThis.fetch = original; }
});

test("legacy cached upstream error is never exposed even after successful refresh", async () => {
  const marker = "synthetic-legacy-secret";
  const c = await createProviderConnection({provider:"codebuddy-cn",authType:"oauth",accessToken:"synthetic-access-legacy",isActive:true} as any);
  setProviderLimitsCache(c.id, {quotas:null, plan:null, message:`CodeBuddy CN quota error: ${marker}`, fetchedAt:new Date().toISOString()});
  const response = await (await GET(new Request(`http://localhost/api/usage/quota?connectionId=${c.id}`))).text();
  expect(response).not.toContain(marker);
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({code:0,data:{Response:{Data:{Accounts:[]}}}}), {status:200})) as typeof fetch;
  try {
    const result = await fetchAndPersistProviderLimits(c.id, "scheduled");
    expect(JSON.stringify(result.usage)).not.toContain(marker);
    expect(JSON.stringify(result.cache)).not.toContain(marker);
  } finally { globalThis.fetch = original; }
});
