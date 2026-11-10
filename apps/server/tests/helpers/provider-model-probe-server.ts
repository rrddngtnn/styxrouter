// Test-only upstream interceptor, installed before importing the real Hono server.
export {};
const original = globalThis.fetch;
if (process.env.PANEL_FIXTURE_ORIGIN && !/^http:\/\/127\.0\.0\.1:\d+(?:\/panel\/)?$/.test(process.env.PANEL_FIXTURE_ORIGIN)) throw new Error('Invalid fixture origin');
globalThis.fetch = (async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith('https://probe-fixture.invalid/')) {
    if (/^http:\/\/127\.0\.0\.1:\d+\//.test(url)) return original(input, { ...init, redirect: 'error' });
    throw new Error('Fixture forbids external upstream traffic');
  }
  const headers = new Headers(init?.headers);
  const body = JSON.parse(String(init?.body));
  if (headers.get('authorization') !== 'Bearer upstream-fixture-secret' || !['vendor/model','vendor/fail'].includes(body.model)) return Response.json({error:{message:'PROBE_ERROR_SENTINEL_9467 wrong upstream authentication or model'}},{status:500});
  if (body.model === 'vendor/fail') return Response.json({error:{message:'PROBE_ERROR_SENTINEL_9467',code:'model_not_found'}},{status:404});
  return Response.json({id:'fixture',object:'chat.completion',model:body.model,choices:[{index:0,message:{role:'assistant',content:'PROBE_SUCCESS_SENTINEL_9467'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});
}) as typeof fetch;
process.env.PORT = '0';
const {default: config} = await import('../../server/styx.ts');
const bunRuntime = globalThis as typeof globalThis & { Bun: { serve(options: typeof config & { hostname: string; port: number }): { port: number } } };
const server = bunRuntime.Bun.serve({...config, hostname:'127.0.0.1', port:0, ...(process.env.PANEL_FIXTURE_ORIGIN ? {fetch(request: Request) {
 const url=new URL(request.url);
 if (url.pathname.startsWith('/panel/')) return original(new URL(url.pathname+url.search,process.env.PANEL_FIXTURE_ORIGIN),{redirect:'error'});
 return config.fetch(request);
 }} : {})});
console.log(`STYX_TEST_LISTENING:${server.port}`);
