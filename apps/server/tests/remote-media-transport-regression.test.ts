import { test, expect } from "bun:test";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { createServer as createHttpsServer } from "node:https";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fetchRemoteMedia } from "../src/shared/network/remoteImageFetch";

test("DNS resolution obeys the request timeout", async () => {
  const start = Date.now();
  await expect(fetchRemoteMedia("http://slow.invalid/", {
    guard: "block-metadata", timeoutMs: 40,
    lookup: () => new Promise(() => {}),
  })).rejects.toThrow();
  expect(Date.now() - start).toBeLessThan(1000);
}, 1500);

test("TLS rejects an untrusted certificate", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tls-regression-"));
  const key = join(dir, "key.pem"), cert = join(dir, "cert.pem");
  const generated = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=example.invalid"], { stdio: "ignore" });
  expect(generated.status).toBe(0);
  const credentials = { key: readFileSync(key), cert: readFileSync(cert) };
  const server = createHttpsServer(credentials, (_req, res) => res.end("unsafe"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as { port: number }).port;
    await expect(fetchRemoteMedia(`https://example.invalid:${port}/`, { guard: "block-metadata", lookup: async () => [{ address: "127.0.0.1", family: 4 }] })).rejects.toThrow(/self.signed/i);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fallback connects only to another validated address", async () => {
  const server = createServer((_req, res) => res.end("fallback"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const result = await fetchRemoteMedia(`http://example.invalid:${port}/`, {
      guard: "block-metadata", timeoutMs: 1000,
      lookup: async () => [{ address: "127.0.0.2", family: 4 }, { address: "127.0.0.1", family: 4 }],
    });
    expect(result.buffer.toString()).toBe("fallback");
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test("guarded pinned requests fail closed when an HTTP proxy applies", async () => {
  let proxyRequests = 0;
  const proxy = createServer((_req, res) => { proxyRequests++; res.end("proxy"); });
  const origin = createServer((_req, res) => res.end("origin"));
  await Promise.all([proxy, origin].map((server) => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))));
  const previous = process.env.HTTP_PROXY;
  const previousLower = process.env.http_proxy;
  process.env.HTTP_PROXY = process.env.http_proxy = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`;
  try {
    await expect(fetchRemoteMedia(`http://example.invalid:${(origin.address() as { port: number }).port}/`, {
      guard: "block-metadata", lookup: async () => [{ address: "127.0.0.1", family: 4 }],
    })).rejects.toThrow("cannot enforce DNS pinning");
    expect(proxyRequests).toBe(0);
  } finally {
    if (previous === undefined) delete process.env.HTTP_PROXY; else process.env.HTTP_PROXY = previous;
    if (previousLower === undefined) delete process.env.http_proxy; else process.env.http_proxy = previousLower;
    await Promise.all([proxy, origin].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  }
});

test("compressed bodies are decoded and decoded size is limited", async () => {
  const server = createServer((_req, res) => { res.writeHead(200, { "content-encoding": "gzip" }); res.end(gzipSync("a".repeat(500))); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const options = { guard: "block-metadata" as const, lookup: async () => [{ address: "127.0.0.1", family: 4 }] };
  try {
    const result = await fetchRemoteMedia(`http://example.invalid:${port}/`, options);
    expect(result.buffer.toString()).toBe("a".repeat(500));
    await expect(fetchRemoteMedia(`http://example.invalid:${port}/`, { ...options, maxBytes: 100 })).rejects.toThrow("byte limit");
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
