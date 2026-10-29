import { test, expect } from "bun:test";
import { fetchRemoteMedia } from "../src/shared/network/remoteImageFetch";
import { isCloudMetadataHost, isPrivateHost, parseAndValidateNonMetadataUrl } from "../src/shared/network/outboundUrlGuard";

test("IPv6 link-local /10 is blocked without blocking adjacent IPv6 ranges", () => {
  for (const host of ["fe80::1", "febf::1", "[fe90::1]"]) { expect(isCloudMetadataHost(host)).toBe(true); expect(isPrivateHost(host)).toBe(true); }
  expect(isCloudMetadataHost("fd00:0ec2:0:0:0:0:0:0254")).toBe(true);
  expect(() => parseAndValidateNonMetadataUrl("http://[febf::1]/")).toThrow();
  for (const host of ["fe7f::1", "fec0::1", "fe80.example.com"]) expect(isCloudMetadataHost(host)).toBe(false);
});

test("block-metadata rejects a direct metadata URL before fetching", async () => {
  let requested = false;
  const fetchImpl = (async () => { requested = true; return new Response("secret"); }) as typeof fetch;
  await expect(fetchRemoteMedia("http://169.254.169.254/latest/meta-data/", {
    guard: "block-metadata", fetchImpl,
  })).rejects.toThrow();
  expect(requested).toBe(false);
});

test("block-metadata rejects redirects to metadata before the next request", async () => {
  const requested: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    requested.push(String(input));
    return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/" } });
  }) as typeof fetch;
  await expect(fetchRemoteMedia("https://example.com/image", { guard: "block-metadata", fetchImpl })).rejects.toThrow();
  expect(requested).toEqual(["https://example.com/image"]);
});

test("block-metadata permits local provider-style URLs", async () => {
  const fetchImpl = (async () => new Response("ok")) as typeof fetch;
  const result = await fetchRemoteMedia("http://127.0.0.1/image", { guard: "block-metadata", fetchImpl });
  expect(result.buffer.toString()).toBe("ok");
});
