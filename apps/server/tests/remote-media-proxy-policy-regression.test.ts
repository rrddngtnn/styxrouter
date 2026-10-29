import { test, expect } from "bun:test";
import { createServer } from "node:http";
import { fetchRemoteMedia, createPinnedFetch } from "../src/shared/network/remoteImageFetch";
import { runWithProxyContext } from "../open-sse/utils/proxyFetch";

const keys = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy", "NO_PROXY", "no_proxy"];

test("protocol, NO_PROXY, redirects, and direct pinned entry point respect effective routing", async () => {
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  let requests = 0;
  const server = createServer((req, res) => { requests++; if (req.url === "/redirect") { res.writeHead(302, { location: `http://other.invalid:${(server.address() as any).port}/` }); res.end(); } else res.end("ok"); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://media.invalid:${(server.address() as any).port}`;
  const options = { guard: "block-metadata" as const, lookup: async () => [{ address: "127.0.0.1", family: 4 }] };
  try {
    process.env.HTTPS_PROXY = "http://127.0.0.1:9";
    expect((await fetchRemoteMedia(url, options)).buffer.toString()).toBe("ok");
    process.env.HTTP_PROXY = "http://127.0.0.1:9";
    await expect(fetchRemoteMedia(url, options)).rejects.toThrow("cannot enforce DNS pinning");
    await expect(createPinnedFetch("127.0.0.1", 4)(url)).rejects.toThrow("cannot enforce DNS pinning");
    process.env.NO_PROXY = `media.invalid:${(server.address() as any).port}`;
    expect((await fetchRemoteMedia(url, options)).buffer.toString()).toBe("ok");
    await expect(fetchRemoteMedia(`${url}/redirect`, options)).rejects.toThrow("cannot enforce DNS pinning");
    expect(requests).toBe(3);
    delete process.env.HTTP_PROXY; delete process.env.HTTPS_PROXY; delete process.env.NO_PROXY;
    await expect(runWithProxyContext({ protocol: "http", host: "127.0.0.1", port: 9 }, () => fetchRemoteMedia(url, options))).rejects.toThrow("cannot enforce DNS pinning");
  } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
