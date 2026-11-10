import { test, expect, afterAll } from "bun:test";
import { Hono } from "hono";
import { createAdminApi } from "../server/admin.ts";
import { requireAuth } from "../server/auth.ts";
import { AntigravityExecutor } from "../open-sse/executors/antigravity.ts";
import { clearAntigravityVersionCaches } from "../open-sse/services/antigravityVersion.ts";

const original = globalThis.fetch;
afterAll(() => { globalThis.fetch = original; clearAntigravityVersionCaches(); });

test("CLI pin controls dispatch while legacy IDE uses Hub independently of IDE diagnostics", async () => {
  delete process.env.STYX_ANTIGRAVITY_CLIENT_PROFILE;
  const app = new Hono(); app.route('/api', createAdminApi());
  const put = (product: string, version: unknown) => app.request(`/api/versions/antigravity/${product}/pin`, {method:'PUT', headers:{'content-type':'application/json'}, body:JSON.stringify({version})});
  expect((await put('ide','1.2.3')).status).toBe(200);
  expect((await put('cli','3.4.5')).status).toBe(200);
  const agents: string[] = [];
  const authHeaders: string[] = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.includes('auto-updater')) return url.includes('cli-auto-updater') ? Response.json({version:'7.8.9'}) : Response.json([{version:'8.9.10'}]);
    agents.push(new Headers(init?.headers).get('user-agent') || '');
    authHeaders.push(new Headers(init?.headers).get('authorization') || '');
    return new Response('data: {"response":{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}}\n\n', {status:200, headers:{'content-type':'text/event-stream'}});
  }) as typeof fetch;
  const refresh = await app.request('/api/versions/antigravity/refresh', {method:'POST'});
  expect((await refresh.json() as any).versions).toEqual({ide:'8.9.10',cli:'7.8.9'});
  for (const profile of ['ide','cli']) {
    const result = await new AntigravityExecutor().execute({model:'gemini-3-flash',body:{contents:[{role:'user',parts:[{text:'hi'}]}]},stream:true,credentials:{accessToken:'test-only-secret',projectId:'real-project',providerSpecificData:{clientProfile:profile}}} as any);
    expect(result.response.status).toBe(200);
  }
  expect(agents).toHaveLength(2);
  expect(agents[0]).toContain('antigravity/hub/2.24.0');
  expect(agents[1]).toContain('antigravity/cli/3.4.5');
  expect(authHeaders).toEqual(['Bearer test-only-secret','Bearer test-only-secret']);
  for (const invalid of ['', '1.2', '1.2.3\n', '1234567.2.3', 'v1.2.3', 3, {}, '1.2.3\r\nx-secret: test']) expect((await put('ide',invalid)).status).toBe(400);
  expect((await app.request('/api/versions/antigravity/ide/pin')).json()).resolves.toEqual({version:'1.2.3'});
  expect((await put('ide',null)).status).toBe(200);
  const afterClear = await new AntigravityExecutor().execute({model:'gemini-3-flash',body:{contents:[{role:'user',parts:[{text:'hi'}]}]},stream:true,credentials:{accessToken:'test-only-secret',projectId:'real-project',providerSpecificData:{clientProfile:'ide'}}} as any);
  expect(afterClear.response.status).toBe(200);
  expect(agents[2]).toContain('antigravity/hub/2.24.0');
});

test('pin routes reject unauthenticated requests', async () => {
  const app = new Hono(); app.use('*', requireAuth); app.route('/api',createAdminApi());
  for (const product of ['ide','cli']) for (const method of ['GET','PUT']) expect((await app.request(`/api/versions/antigravity/${product}/pin`,{method})).status).toBe(401);
});
