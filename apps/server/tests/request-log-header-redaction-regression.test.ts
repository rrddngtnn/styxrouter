import { expect, test } from 'bun:test';
import { createRequestLogger } from '../open-sse/utils/requestLogger';

test('request pipeline never stores fragments of sensitive client or provider headers', async () => {
  const logger = await createRequestLogger();
  const secret = 'secret-prefix-1234567890-secret-suffix';
  logger.logClientRawRequest('/v1/chat/completions', {}, new Headers({authorization: `Bearer ${secret}`, 'x-ratelimit-token': secret, 'x-ratelimit-remaining': '42'}));
  logger.logTargetRequest('https://example.invalid', {'X-API-Key': secret, 'X-Trace': 'trace-value'}, {});
  logger.logProviderResponse(200, 'OK', {'Set-Cookie': `session=${secret}`, 'x-ratelimit-reset': '60'}, {});
  const payload: any = logger.getPipelinePayloads();
  expect(payload.clientRawRequest.headers.authorization).toBe('[REDACTED]');
  expect(payload.clientRawRequest.headers['x-ratelimit-token']).toBe('[REDACTED]');
  expect(payload.clientRawRequest.headers['x-ratelimit-remaining']).toBe('42');
  expect(payload.providerRequest.headers['X-API-Key']).toBe('[REDACTED]');
  expect(payload.providerRequest.headers['X-Trace']).toBe('trace-value');
  expect(payload.providerResponse.headers['Set-Cookie']).toBe('[REDACTED]');
  expect(payload.providerResponse.headers['x-ratelimit-reset']).toBe('60');
  expect(JSON.stringify(payload)).not.toContain(secret.slice(0, 10));
  expect(JSON.stringify(payload)).not.toContain(secret.slice(-5));
});
