import { test, expect, spyOn } from "bun:test";
import dns from "node:dns";
import { deliverWebhook } from "../src/lib/webhookDispatcher";
import * as transport from "../src/shared/network/remoteImageFetch";
import crypto from "node:crypto";

test("webhook rejects DNS answers containing private addresses even with private provider override", async () => {
  const old = process.env.STYX_ALLOW_PRIVATE_PROVIDER_URLS;
  process.env.STYX_ALLOW_PRIVATE_PROVIDER_URLS = "true";
  const lookup = spyOn(dns.promises, "lookup").mockImplementation(async () => [{ address: "127.0.0.1", family: 4 }] as any);
  try {
    const result = await deliverWebhook("http://webhook.example.invalid/secret", { event: "test.ping" as any, timestamp: "now", data: {} }, "secret", 0);
    expect(result.success).toBe(false);
    expect(result.status).toBe(0);
    expect(lookup).toHaveBeenCalled();
  } finally {
    lookup.mockRestore();
    if (old === undefined) delete process.env.STYX_ALLOW_PRIVATE_PROVIDER_URLS; else process.env.STYX_ALLOW_PRIVATE_PROVIDER_URLS = old;
  }
});

test("webhook blocks metadata hostname before DNS or request", async () => {
  const lookup = spyOn(dns.promises, "lookup").mockImplementation(async () => [{ address: "8.8.8.8", family: 4 }] as any);
  const pinned = spyOn(transport, "createPinnedFetch").mockImplementation((() => async () => new Response(null, { status: 200 })) as any);
  try {
    const result = await deliverWebhook("http://metadata.goog/", { event: "test.ping" as any, timestamp: "now", data: {} }, "secret", 0);
    expect(result.success).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
    expect(pinned).not.toHaveBeenCalled();
  } finally { lookup.mockRestore(); pinned.mockRestore(); }
});

test("webhook blocks Alibaba metadata IP before making a request", async () => {
  const pinned = spyOn(transport, "createPinnedFetch");
  try {
    const result = await deliverWebhook("http://100.100.100.200/latest/meta-data/", { event: "test.ping" as any, timestamp: "now", data: {} }, "secret", 0);
    expect(result.status).toBe(0);
    expect(pinned).not.toHaveBeenCalled();
  } finally { pinned.mockRestore(); }
});

test("invalid destination failures do not expose destination secrets", async () => {
  const result = await deliverWebhook("bad-secret-url", { event: "test.ping" as any, timestamp: "now", data: {} }, "secret", 0);
  expect(result.error).not.toContain("bad-secret-url");
});

test("signed delivery uses validated pinned address and rejects redirects", async () => {
  const lookup = spyOn(dns.promises, "lookup").mockImplementation(async () => [{ address: "8.8.8.8", family: 4 }] as any);
  let captured: RequestInit | undefined;
  const pinned = spyOn(transport, "createPinnedFetch").mockImplementation(((address: string, family: number) => {
    expect(address).toBe("8.8.8.8"); expect(family).toBe(4);
    return async (_url: string, init: RequestInit) => { captured = init; return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/" } }); };
  }) as any);
  try {
    const result = await deliverWebhook("https://webhook.example.invalid/path", { event: "test.ping" as any, timestamp: "now", data: { x: 1 } }, "secret", 0);
    expect(result).toEqual({ success: false, status: 302 });
    expect(captured?.redirect).toBe("manual");
    const body = captured?.body as string;
    expect((captured?.headers as Record<string, string>)["X-Webhook-Signature"]).toBe(`sha256=${crypto.createHmac("sha256", "secret").update(body).digest("hex")}`);
    expect(pinned).toHaveBeenCalledTimes(1);
  } finally { pinned.mockRestore(); lookup.mockRestore(); }
});
