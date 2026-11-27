import './helpers/test-secrets';
import { test, expect } from 'bun:test';
import { OpencodeExecutor } from '../open-sse/executors/opencode';

test('empty, malformed and whitespace credentials reject locally; usable extras rotate without a preflight pick', async () => {
  const original = globalThis.fetch;
  const seen: Headers[] = [];
  globalThis.fetch = (async (_url, init) => { seen.push(new Headers(init?.headers)); return Response.json({error:{message:'fixture denied'}},{status:403}); }) as typeof fetch;
  try {
    for (const extraApiKeys of [undefined, [], [''], ['   '], null, {}, 'not-an-array', [null, 1, false]]) {
      for (const apiKey of [undefined, '', '   ']) {
        const result = await new OpencodeExecutor('opencode-go').execute({model:'big-pickle',body:{messages:[]},credentials:{apiKey,accessToken:' ',providerSpecificData:{extraApiKeys}},stream:false,skipUpstreamRetry:true});
        expect(result.response.status).toBe(402);
        expect(seen).toHaveLength(0);
      }
    }
    const credentials = {connectionId:'review-extras-only',apiKey:'   ',accessToken:' ',providerSpecificData:{extraApiKeys:['', ' extra-a ', null, 'extra-b', '  ']}};
    const executor = new OpencodeExecutor('opencode-go');
    for (let i=0;i<4;i++) {
      const result=await executor.execute({model:'big-pickle',body:{messages:[]},credentials:{...credentials,providerSpecificData:{...credentials.providerSpecificData}},stream:false,skipUpstreamRetry:true});
      expect(result.response.status).toBe(403);
    }
    expect(seen.map(h=>h.get('authorization'))).toEqual(['Bearer extra-a','Bearer extra-b','Bearer extra-a','Bearer extra-b']);
    expect(seen.every(h=>h.get('user-agent')==='StyxRouter/1.0' && !h.has('x-opencode-client'))).toBe(true);
    expect(credentials.apiKey).toBe('   ');
  } finally {globalThis.fetch=original;}
});
