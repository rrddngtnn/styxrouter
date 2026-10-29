import { test, expect } from 'bun:test';
import { SignJWT } from 'jose';
import { createApiKey, getApiKeyById, updateApiKeyPermissions } from '../src/lib/db/apiKeys';
import { getDbInstance } from '../src/lib/db/core';
import { enforceApiKeyPolicy } from '../src/shared/utils/apiKeyPolicy';
import { createProviderConnection } from '../src/lib/db/providers';
import { createPool, deletePool, getPool } from '../src/lib/db/quotaPools';
import { Hono } from 'hono';
import { createAdminApi } from '../server/admin';

test('authenticated playground refuses a selected key with corrupt quota policy', async () => {
  process.env.JWT_SECRET = 'isolated-review-secret';
  const key = await createApiKey('playground-corrupt', 'test');
  getDbInstance().prepare("UPDATE api_keys SET allowed_quotas = '{bad' WHERE id = ?").run(key.id);
  const token = await new SignJWT({authenticated:true}).setProtectedHeader({alg:'HS256'}).setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET));
  const request = new Request('http://localhost/v1/chat/completions', {headers:{cookie:`auth_token=${token}`, 'x-styx-playground-key-id':key.id}});
  const result = await enforceApiKeyPolicy(request, 'openai/gpt-4o');
  expect(result.rejection?.status).toBe(503);
  getDbInstance().prepare("UPDATE api_keys SET allowed_quotas = '[]' WHERE id = ?").run(key.id);
});

test('sparse quota updates are rejected without altering stored policy', async () => {
  const key = await createApiKey('sparse-policy', 'test');
  await updateApiKeyPermissions(key.id, {allowedQuotas:['original']});
  await expect(updateApiKeyPermissions(key.id, {allowedQuotas:new Array(1)})).rejects.toThrow('Invalid API key quota policy');
  expect((await getApiKeyById(key.id))?.allowedQuotas).toEqual(['original']);
});

test('valid quota strings cannot be changed by a custom array serializer', async () => {
  const key = await createApiKey('quota-serializer', 'test');
  const quotas = ['restricted'];
  Object.defineProperty(quotas, 'toJSON', {value: () => []});
  await updateApiKeyPermissions(key.id, {allowedQuotas:quotas});
  expect((await getApiKeyById(key.id))?.allowedQuotas).toEqual(['restricted']);
});

test('pool deletion preserves exact other string values, ordering and duplicates', async () => {
  const key = await createApiKey('surrogate-policy', 'test');
  const conn = await createProviderConnection({provider:'openai', authType:'apikey', apiKey:'test'} as any);
  const pool = createPool({connectionId:conn.id, name:'surrogate'});
  const remaining = ['\ud800', 'x\u0000y', '💡', 'same', 'same', ''];
  await updateApiKeyPermissions(key.id, {allowedQuotas:[pool.id, ...remaining, pool.id]});
  expect(await deletePool(pool.id)).toBe(true);
  expect((await getApiKeyById(key.id))?.allowedQuotas).toEqual(remaining);
});

test('admin can explicitly repair corrupt quotas to a deny-all policy without granting access', async () => {
  const key = await createApiKey('repair-policy', 'test');
  const db = getDbInstance();
  db.prepare("UPDATE api_keys SET allowed_quotas = '{bad' WHERE id = ?").run(key.id);
  const app = new Hono(); app.route('/api', createAdminApi());
  const patch = (body: unknown) => app.request(`/api/keys/${key.id}`, {method:'PATCH', headers:{'content-type':'application/json'}, body:JSON.stringify(body)});
  expect((await patch({allowedQuotas:[]})).status).toBe(400);
  expect((await patch({allowedQuotas:['some-pool']})).status).toBe(400);
  expect((await patch({name:'still-corrupt'})).status).toBe(200);
  const request = new Request('http://localhost/v1/chat/completions', {headers:{authorization:`Bearer ${key.key}`}});
  expect((await enforceApiKeyPolicy(request, 'openai/gpt-4o')).rejection?.status).toBe(503);
  expect((await patch({allowedQuotas:['__quota_access_revoked__'], isActive:true})).status).toBe(200);
  expect((await getApiKeyById(key.id))?.allowedQuotas).toEqual(['__quota_access_revoked__']);
  expect((await getApiKeyById(key.id))?.isActive).toBe(false);
  expect((await enforceApiKeyPolicy(request, null)).rejection).not.toBeNull();
  expect((await enforceApiKeyPolicy(request, 'openai/gpt-4o')).rejection).not.toBeNull();
  expect((await enforceApiKeyPolicy(request, 'qtSd/example/openai')).rejection).not.toBeNull();
});

test('corrupt policy blocks pool deletion until explicit deny-all repair', async () => {
  const key = await createApiKey('unrelated-corrupt', 'test');
  const conn = await createProviderConnection({provider:'openai', authType:'apikey', apiKey:'test'} as any);
  const pool = createPool({connectionId:conn.id, name:'unrelated'});
  const db = getDbInstance();
  db.prepare("UPDATE api_keys SET allowed_quotas = '{bad' WHERE id = ?").run(key.id);
  await expect(deletePool(pool.id)).rejects.toThrow('Invalid API key quota policy');
  expect(getPool(pool.id)).not.toBeNull();
  expect(db.prepare('SELECT allowed_quotas FROM api_keys WHERE id = ?').get(key.id)).toEqual({allowed_quotas:'{bad'});
  const request = new Request('http://localhost/v1/chat/completions', {headers:{authorization:`Bearer ${key.key}`}});
  expect((await enforceApiKeyPolicy(request, 'openai/gpt-4o')).rejection?.status).toBe(503);
  const app = new Hono(); app.route('/api', createAdminApi());
  expect((await app.request(`/api/keys/${key.id}`, {method:'PATCH', headers:{'content-type':'application/json'}, body:JSON.stringify({allowedQuotas:['__quota_access_revoked__']})})).status).toBe(200);
  expect(await deletePool(pool.id)).toBe(true);
  expect(getPool(pool.id)).toBeNull();
  expect((await enforceApiKeyPolicy(request, 'openai/gpt-4o')).rejection).not.toBeNull();
});
