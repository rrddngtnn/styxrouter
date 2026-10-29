import { expect, spyOn, test } from "bun:test";
import dns from "node:dns";
import http from "node:http";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { deliverWebhook } from "../src/lib/webhookDispatcher";

const payload = { event: "test.ping" as any, timestamp: "now", data: {} };

test("encoded literals, transition networks and malformed URLs are rejected before DNS or socket", async () => {
  const lookup = spyOn(dns.promises, "lookup");
  const request = spyOn(http, "request");
  try {
    for (const url of ["http://2130706433/", "http://0x7f000001/", "http://0177.0.0.1/", "http://127%2e0%2e0%2e1/", "http://[::ffff:127.0.0.1]/", "http://[0:0:0:0:0:ffff:a9fe:a9fe]/", "http://[64:ff9b::a00:1]/", "http://[2002:a00:1::1]/", "http://[2001:0000::1]/", "http://[::gg]/", "http://999.999.999.999/"]) {
      expect((await deliverWebhook(url, payload, null, 0)).success, url).toBe(false);
    }
    expect(lookup).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  } finally { lookup.mockRestore(); request.mockRestore(); }
});

test("mixed, mapped, transition, malformed or mismatched DNS answers fail before socket", async () => {
  const lookup = spyOn(dns.promises, "lookup");
  const request = spyOn(http, "request");
  try {
    for (const [address, family] of [["127.0.0.1", 4], ["::ffff:7f00:1", 6], ["64:ff9b::a00:1", 6], ["2002:a00:1::1", 6], ["bad", 4], ["8.8.8.8", 6]] as const) {
      lookup.mockImplementation(async () => [{address: "8.8.8.8", family: 4}, {address, family}] as any);
      expect(await deliverWebhook("http://rebind.invalid/", payload, null, 0), address).toMatchObject({success: false, status: 0});
      expect(request).not.toHaveBeenCalled();
    }
  } finally { lookup.mockRestore(); request.mockRestore(); }
});

test("actual pinned request supplies validated address to both lookup callback shapes; socket errors fail closed", async () => {
  const old = process.env.NO_PROXY;
  const oldLower = process.env.no_proxy;
  process.env.NO_PROXY = process.env.no_proxy = "*";
  let lookups = 0;
  const dnsLookup = spyOn(dns.promises, "lookup").mockImplementation(async () => { lookups++; return [{ address: "8.8.8.8", family: 4 }] as any; });
  let captured: any;
  const request = spyOn(http, "request").mockImplementation(((url: URL, options: any, responseCallback: any) => {
    captured = { url: url.toString(), options };
    options.lookup("rebind.invalid", { all: true }, (_err: any, addresses: any) => expect(addresses).toEqual([{address: "8.8.8.8", family: 4}]));
    options.lookup("rebind.invalid", {}, (_err: any, address: any, family: any) => { expect(address).toBe("8.8.8.8"); expect(family).toBe(4); });
    const req = new EventEmitter() as any;
    req.end = () => { const res = new PassThrough() as any; res.statusCode = 204; res.rawHeaders = []; responseCallback(res); res.end(); };
    return req;
  }) as any);
  try {
    expect(await deliverWebhook("http://rebind.invalid/path", payload, "secret", 0)).toEqual({success: true, status: 204});
    expect(lookups).toBe(1);
    expect(captured.url).toBe("http://rebind.invalid/path");
    expect(captured.options.method).toBe("POST");
    expect(request).toHaveBeenCalledTimes(1);
    request.mockImplementation((() => { const req = new EventEmitter() as any; req.end = () => queueMicrotask(() => req.emit("error", new Error("socket failed"))); return req; }) as any);
    expect(await deliverWebhook("http://rebind.invalid/path", payload, null, 0)).toMatchObject({success: false, status: 0, error: "Webhook delivery failed"});
  } finally {
    request.mockRestore(); dnsLookup.mockRestore();
    if (old === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = old;
    if (oldLower === undefined) delete process.env.no_proxy; else process.env.no_proxy = oldLower;
  }
});
