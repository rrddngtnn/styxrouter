import './helpers/test-secrets';
import { test, expect } from 'bun:test';
import { createRequestLogger } from '../open-sse/utils/requestLogger';
import { OpencodeExecutor } from '../open-sse/executors/opencode';
import { createHmac } from 'node:crypto';

test('pipeline retains diagnostics but redacts caller session headers and nested metadata without changing transport', async () => {
  const raw = 'RAW_SESSION_REVIEW_SENTINEL';
  const headers = { 'X-OpenCode-Session': raw, 'X-Session-ID': raw + '-id', 'x-session-affinity': raw + '-affinity', 'x-debug': 'retained' };
  const logger = await createRequestLogger('openai', 'openai', 'fixture', { enabled: true });
  logger.logClientRawRequest('/v1/chat/completions', { messages: [{role:'user',content:'retained prompt'}] }, headers);
  logger.logTargetRequest('https://gateway.example/v1?token=QUERY_SECRET_SENTINEL&tenant=abc', headers, {metadata: headers});
  logger.logProviderResponse(403, 'Forbidden', new Headers(headers), {metadata: headers});
  logger.logConvertedResponse({metadata: headers, error: 'retained error'});
  logger.logError(new Error('retained diagnostic'), {metadata: headers});
  const payload = logger.getPipelinePayloads()!;
  const serialized = JSON.stringify(payload);
  expect(serialized).not.toContain(raw);
  expect(serialized).not.toContain('QUERY_SECRET_SENTINEL');
  expect(payload.clientRawRequest?.headers).toEqual({...headers, 'X-OpenCode-Session':'[REDACTED]', 'X-Session-ID':'[REDACTED]', 'x-session-affinity':'[REDACTED]'});
  expect(serialized).toContain('retained prompt');
  expect(serialized).toContain('retained diagnostic');
  expect(serialized).toContain('tenant=abc');
  const original = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (_url, init) => { seen.push(new Headers(init?.headers).get('x-opencode-session')!); return Response.json({error:{message:'denied'}},{status:403}); }) as typeof fetch;
  try {
    for (const owner of ['owner-a','owner-a','owner-b']) {
      await new OpencodeExecutor('opencode-go').execute({model:'fixture',body:{messages:[]},credentials:{apiKey:'synthetic-upstream'},stream:false,clientHeaders:headers,sessionPrincipalId:owner,skipUpstreamRetry:true});
    }
    const expected = createHmac('sha256',process.env.API_KEY_SECRET!).update(JSON.stringify(['styx/opencode/session/v1','opencode-go','owner-a',raw])).digest('hex');
    expect(seen).toHaveLength(3);
    expect(seen[0]).toBe(expected); expect(seen[1]).toBe(expected); expect(seen[2]).not.toBe(expected);
    expect(headers['X-OpenCode-Session']).toBe(raw);
  } finally {globalThis.fetch = original;}
});
