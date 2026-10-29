import { expect, test } from "bun:test";
process.env.STORAGE_ENCRYPTION_KEY = "synthetic-review-key-one";
process.env.STYX_TEST_MODE = "1";
const { prepareTokenImport, saveTokenImport } = await import("../server/tokenImport.ts");
const { getProviderConnections } = await import("../src/lib/db/providers.ts");
const prep = (account: unknown) => prepareTokenImport({ provider: "codebuddy-cn", accounts: account })!;

test("provider and host evidence must bind to each access token by ancestry", () => {
  for (const account of [
    { credentials: { provider: "openai" }, auth: { token: "synthetic-token" } },
    { credentials: { url: "https://api.openai.com" }, auth: { token: "synthetic-token" } },
    { credentials: { provider: "unknown" }, auth: { token: "synthetic-token" } },
  ]) expect(prep(account)[0].view.valid).toBe(false);
  expect(prep({ provider: "openai", auth: { token: "synthetic-token" } })[0].view).toMatchObject({ valid: true, provider: "openai" });
});

test("expiry considers all absolute fields and JWT exp conservatively", () => {
  const jwt = `e30.${Buffer.from(JSON.stringify({ exp: 1 })).toString("base64url")}.sig`;
  expect(prep({ token: jwt, expires_at: 2000000000 })[0].view.expiresAt).toBe(new Date(1000).toISOString());
  expect(prep({ token: "synthetic-token", expires_at: 2000000000, auth: { expires_at: 1 } })[0].view.expiresAt).toBe(new Date(1000).toISOString());
  expect(prep({ token: "synthetic-token", expires_at: 2000000000, auth: { expires_at: "invalid" } })[0].view.valid).toBe(false);
});

test("unanchored relative expiry cannot be extended by a delayed save", () => {
  const original = Date.now;
  try {
    Date.now = () => 1000000;
    const account = { token: "synthetic-token", expires_in: 3600 };
    expect(prep(account)[0].view.valid).toBe(false);
    Date.now = () => 8200000;
    expect(prep(account)[0].view.valid).toBe(false);
  } finally { Date.now = original; }
});

test("cached key replacement fails closed without writing", async () => {
  const first = await saveTokenImport(prep({ token: "synthetic-initial" }), () => {});
  expect(first[0].valid).toBe(true);
  const before = (await getProviderConnections({ provider: "codebuddy-cn" })).length;
  process.env.STORAGE_ENCRYPTION_KEY = "synthetic-review-key-two";
  try {
    expect((await saveTokenImport(prep({ token: "synthetic-next" }), () => {}))[0].valid).toBe(false);
    expect((await getProviderConnections({ provider: "codebuddy-cn" })).length).toBe(before);
    delete process.env.STORAGE_ENCRYPTION_KEY;
    expect((await saveTokenImport(prep({ token: "synthetic-next" }), () => {}))[0].valid).toBe(false);
    expect((await getProviderConnections({ provider: "codebuddy-cn" })).length).toBe(before);
  } finally { process.env.STORAGE_ENCRYPTION_KEY = "synthetic-review-key-one"; }
});
