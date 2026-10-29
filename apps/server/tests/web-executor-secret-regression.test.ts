import { expect, test } from "bun:test";
import { KimiWebExecutor } from "../open-sse/executors/kimi-web.ts";
import { HailuoWebExecutor } from "../open-sse/executors/hailuo-web.ts";

const secret = "synthetic-unlabeled-token-48201";
const original = globalThis.fetch;
const cases = [
  { name: "Kimi", executor: new KimiWebExecutor(), model: "k3", credentials: { accessToken: secret } },
  { name: "Hailuo", executor: new HailuoWebExecutor(), model: "hailuo", credentials: { apiKey: secret } },
];
const input = (c: typeof cases[number], stream = false): any => ({ model: c.model, body: { messages: [{ role: "user", content: "hello" }] }, credentials: c.credentials, stream });

for (const c of cases) {
  test(`${c.name} sends the real credential upstream`, async () => {
    let sent = false;
    globalThis.fetch = (async (_url, init) => {
      const headers = init?.headers as Record<string, string>;
      expect(c.name === "Kimi" ? headers.Authorization : headers.token).toBe(c.name === "Kimi" ? `Bearer ${secret}` : secret);
      sent = true;
      return new Response("denied", { status: 403 });
    }) as typeof fetch;
    try { await c.executor.execute(input(c)); expect(sent).toBe(true); }
    finally { globalThis.fetch = original; }
  });
}

for (const c of cases) {
  for (const mode of ["fetch", "status", "read"] as const) {
    for (const stream of [false, true]) {
      test(`${c.name} ${mode} error does not disclose credential (stream=${stream})`, async () => {
        globalThis.fetch = (async () => {
          if (mode === "fetch") throw new Error(`transport failed ${secret}`);
          if (mode === "status") return new Response(`upstream says ${secret}`, { status: 403 });
          return new Response(new ReadableStream({ start(controller) { controller.error(new Error(`read failed ${secret}`)); } }));
        }) as typeof fetch;
        try {
          const result = await c.executor.execute(input(c, stream));
          let output = "";
          try { output = await result.response.text(); } catch (error) { output = String(error); }
          expect(output).not.toContain(secret);
          expect(JSON.stringify({ url: result.url, headers: result.headers })).not.toContain(secret);
        } finally { globalThis.fetch = original; }
      });
    }
  }
}
