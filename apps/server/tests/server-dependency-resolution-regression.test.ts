import { expect, test } from "bun:test";
import { createRequire } from "node:module";

const serverRequire = createRequire(new URL("../package.json", import.meta.url));

test("server resolves the TypeScript API used by optional AST stripping", () => {
  expect(serverRequire.resolve("typescript")).toBeTruthy();
});

test("server resolves playwright-core used by browser adapters", () => {
  expect(serverRequire.resolve("playwright-core")).toBeTruthy();
});
