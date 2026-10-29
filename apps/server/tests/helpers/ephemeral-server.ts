// Test-only entry point: bind the server itself to an OS-assigned loopback port.
export {};
process.env.PORT = "0";
const { default: config } = await import("../../server/styx.ts");
const bun = (globalThis as typeof globalThis & { Bun: { serve(options: typeof config & { hostname: string; port: number }): { port: number } } }).Bun;
const server = bun.serve({ ...config, hostname: "127.0.0.1", port: 0 });
console.log(`STYX_TEST_LISTENING:${server.port}`);
