import { test, expect, spyOn } from "bun:test";
import dns from "node:dns";
import { deliverWebhook } from "../src/lib/webhookDispatcher";
import { parseAndValidatePublicUrl } from "../src/shared/network/outboundUrlGuard";
import { fetchRemoteMedia } from "../src/shared/network/remoteImageFetch";
import * as transport from "../src/shared/network/remoteImageFetch";

const blocked = ["224.0.0.1", "239.255.255.255", "240.0.0.1", "255.255.255.255", "198.18.0.1", "198.19.255.255", "192.0.2.1", "198.51.100.1", "203.0.113.1", "[ff02::1]", "[2001:db8::1]", "[::ffff:224.0.0.1]", "[0:0:0:0:0:ffff:198.18.0.1]"];
const payload = { event: "test.ping" as any, timestamp: "now", data: {} };

test("public-only rejects non-global literal addresses", () => {
  for (const ip of blocked) expect(() => parseAndValidatePublicUrl(`http://${ip}/`), ip).toThrow();
  for (const ip of ["8.8.8.8", "1.1.1.1", "[2606:4700:4700::1111]"]) expect(() => parseAndValidatePublicUrl(`http://${ip}/`), ip).not.toThrow();
});

test("webhook rejects mixed public and non-global DNS answers before connecting", async () => {
  const lookup = spyOn(dns.promises, "lookup");
  const pinned = spyOn(transport, "createPinnedFetch").mockImplementation((() => async () => new Response(null, { status: 200 })) as any);
  try {
    for (const address of ["224.0.0.1", "240.0.0.1", "198.18.0.1", "ff02::1", "::ffff:198.18.0.1", "2001:db8::1"]) {
      lookup.mockImplementation(async () => [{ address: "8.8.8.8", family: 4 }, { address, family: address.includes(":") ? 6 : 4 }] as any);
      expect((await deliverWebhook("https://webhook.example.invalid/", payload, null, 0)).success, address).toBe(false);
      expect(pinned).not.toHaveBeenCalled();
    }
  } finally { lookup.mockRestore(); pinned.mockRestore(); }
});

test("remote media honors guard modes and allows public DNS", async () => {
  let calls = 0;
  const fetchImpl = (async () => { calls++; return new Response("media", { status: 200 }); }) as typeof fetch;
  const lookup = async () => [{ address: "198.18.0.1", family: 4 }];
  await expect(fetchRemoteMedia("https://media.example.invalid/", { guard: "public-only", lookup, fetchImpl })).rejects.toThrow();
  expect(calls).toBe(0);
  expect((await fetchRemoteMedia("https://media.example.invalid/", { guard: "block-metadata", lookup, fetchImpl })).buffer.toString()).toBe("media");
  expect((await fetchRemoteMedia("https://media.example.invalid/", { guard: "public-only", lookup: async () => [{ address: "8.8.8.8", family: 4 }], fetchImpl })).buffer.toString()).toBe("media");
});
