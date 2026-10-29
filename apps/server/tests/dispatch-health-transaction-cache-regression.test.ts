import { expect, test } from "bun:test";
import { Hono } from "hono";
import { getDbInstance } from "../src/lib/db/core";
import { createProcessHealthApi } from "../server/processHealth";

test("rolled back same-connection writes never leak through the dispatch cache", async () => {
  const db = getDbInstance();
  const app = new Hono();
  app.route("/", createProcessHealthApi());
  let pending!: Promise<Response>;
  try {
    db.transaction(() => {
      db.prepare("INSERT INTO usage_history (provider, timestamp, success) VALUES (?, ?, ?)").run("rolled-back", new Date(Date.now() - 1000).toISOString(), 1);
      pending = app.request("/dispatch");
      throw new Error("rollback fixture");
    })();
  } catch (error) {
    expect((error as Error).message).toBe("rollback fixture");
  }
  await pending;
  const response = await app.request("/dispatch");
  const body = await response.json() as any;
  expect(body.providers.some((provider: any) => provider.provider === "rolled-back")).toBe(false);
  db.prepare("INSERT INTO usage_history (provider, timestamp, success) VALUES (?, ?, ?)").run("same-connection", new Date(Date.now() - 1000).toISOString(), 1);
  const changed = await (await app.request("/dispatch")).json() as any;
  expect(changed.providers.find((provider: any) => provider.provider === "same-connection")?.hour.requests).toBe(1);
});
