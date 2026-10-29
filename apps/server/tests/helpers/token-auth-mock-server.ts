// Isolated test entry: route only the synthetic provider endpoint to a local mock.
export {};
const originalFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname === "copilot.tencent.com") {
    return originalFetch(`http://127.0.0.1:${process.env.MOCK_UPSTREAM_PORT}${url.pathname}`, init);
  }
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return originalFetch(input, init);
  throw new Error(`Unexpected external network request: ${url.hostname}`);
}) as typeof fetch;
process.env.PORT = "0";
const { default: config } = await import("../../server/styx.ts");
declare const Bun: { serve(options: typeof config & { hostname: string; port: number }): { port: number } };
const server = Bun.serve({ ...config, hostname: "127.0.0.1", port: 0 });
console.log(`STYX_TEST_LISTENING:${server.port}`);
