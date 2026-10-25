import { expect, test } from "bun:test";
import { extendQuotaSyncTimeout } from "../server/quotaSyncTimeout.ts";

test("extends only the long-running bulk quota POST request", () => {
  const calls: number[] = [];
  const server = { timeout: (_request: Request, seconds: number) => calls.push(seconds) };
  extendQuotaSyncTimeout(new Request("http://localhost/api/usage/provider-limits", { method: "POST" }), server);
  extendQuotaSyncTimeout(new Request("http://localhost/api/usage/provider-limits"), server);
  extendQuotaSyncTimeout(new Request("http://localhost/api/auth/login", { method: "POST" }), server);
  expect(calls).toEqual([240]);
});
