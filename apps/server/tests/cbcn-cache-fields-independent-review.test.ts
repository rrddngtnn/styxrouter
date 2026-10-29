import { expect, test } from 'bun:test';
import { createProviderConnection } from '../src/lib/db/providers';
import { setProviderLimitsCache } from '../src/lib/db/providerLimits';
import { GET } from '../src/app/api/usage/quota/route';
import { getCodeBuddyCnUsage } from '../open-sse/services/usage/codebuddy-cn';
import { getExecutor } from '../open-sse/executors/index';
import { GET as liveGet } from '../src/app/api/usage/[connectionId]/route';

test('legacy cache untrusted plan and window labels do not leak through quota API', async () => {
  const secret = 'synthetic-cache-secret-marker';
  const c = await createProviderConnection({provider:'codebuddy-cn', authType:'oauth',accessToken:'synthetic-token',isActive:true} as any);
  setProviderLimitsCache(c.id, {plan:secret, message:secret, quotas:{[secret]:{used:1,total:10,displayName:secret,resetAt:secret}}, fetchedAt:new Date().toISOString()});
  const text = await (await GET(new Request(`http://localhost/api/usage/quota?connectionId=${c.id}`))).text();
  expect(text).not.toContain(secret);
});

test('thrown refresh errors never leak via response or logs', async () => {
  const secret = 'synthetic-thrown-secret-marker';
  const c = await createProviderConnection({provider:'codebuddy-cn', authType:'oauth',accessToken:'synthetic-token-error',refreshToken:'synthetic-refresh', tokenExpiresAt:'2020-01-01T00:00:00.000Z',isActive:true} as any);
  const executor = await getExecutor('codebuddy-cn');
  const needs = executor.needsRefresh, refresh = executor.refreshCredentials;
  const oldError = console.error, oldWarn = console.warn;
  const logs: string[] = [];
  executor.needsRefresh = () => true;
  executor.refreshCredentials = async () => { throw new Error(secret); };
  console.error = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
  console.warn = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
  try {
    const response = await liveGet(new Request('http://localhost/'), {params:Promise.resolve({connectionId:c.id})});
    expect(await response.text()).not.toContain(secret);
    expect(logs.join('\n')).not.toContain(secret);
  } finally { executor.needsRefresh = needs; executor.refreshCredentials = refresh; console.error = oldError; console.warn = oldWarn; }
});

test('upstream package name cannot inject secrets into usage output', async () => {
  const secret = 'synthetic-upstream-secret-marker';
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({code:0,data:{Response:{Data:{Accounts:[{PackageName:secret,CapacityUsed:1,CapacitySize:10}]}}}}))) as typeof fetch;
  try { expect(JSON.stringify(await getCodeBuddyCnUsage('synthetic-token'))).not.toContain(secret); }
  finally { globalThis.fetch = original; }
});
