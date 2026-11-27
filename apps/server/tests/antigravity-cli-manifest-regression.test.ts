import { afterEach, expect, test } from "bun:test";
import { clearAntigravityVersionCaches, getCachedAntigravityCliVersion, resolveAntigravityCliVersion, seedAntigravityCliVersionCache } from "../open-sse/services/antigravityVersion.ts";

afterEach(() => clearAntigravityVersionCaches());

test("parses the observed official darwin arm64 manifest and applies its CLI identity", async () => {
  // Captured from the official darwin_arm64 manifest on 2026-11-13; archive metadata is not fetched.
  const observed = {
    version: "1.5.7",
    url: "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.7-6190022064472064/darwin-arm/cli_mac_arm64.tar.gz",
    sha512: "c9746409083a9b15c217757aa2ef399ee7d4398602a30038583ea45196fc27d1662745341e45a116c07be19c08587de1e5929e365d2a46aea385fa33f0c2396a",
  };
  expect(await resolveAntigravityCliVersion((async () => Response.json(observed)) as typeof fetch, true)).toBe("1.5.7");
  const { antigravityCliUserAgent } = await import("../open-sse/services/antigravityHeaders.ts");
  expect(antigravityCliUserAgent()).toBe("antigravity/cli/1.5.7 (aidev_client; os_type=darwin; arch=arm64; auth_method=consumer)");
});
const manifest = (version: unknown) => ({ version, url: "https://example.invalid/archive", sha512: "a".repeat(128) });

test("CLI refresh uses official platform manifest without credentials or redirects", async () => {
  const fake = (async (url, init) => {
    expect(String(url)).toBe("https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/darwin_arm64.json");
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    expect(new Headers(init?.headers).has("cookie")).toBe(false);
    return Response.json(manifest("1.9.2"));
  }) as typeof fetch;
  expect(await resolveAntigravityCliVersion(fake, true)).toBe("1.9.2");
});

test("invalid and failed manifests retain the last good version", async () => {
  seedAntigravityCliVersionCache("2.0.0");
  for (const response of [Response.json(manifest("2.1.0-evil")), Response.json({tag_name:"3.0.0"}), new Response("", {status:302, headers:{location:"https://evil.invalid"}}), new Response("bad", {status:503}), new Response("not json")]) {
    await expect(resolveAntigravityCliVersion((async () => response) as typeof fetch, true)).rejects.toThrow();
    expect(getCachedAntigravityCliVersion()).toBe("2.0.0");
  }
});

test("stale manifest cannot downgrade the last good version", async () => {
  seedAntigravityCliVersionCache("2.0.0");
  expect(await resolveAntigravityCliVersion((async () => Response.json(manifest("1.9.0"))) as typeof fetch, true)).toBe("2.0.0");
});

test("oversized manifest is rejected without replacing the cache", async () => {
  seedAntigravityCliVersionCache("2.0.0");
  const body = JSON.stringify({ ...manifest("3.0.0"), padding: "x".repeat(17000) });
  await expect(resolveAntigravityCliVersion((async () => new Response(body)) as typeof fetch, true)).rejects.toThrow();
  expect(getCachedAntigravityCliVersion()).toBe("2.0.0");
});
