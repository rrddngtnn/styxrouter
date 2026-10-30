import { expect, test, spyOn } from "bun:test";

test("overlapping scheduler passes keep endpoint running until the older pass finishes", async () => {
  let release!: (value: unknown[]) => void;
  let rejectOlder!: (reason: Error) => void;
  let entered!: () => void;
  const waiting = new Promise<unknown[]>((r, reject) => { release = r; rejectOlder = reject; });
  const started = new Promise<void>(r => { entered = r; });
  let calls = 0;
  const providers = await import("../src/lib/db/providers.ts");
  const spy = spyOn(providers, "getProviderConnections").mockImplementation((() => { calls++; if (calls === 1) { entered(); return waiting; } return Promise.resolve([]); }) as any);
  const timeout = globalThis.setTimeout;
  const interval = globalThis.setInterval;
  const env = { ...process.env };
  let tick!: () => void;
  process.env.STYX_TEST_MODE = "0"; process.env.STYX_DISABLE_TOKEN_HEALTHCHECK = "0"; process.env.BUN_TEST = ""; process.env.INITIAL_PASSWORD = "fixture-password";
  process.env.JWT_SECRET ||= "fixture-jwt-secret-0123456789abcdef-0123456789abcdef";
  process.env.API_KEY_SECRET ||= "fixture-api-key-secret-0123456789abcdef";
  process.env.STORAGE_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  globalThis.setTimeout = ((fn: () => void, ms?: number, ...args: unknown[]) => { if (ms === 30000) { tick = fn; return { unref() {} }; } return timeout(fn, ms, ...args); }) as any;
  globalThis.setInterval = ((fn: () => void, ms?: number, ...args: unknown[]) => ms === 1800000 ? { unref() {} } : interval(fn, ms, ...args)) as any;
  try {
    const { default: config } = await import("../server/styx.ts");
    const server = Bun.serve({ ...config, hostname: "127.0.0.1", port: 0 });
    globalThis.setTimeout = timeout; globalThis.setInterval = interval;
    try {
      const login = await fetch(`http://127.0.0.1:${server.port}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
      const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
      const state = async () => (await fetch(`http://127.0.0.1:${server.port}/api/process-health/token-scheduler`, { headers: { cookie } })).json();
      tick(); await started; tick();
      for (let i = 0; i < 100 && (await state()).lastOutcome === null; i++) await Bun.sleep(10);
      const overlapping = await state();
      expect(overlapping.lastOutcome).toBe("completed");
      expect(overlapping.lastDueCount).toBe(0);
      expect(overlapping.running).toBe(true);
      rejectOlder(new Error("older fixture failure"));
      for (let i = 0; i < 100 && (await state()).running; i++) await Bun.sleep(10);
      const afterOlder = await state();
      expect(afterOlder.running).toBe(false);
      expect(afterOlder.lastOutcome).toBe("completed");
      expect(afterOlder.lastDueCount).toBe(0);
      spy.mockImplementation((() => Promise.reject(new Error("SYNTHETIC_TOKEN_SECRET_923832"))) as any);
      const logs: unknown[][] = [];
      const warn = console.warn;
      console.warn = (...args) => { logs.push(args); };
      try {
        tick();
        for (let i = 0; i < 100 && (await state()).lastOutcome === null; i++) await Bun.sleep(10);
        const failed = await state();
        expect(failed.lastOutcome).toBe("failed");
        expect(failed.running).toBe(false);
        expect(JSON.stringify([failed, logs])).not.toContain("SYNTHETIC_TOKEN_SECRET_923832");
      } finally { console.warn = warn; }
    } finally { release([]); server.stop(true); }
  } finally { globalThis.setTimeout = timeout; globalThis.setInterval = interval; process.env.STYX_TEST_MODE = env.STYX_TEST_MODE; process.env.STYX_DISABLE_TOKEN_HEALTHCHECK = env.STYX_DISABLE_TOKEN_HEALTHCHECK; process.env.BUN_TEST = env.BUN_TEST; spy.mockRestore(); }
}, 60000);
