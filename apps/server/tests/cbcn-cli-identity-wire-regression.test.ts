import { test, expect } from "bun:test";
import { CodeBuddyCnExecutor } from "../open-sse/executors/codebuddy-cn";
import { CodebuddyIntlExecutor } from "../open-sse/executors/codebuddy-intl";
import { DefaultExecutor } from "../open-sse/executors/default";

const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
  const headers = Object.fromEntries(req.headers.entries());
  await req.text();
  return new Response(JSON.stringify(headers), { headers: { "content-type": "application/json" } });
}});

async function wire(executor: any, credentials: any = { accessToken: "synthetic-token" }) {
  executor.buildUrl = () => `http://127.0.0.1:${server.port}/v2/chat/completions`;
  const result: any = await executor.execute({ model: "fixture", body: { model: "fixture", messages: [{ role: "user", content: "hi" }] }, stream: false, credentials });
  return await result.response.json() as Record<string, string>;
}

test("CN sends registry CLI identity and preserves bearer authentication on the wire", async () => {
  const h = await wire(new CodeBuddyCnExecutor());
  expect(h["user-agent"]).toBe("CLI/2.108.1 CodeBuddy/2.108.1");
  expect(h["x-ide-type"]).toBe("CLI");
  expect(h["x-ide-name"]).toBe("CLI");
  expect(h.authorization).toBe("Bearer synthetic-token");
});

test("CN user-agent environment override wins", async () => {
  const old = process.env.CODEBUDDY_CN_USER_AGENT;
  process.env.CODEBUDDY_CN_USER_AGENT = "synthetic-override";
  try { expect((await wire(new CodeBuddyCnExecutor()))["user-agent"]).toBe("synthetic-override"); }
  finally { if (old === undefined) delete process.env.CODEBUDDY_CN_USER_AGENT; else process.env.CODEBUDDY_CN_USER_AGENT = old; }
});

test("CN mixed-case identity duplicates do not concatenate on the wire", async () => {
  const executor: any = new CodeBuddyCnExecutor();
  executor.config = { ...executor.config, headers: { ...executor.config.headers, "uSeR-aGeNt": "synthetic-cli", "x-iDe-tYpE": "synthetic-type", "x-iDe-nAmE": "synthetic-name" } };
  const h = await wire(executor);
  expect(h["user-agent"]).toBe("synthetic-cli");
  expect(h["x-ide-type"]).toBe("synthetic-type");
  expect(h["x-ide-name"]).toBe("synthetic-name");
  const old = process.env.CODEBUDDY_CN_USER_AGENT;
  process.env.CODEBUDDY_CN_USER_AGENT = "synthetic-env";
  try { expect((await wire(executor))["user-agent"]).toBe("synthetic-env"); }
  finally { if (old === undefined) delete process.env.CODEBUDDY_CN_USER_AGENT; else process.env.CODEBUDDY_CN_USER_AGENT = old; }
  expect((await wire(executor, { apiKey: "synthetic-key" })).authorization).toBe("Bearer synthetic-key");
});

test("international and unrelated provider wire headers retain existing behavior", async () => {
  const intl = await wire(new CodebuddyIntlExecutor());
  expect(intl["user-agent"]).toBe("IDE/2.108.1 CodeBuddy/2.108.1");
  expect(intl["x-ide-type"]).toBe("IDE");
  expect(intl["x-ide-name"]).toBe("IDE");
  expect(intl.authorization).toBe("Bearer synthetic-token");
  const other = await wire(new DefaultExecutor("openai"));
  expect(other.authorization).toBe("Bearer synthetic-token");
  expect(other["x-ide-type"]).toBeUndefined();
});

process.on("exit", () => server.stop(true));
