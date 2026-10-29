// Test-only upstream interceptor, installed before importing the real Hono server.
export {};
const original = globalThis.fetch;
globalThis.fetch = (async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith('https://probe-fixture.invalid/')) return original(input, init);
  const headers = new Headers(init?.headers);
  const body = JSON.parse(String(init?.body));
  if (headers.get('authorization') !== 'Bearer upstream-fixture-secret' || body.model !== 'vendor/model') return Response.json({error:{message:'wrong upstream authentication or model'}},{status:400});
  return Response.json({id:'fixture',object:'chat.completion',model:body.model,choices:[{index:0,message:{role:'assistant',content:'OK'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});
}) as typeof fetch;
process.env.PORT = '0';
const {default: config} = await import('../../server/styx.ts');
const bunRuntime = globalThis as typeof globalThis & { Bun: { serve(options: typeof config & { hostname: string; port: number }): { port: number } } };
const server = bunRuntime.Bun.serve({...config, hostname:'127.0.0.1', port:0});
console.log(`STYX_TEST_LISTENING:${server.port}`);
