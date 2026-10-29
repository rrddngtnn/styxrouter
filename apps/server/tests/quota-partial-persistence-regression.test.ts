import { expect, test } from "bun:test";

const { createProviderConnection } = await import("../src/lib/db/providers");
const { setProviderLimitsCache, getProviderLimitsCache } = await import("../src/lib/db/providerLimits");
const { GET: refresh } = await import("../src/app/api/usage/[connectionId]/route");
const { GET: cached } = await import("../src/app/api/usage/provider-limits/route");
const { GET: quota } = await import("../src/app/api/usage/quota/route");
const { POST: syncAll } = await import("../src/app/api/usage/provider-limits/route");

 test("partial live quota persists real old windows with their own observation timestamps", async () => {
  const connection = await createProviderConnection({ provider: "codex", name: "partial", authType: "oauth", accessToken: "test-token", isActive: true });
  const old = "2025-01-01T00:00:00.000Z";
  setProviderLimitsCache(connection.id, { quotas: { session: { used: 20, total: 100, remaining: 80 }, weekly: { used: 40, total: 100, remaining: 60 } }, plan: "plus", message: null, fetchedAt: old });
  const original = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ plan_type: "plus", rate_limit: { primary_window: { used_percent: 30, limit_window_seconds: 18000 } } })) as typeof fetch;
  try {
    const live = await (await refresh(new Request("http://localhost"), { params: Promise.resolve({ connectionId: connection.id }) })).json() as any;
    expect(live.quotas.session.used).toBe(30);
    expect(live.quotas.weekly).toBeUndefined();
    const snapshot = (await (await cached()).json() as any).caches[connection.id];
    expect(snapshot.quotas.weekly.remaining).toBe(60);
    expect(snapshot.windowFetchedAt.weekly).toBe(old);
    expect(snapshot.windowFetchedAt.session).toBe(snapshot.fetchedAt);
    expect(getProviderLimitsCache(connection.id)?.windowFetchedAt?.weekly).toBe(old);
    const row = (await (await quota(new Request(`http://localhost/api/usage/quota?connectionId=${connection.id}`))).json() as any).providers[0];
    expect(row.windows.find((w: any) => w.key === "weekly")).toMatchObject({ remaining: 60, fetchedAt: old, stale: true });
    expect(row.windows.find((w: any) => w.key === "session")).toMatchObject({ used: 30, fetchedAt: snapshot.fetchedAt, stale: false });
  } finally { globalThis.fetch = original; }
});

test("bulk provider errors are persisted without making old windows fresh", async () => {
  process.env.PROVIDER_LIMITS_SYNC_SPACING_MS = "0";
  const connection = await createProviderConnection({ provider: "codex", name: "failure", authType: "oauth", accessToken: "test-token", isActive: true });
  const old = "2025-01-01T00:00:00.000Z";
  setProviderLimitsCache(connection.id, { quotas: { weekly: { used: 40, total: 100, remaining: 60 } }, plan: "plus", message: null, fetchedAt: old });
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response("down", { status: 429 })) as typeof fetch;
  try {
    const result = await (await syncAll()).json() as any;
    expect(result.errors[connection.id]).toContain("429");
    expect(result.failed).toBe(result.total);
    const snapshot = (await (await cached()).json() as any).caches[connection.id];
    expect(snapshot.message).toContain("429");
    expect(snapshot.fetchedAt).toBe(old);
    const row = (await (await quota(new Request(`http://localhost/api/usage/quota?connectionId=${connection.id}`))).json() as any).providers[0];
    expect(row.message).toContain("429");
    expect(row.windows[0]).toMatchObject({ remaining: 60, fetchedAt: old, stale: true });
    const live = await (await refresh(new Request("http://localhost"), { params: Promise.resolve({ connectionId: connection.id }) })).json() as any;
    expect(live._stale).toBe(true);
    expect(live._staleReason).toContain("429");
    expect((await (await cached()).json() as any).caches[connection.id].message).toContain("429");
  } finally { globalThis.fetch = original; }
});

test("partial response warnings do not mark newly observed windows stale", async () => {
  const { mergeProviderLimitsCacheEntry, toProviderLimitsCacheEntry } = await import("../src/lib/usage/providerLimitsCache");
  const old = { quotas: { session: { remaining: 10 }, weekly: { remaining: 20 } }, plan: null, message: null, fetchedAt: "2025-01-01T00:00:00.000Z" };
  const next = mergeProviderLimitsCacheEntry("codex", toProviderLimitsCacheEntry({ quotas: { session: { remaining: 50 } }, message: "weekly unavailable" }, "manual", "2025-01-02T00:00:00.000Z"), old);
  const connection = await createProviderConnection({ provider: "codex", name: "partial-warning", authType: "oauth", accessToken: "token", isActive: true });
  setProviderLimitsCache(connection.id, next);
  const row = (await (await quota(new Request(`http://localhost/api/usage/quota?connectionId=${connection.id}`))).json() as any).providers[0];
  expect(row.message).toBe("weekly unavailable");
  expect(row.windows.find((w: any) => w.key === "session")).toMatchObject({ stale: false, remaining: 50 });
  expect(row.windows.find((w: any) => w.key === "weekly")).toMatchObject({ stale: true, remaining: 20 });
});

test("equal timestamp partial responses never make omitted windows appear fresh", async () => {
  const { mergeProviderLimitsCacheEntry, toProviderLimitsCacheEntry } = await import("../src/lib/usage/providerLimitsCache");
  const at = "2025-01-01T00:00:00.000Z";
  const previous = { quotas: { session: { remaining: 10 }, weekly: { remaining: 20 } }, plan: null, message: null, fetchedAt: at };
  const next = mergeProviderLimitsCacheEntry("codex", toProviderLimitsCacheEntry({ quotas: { session: { remaining: 50 } } }, "manual", at), previous);
  const connection = await createProviderConnection({ provider: "codex", name: "same-clock", authType: "oauth", accessToken: "token", isActive: true });
  setProviderLimitsCache(connection.id, next);
  const row = (await (await quota(new Request(`http://localhost/api/usage/quota?connectionId=${connection.id}`))).json() as any).providers[0];
  expect(row.windows.find((w: any) => w.key === "session").stale).toBe(false);
  expect(row.windows.find((w: any) => w.key === "weekly").stale).toBe(true);
});

test("invalid or null quota windows cannot replace real observations or make them fresh", async () => {
  const { mergeProviderLimitsCacheEntry, toProviderLimitsCacheEntry } = await import("../src/lib/usage/providerLimitsCache");
  const old = "2025-01-01T00:00:00.000Z";
  const next = mergeProviderLimitsCacheEntry("codex", toProviderLimitsCacheEntry({ quotas: { session: null, weekly: { remaining: 50 } } }, "manual", "2025-01-02T00:00:00.000Z"), { quotas: { session: { remaining: 10 } }, plan: null, message: null, fetchedAt: old });
  expect(next.quotas!.session).toEqual({ remaining: 10 });
  expect(next.windowFetchedAt!.session).toBe(old);
  expect(next.staleWindows).toContain("session");
});

test("thrown bulk errors persist warning for the existing snapshot", async () => {
  const connection = await createProviderConnection({ provider: "codex", name: "throws", authType: "oauth", accessToken: "token", isActive: true });
  setProviderLimitsCache(connection.id, { quotas: { session: { remaining: 20, total: 100 } }, plan: null, message: null, fetchedAt: "2025-01-01T00:00:00.000Z" });
  const { spyOn } = await import("bun:test");
  const lease = await import("../src/lib/exclusiveLeaseIsolation");
  // Failure occurs before network fetch; unrelated connections remain untouched.
  const spy = spyOn(lease, "isConnectionUnavailableToAuxiliaryActivity");
  let calls = 0;
  let throwAfter = 0;
  spy.mockImplementation(async (id: string) => { if (id === connection.id && ++calls > throwAfter) throw new Error("lease lookup failed"); return false; });
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response("down", { status: 429 })) as typeof fetch;
  try {
    const direct = await refresh(new Request("http://localhost"), { params: Promise.resolve({ connectionId: connection.id }) });
    expect(direct.status).toBe(500);
    expect((await (await cached()).json() as any).caches[connection.id].message).toContain("lease lookup failed");
    calls = 0;
    throwAfter = 1;
    const result = await (await syncAll()).json() as any;
    expect(result.errors[connection.id]).toContain("lease lookup failed");
    const snapshot = (await (await cached()).json() as any).caches[connection.id];
    expect(snapshot.message).toContain("lease lookup failed");
    expect(snapshot.fetchedAt).toBe("2025-01-01T00:00:00.000Z");
  } finally { spy.mockRestore(); globalThis.fetch = original; }
});


test("an older failed refresh cannot mark a concurrent successful refresh stale", async () => {
  const { spyOn } = await import("bun:test");
  const lease = await import("../src/lib/exclusiveLeaseIsolation");
  const connection = await createProviderConnection({ provider: "codex", name: "failure-race", authType: "oauth", accessToken: "token", isActive: true });
  setProviderLimitsCache(connection.id, { quotas: { session: { remaining: 20 } }, plan: null, message: null, fetchedAt: "2025-01-01T00:00:00.000Z" });
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const spy = spyOn(lease, "isConnectionUnavailableToAuxiliaryActivity").mockImplementation(async id => {
    if (id === connection.id) { entered(); await barrier; throw new Error("older failure"); }
    return false;
  });
  try {
    const pending = refresh(new Request("http://localhost"), { params: Promise.resolve({ connectionId: connection.id }) });
    await started;
    setProviderLimitsCache(connection.id, { quotas: { session: { remaining: 80 } }, plan: null, message: null, fetchedAt: "2025-01-02T00:00:00.000Z" });
    release();
    expect((await pending).status).toBe(500);
    const snapshot = getProviderLimitsCache(connection.id)!;
    expect(snapshot.refreshFailed).not.toBe(true);
    expect(snapshot.message).toBeNull();
    expect(snapshot.fetchedAt).toBe("2025-01-02T00:00:00.000Z");
  } finally { release(); spy.mockRestore(); }
});

test("a slower older refresh cannot overwrite a newer refresh of the same window", async () => {
  const connection = await createProviderConnection({ provider: "codex", name: "overlap", authType: "oauth", accessToken: "overlap-token", isActive: true });
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    const n = ++calls;
    if (n === 1) { entered(); await barrier; }
    return Response.json({ plan_type: "plus", rate_limit: { primary_window: { used_percent: n === 1 ? 10 : 90, limit_window_seconds: 18000 } } });
  }) as typeof fetch;
  try {
    const first = refresh(new Request("http://localhost"), { params: Promise.resolve({ connectionId: connection.id }) });
    await started;
    await refresh(new Request("http://localhost"), { params: Promise.resolve({ connectionId: connection.id }) });
    release();
    await first;
    expect((getProviderLimitsCache(connection.id)!.quotas!.session as any).used).toBe(90);
  } finally { release(); globalThis.fetch = original; }
});

test("bulk refresh merges against the latest snapshot written while its request is in flight", async () => {
  const connection = await createProviderConnection({ provider: "codex", name: "race", authType: "oauth", accessToken: "race-token", isActive: true });
  const old = "2025-01-01T00:00:00.000Z";
  const concurrent = "2025-01-02T00:00:00.000Z";
  setProviderLimitsCache(connection.id, { quotas: { weekly: { remaining: 10 } }, plan: null, message: null, fetchedAt: old });
  let started!: () => void;
  let release!: () => void;
  const startedPromise = new Promise<void>(resolve => { started = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => {
    const auth = new Headers(init?.headers).get("authorization");
    if (auth?.includes("race-token")) {
      started();
      await barrier;
      return Response.json({ plan_type: "plus", rate_limit: { primary_window: { used_percent: 30, limit_window_seconds: 18000 } } });
    }
    return new Response("down", { status: 429 });
  }) as typeof fetch;
  try {
    const pending = syncAll();
    await Promise.race([startedPromise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("fetch not started")), 3000))]);
    setProviderLimitsCache(connection.id, { quotas: { weekly: { remaining: 75 } }, plan: null, message: null, fetchedAt: concurrent });
    release();
    await pending;
    const snapshot = getProviderLimitsCache(connection.id)!;
    expect((snapshot.quotas!.weekly as any).remaining).toBe(75);
    expect((snapshot.quotas!.session as any).used).toBe(30);
    expect(snapshot.windowFetchedAt!.weekly).toBe(concurrent);
  } finally { release(); globalThis.fetch = original; }
}, 10000);
