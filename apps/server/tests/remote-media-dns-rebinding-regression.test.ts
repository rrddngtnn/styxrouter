import { test, expect } from "bun:test";
import { createServer } from "node:http";
import { fetchRemoteMedia } from "../src/shared/network/remoteImageFetch";

test("block-metadata rejects DNS answers containing metadata before fetching", async () => {
  let requested = false;
  await expect(fetchRemoteMedia("http://example.test/image", {
    guard: "block-metadata",
    lookup: async () => [{ address: "127.0.0.1", family: 4 }, { address: "169.254.169.254", family: 4 }],
    fetchImpl: (async () => { requested = true; return new Response("secret"); }) as typeof fetch,
  })).rejects.toThrow();
  expect(requested).toBe(false);
});

test("block-metadata pins each hop to its validated DNS address", async () => {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    seen.push(`${req.headers.host}${req.url}`);
    if (req.url === "/start") { res.writeHead(302, { location: "/image" }); res.end(); }
    else { res.writeHead(200, { "content-type": "image/png" }); res.end("image"); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as { port: number }).port;
    let lookups = 0;
    const result = await fetchRemoteMedia(`http://rebind.invalid:${port}/start`, {
      guard: "block-metadata",
      lookup: async () => { lookups++; return [{ address: "127.0.0.1", family: 4 }]; },
    });
    expect(result.buffer.toString()).toBe("image");
    expect(lookups).toBe(2);
    expect(seen).toEqual([`rebind.invalid:${port}/start`, `rebind.invalid:${port}/image`]);
  } finally { await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())); }
});

test("guarded modes reject forbidden or invalid DNS answers before transport", async () => {
  for (const [guard, address, family] of [
    ["public-only", "127.0.0.1", 4],
    ["block-metadata", "0:0:0:0:0:ffff:a9fe:a9fe", 6],
    ["block-metadata", "fd00:ec2:0:0:0:0:0:254", 6],
    ["block-metadata", "not-an-ip", 4],
    ["block-metadata", "127.0.0.1", 6],
  ] as const) {
    let calls = 0;
    await expect(fetchRemoteMedia("http://example.test/", {
      guard, lookup: async () => [{ address, family }],
      fetchImpl: (async () => { calls++; return new Response("bad"); }) as typeof fetch,
    })).rejects.toThrow();
    expect(calls).toBe(0);
  }
});

test("none mode leaves resolution and transport unrestricted", async () => {
  const result = await fetchRemoteMedia("http://example.test/", {
    guard: "none", lookup: async () => { throw new Error("unexpected lookup"); },
    fetchImpl: (async () => new Response("ok")) as typeof fetch,
  });
  expect(result.buffer.toString()).toBe("ok");
});

test("a redirect to a DNS metadata answer is blocked before its request", async () => {
  const calls: string[] = [];
  await expect(fetchRemoteMedia("http://first.test/", {
    guard: "block-metadata",
    lookup: async (host) => [{ address: host === "first.test" ? "127.0.0.1" : "169.254.169.254", family: 4 }],
    fetchImpl: (async (input) => { calls.push(String(input)); return new Response(null, { status: 302, headers: { location: "http://second.test/" } }); }) as typeof fetch,
  })).rejects.toThrow();
  expect(calls).toEqual(["http://first.test/"]);
});
