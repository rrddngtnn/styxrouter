import './helpers/test-secrets';
import { afterAll, expect, test } from 'bun:test';

// Both the inbound route and the synthetic upstream use real loopback HTTP.
// Install the egress fence before importing any application modules.
const nativeFetch = globalThis.fetch;
let hint = '120';
let upstreamStatus = 429;
const wires: any[] = [];
const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
  wires.push(await req.json());
  return upstreamStatus === 429
    ? Response.json({ message: 'Too many requests, please wait before trying again.', error: { message: 'rate limited' } }, { status: 429, headers: { 'Retry-After': hint } })
    : Response.json({ id: 'fixture', object: 'chat.completion', model: 'gpt-4o-mini', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
}});
globalThis.fetch = (async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname === '127.0.0.1') return nativeFetch(input, init);
  if (url.hostname === 'codewhisperer.us-east-1.amazonaws.com' || url.hostname === 'api.openai.com') {
    return nativeFetch(new URL(url.pathname, upstream.url), init);
  }
  throw new Error(`External egress blocked: ${url.hostname}`);
}) as typeof fetch;
const { createApiKey } = await import('../src/lib/db/apiKeys');
const { createProviderConnection, getProviderConnections, updateProviderConnection } = await import('../src/lib/db/providers');
const { initTranslators } = await import('../open-sse/translator/index');
const { handleChat } = await import('../src/sse/handlers/chat');
const { updateSettings } = await import('../src/lib/db/settings');
await updateSettings({ resilienceSettings: { connectionCooldown: { oauth: { baseCooldownMs: 500, useUpstreamRetryHints: true, maxBackoffSteps: 3 }, apikey: { baseCooldownMs: 500, useUpstreamRetryHints: true, maxBackoffSteps: 3 } } } });
await initTranslators();
const route = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: handleChat });
const key = await createApiKey('synthetic-429-http', 'test');
const row = async (provider: string, id: string) => (await getProviderConnections({ provider }) as any[]).find(c => c.id === id);
afterAll(() => { route.stop(true); upstream.stop(true); globalThis.fetch = nativeFetch; });

for (const provider of ['kiro', 'openai']) for (const format of ['seconds', 'date']) {
  test(`actual HTTP ${provider} forwards and persists ${format} Retry-After without model rewrite`, async () => {
    const conn = await createProviderConnection({ provider, authType: provider === 'kiro' ? 'oauth' : 'apikey', accessToken: `synthetic-oauth-${format}`, apiKey: `synthetic-api-${format}`, isActive: true } as any);
    hint = format === 'seconds' ? '120' : new Date(Date.now() + 180000).toUTCString();
    upstreamStatus = 429;
    wires.length = 0;
    const model = provider === 'kiro' ? 'claude-sonnet-4.5' : 'gpt-4o-mini';
    const before = Date.now();
    const response = await fetch(new URL('/v1/chat/completions', route.url), { method: 'POST', headers: { authorization: `Bearer ${key.key}`, 'content-type': 'application/json', 'x-styx-connection': conn.id, 'x-session-id': conn.id }, body: JSON.stringify({ model: `${provider}/${model}`, messages: [{ role: 'user', content: `synthetic-${conn.id}` }], stream: false }) });
    await response.text();
    expect(response.status).toBe(429);
    expect(wires).toHaveLength(provider === 'kiro' ? 1 : 3); // existing bounded executor retries
    const sentModel = provider === 'kiro' ? wires[0].conversationState.currentMessage.userInputMessage.modelId : wires[0].model;
    expect(sentModel).toBe(model);
    const saved = await row(provider, conn.id);
    expect(new Date(saved.rateLimitedUntil).getTime() - before).toBeGreaterThan(format === 'seconds' ? 119000 : 178000);
    expect(saved.backoffLevel).toBeGreaterThan(0);
    expect(saved.isActive).toBe(true);
    expect(saved.testStatus).not.toBe('banned');
    await updateProviderConnection(conn.id, { isActive: false });
  }, 30000);
}

test('expired cooldown remains selectable and actual upstream success clears the 429 streak', async () => {
  const conn = await createProviderConnection({ provider: 'openai', authType: 'apikey', apiKey: 'synthetic-api-success', isActive: true } as any);
  await updateProviderConnection(conn.id, { backoffLevel: 3, errorCode: 429, lastErrorType: 'rate_limited', lastError: 'rate limited', testStatus: 'unavailable', rateLimitedUntil: new Date(Date.now() - 1000).toISOString() });
  const { getProviderCredentials } = await import('../src/sse/services/auth');
  const credentials = await getProviderCredentials('openai', null, [conn.id], 'gpt-4o-mini');
  expect(credentials?.connectionId).toBe(conn.id);
  expect((await row('openai', conn.id)).backoffLevel).toBe(3);
  upstreamStatus = 200; wires.length = 0;
  const response = await fetch(new URL('/v1/chat/completions', route.url), { method: 'POST', headers: { authorization: `Bearer ${key.key}`, 'content-type': 'application/json', 'x-styx-connection': conn.id, 'x-session-id': conn.id }, body: JSON.stringify({ model: 'openai/gpt-4o-mini', messages: [{ role: 'user', content: `success-${conn.id}` }], stream: false }) });
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('ok');
  expect(wires).toHaveLength(1);
  const saved = await row('openai', conn.id);
  expect(saved.backoffLevel).toBe(0);
  expect(saved.rateLimitedUntil == null).toBe(true);
  expect(saved.errorCode == null).toBe(true);
}, 30000);
