import { expect, test } from "bun:test";

test("model catalog can load without a Next runtime", async () => {
  const catalog = await import("../src/app/api/v1/models/catalog.ts");
  expect(typeof catalog.getUnifiedModelsResponse).toBe("function");
});
