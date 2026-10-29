import { test, expect } from "bun:test";
import dns from "node:dns";
import { createServer } from "node:http";
import { fetch as undiciFetch } from "undici";
import { ensureBase64ImagesForClaudeWire } from "../src/lib/guardrails/visionBridgeHelpers";

test("production undici injection cannot re-resolve an image hostname after validation", async () => {
  const server = createServer((_req, res) => { res.setHeader("content-type", "image/png"); res.end("safe"); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const original = dns.promises.lookup;
  const proxyKeys = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"];
  const proxies = Object.fromEntries(proxyKeys.map((key) => [key, process.env[key]]));
  for (const key of proxyKeys) delete process.env[key];
  let lookups = 0;
  // Only the policy lookup sees this answer; unpinned undici attempts its own
  // real DNS lookup of the deliberately nonexistent hostname.
  dns.promises.lookup = (async () => { lookups++; return [{ address: "127.0.0.1", family: 4 }]; }) as typeof dns.promises.lookup;
  try {
    const url = `http://rebind.invalid:${(server.address() as { port: number }).port}/image`;
    const body = { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url } }] }] };
    const result = await ensureBase64ImagesForClaudeWire(body as any, "anthropic/test", undiciFetch as unknown as typeof fetch);
    expect((result.messages![0].content as any)[0].image_url.url).toBe("data:image/png;base64,c2FmZQ==");
    expect(lookups).toBe(1);
    process.env.HTTP_PROXY = "http://127.0.0.1:9";
    await expect(ensureBase64ImagesForClaudeWire(body as any, "anthropic/test", undiciFetch as unknown as typeof fetch))
      .rejects.toThrow("cannot enforce DNS pinning");
    expect(lookups).toBe(1);
  } finally {
    dns.promises.lookup = original;
    for (const key of proxyKeys) { if (proxies[key] === undefined) delete process.env[key]; else process.env[key] = proxies[key]; }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
