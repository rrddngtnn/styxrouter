import { test, expect } from "bun:test";
import { clearAntigravityVersionCaches, resolveAntigravityIdeVersion, seedAntigravityIdeVersionCache } from "../open-sse/services/antigravityVersion";
test("IDE discovery follows official IDE feed rather than obsolete legacy feed", async () => {
 clearAntigravityVersionCaches();
 const urls: string[] = [];
 const mock = (async (url: string) => { urls.push(url); return Response.json([{version: url.includes("antigravity-ide-auto-updater") ? "2.6.0" : "2.0.0"}]); }) as typeof fetch;
 expect(await resolveAntigravityIdeVersion(mock)).toBe("2.6.0");
 expect(urls).toEqual(["https://antigravity-ide-auto-updater-974169037036.us-central1.run.app/releases"]);
});
test("failure preserves last-good IDE version", async () => {
 clearAntigravityVersionCaches(); seedAntigravityIdeVersionCache("2.6.0",0);
 expect(await resolveAntigravityIdeVersion((async () => {throw Error("offline")}) as typeof fetch)).toBe("2.6.0");
});
test("malformed or older feed cannot downgrade last-good IDE version", async () => {
 clearAntigravityVersionCaches(); seedAntigravityIdeVersionCache("2.6.0",0);
 expect(await resolveAntigravityIdeVersion((async () => Response.json([{version:"2.0.0"}, {version:null}])) as typeof fetch)).toBe("2.6.0");
});
