import { expect, test } from 'bun:test';
import { createApiKey, updateApiKeyPermissions } from '../src/lib/db/apiKeys';
import { createProviderConnection } from '../src/lib/db/providers';
import { initTranslators } from '../open-sse/translator/index';
import { handleChat } from '../src/sse/handlers/chat';

process.env.API_KEY_SECRET = 'synthetic-pin-regression-secret';

test('explicit invalid and ACL-denied pins never dispatch to an allowed sibling', async () => {
  await initTranslators();
  const a = await createProviderConnection({provider:'openai', authType:'apikey', apiKey:'synthetic-pin-a', isActive:true, priority:1} as any);
  const b = await createProviderConnection({provider:'openai', authType:'apikey', apiKey:'synthetic-pin-b', isActive:true, priority:2} as any);
  const key = await createApiKey('pin-acl', 'test');
  // Unrestricted key exercises dispatch rather than quota model-policy rejection.

  const seen:string[] = []; const previous = globalThis.fetch;
  try {
    globalThis.fetch = (async (_url, options) => { seen.push(new Headers(options?.headers).get('authorization') ?? ''); return new Response(JSON.stringify({id:'fixture',object:'chat.completion',choices:[{index:0,message:{role:'assistant',content:'ok'},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}}); }) as typeof fetch;
    for (const pin of ['nonexistent-pin', b.id]) {
      if (pin === b.id) await updateApiKeyPermissions(key.id, {allowedConnections:[a.id]});
      const req = new Request('http://localhost/v1/chat/completions', {method:'POST', headers:{'content-type':'application/json', authorization:`Bearer ${key.key}`, 'x-styx-connection':pin}, body:JSON.stringify({model:'openai/gpt-4o',messages:[{role:'user',content:'hi'}],stream:false})});
      const response = await handleChat(req); await response.text();
      expect(response.status).not.toBe(200);
      expect(seen).toEqual([]);
    }
  } finally { globalThis.fetch = previous; }
}, 60000);
