import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

test("production build does not embed source paths when NODE_ENV is development", () => {
  const result = spawnSync("bun", ["run", "build"], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, NODE_ENV: "development" },
    encoding: "utf8",
    timeout: 120_000,
  });
  expect(result.status).toBe(0);
  const assets = join(import.meta.dir, "../dist/assets");
  for (const file of readdirSync(assets).filter((name) => name.endsWith(".js"))) {
    const content = readFileSync(join(assets, file), "utf8");
    expect(content.includes(`${process.cwd()}/`)).toBe(false);
    expect(content.includes('fileName:"/')).toBe(false);
  }
}, 150_000);
