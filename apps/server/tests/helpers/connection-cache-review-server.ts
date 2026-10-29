// Test-only HTTP probe layered on the actual Styx server.
export {};
process.env.PORT = '0';
const { default: config } = await import('../../server/styx');
declare const Bun: { serve(options: typeof config & { hostname: string; port: number }): { port: number } };
const { getCachedRawProviderConnections } = await import('../../src/lib/db/readCache');
const original = config.fetch;
const server = Bun.serve({ ...config, hostname:'127.0.0.1', port:0, async fetch(request, server) {
 if (new URL(request.url).pathname === '/__test/cache') return Response.json(await getCachedRawProviderConnections({provider:'openai'}));
 return original(request, server);
}});
console.log(`STYX_TEST_LISTENING:${server.port}`);
