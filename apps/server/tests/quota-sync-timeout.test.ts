import { expect, test } from "bun:test";
import { extendQuotaSyncTimeout } from "../server/quotaSyncTimeout.ts";

test("extends the long-running bulk quota POST request without changing ordinary routes", () => {
  const calls: number[] = [];
  const server = { timeout: (_request: Request, seconds: number) => calls.push(seconds) };
  extendQuotaSyncTimeout(new Request("http://localhost/api/usage/provider-limits", { method: "POST" }), server);
  extendQuotaSyncTimeout(new Request("http://localhost/api/usage/provider-limits"), server);
  extendQuotaSyncTimeout(new Request("http://localhost/api/auth/login", { method: "POST" }), server);
  expect(calls).toEqual([240]);
});

test("inference streams disable Bun socket idle timeout while ordinary GET requests retain it", () => {
  for (const path of ["/v1/chat/completions", "/chat/completions", "/v1/messages", "/messages", "/v1/responses", "/responses"]) {
    const calls: number[] = [];
    const request = new Request(`http://localhost${path}`, { method: "POST" });
    extendQuotaSyncTimeout(request, {timeout: (actual, seconds) => { expect(actual).toBe(request); calls.push(seconds); }});
    expect(calls).toEqual([0]);
  }
  const calls: number[] = [];
  extendQuotaSyncTimeout(new Request("http://localhost/v1/chat/completions"), {timeout: (_, seconds) => calls.push(seconds)});
  expect(calls).toEqual([]);
});
