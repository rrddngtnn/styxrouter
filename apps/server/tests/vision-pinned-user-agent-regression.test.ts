import { expect, test } from "bun:test";
import { createServer } from "node:http";
import { ensureBase64ImagesForClaudeWire } from "../src/lib/guardrails/visionBridgeHelpers";

const proxyKeys = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"];

test("guarded vision image downloads send the bridge User-Agent on every redirect", async () => {
  const saved = Object.fromEntries(proxyKeys.map(key => [key, process.env[key]]));
  for (const key of proxyKeys) delete process.env[key];
  const agents: (string | undefined)[] = [];
  const server = createServer((req, res) => {
    agents.push(req.headers["user-agent"]);
    if (!req.headers["user-agent"]) { res.writeHead(400); res.end(); return; }
    if (req.url === "/start") { res.writeHead(302, { location: "/image" }); res.end(); return; }
    res.writeHead(200, { "content-type": "image/png" }); res.end("safe");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/start`;
    const body = { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url } }] }] };
    const result = await ensureBase64ImagesForClaudeWire(body as any, "anthropic/test");
    expect((result.messages![0].content as any)[0].image_url.url).toBe("data:image/png;base64,c2FmZQ==");
    expect(agents).toEqual(["styx-vision-bridge", "styx-vision-bridge"]);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const key of proxyKeys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  }
});
