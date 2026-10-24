import { afterEach, expect, test } from "bun:test";
import { checkIdempotency, clearIdempotency, saveIdempotency } from "../src/lib/idempotencyLayer";
afterEach(clearIdempotency);

test("idempotency evicts oldest entries beyond its count budget", () => {
  for (let i=0;i<257;i++) saveIdempotency(`key-${i}`, {value:i}, 200);
  expect(checkIdempotency("key-0")).toBeNull();
  expect(checkIdempotency("key-256")?.response).toEqual({value:256});
});
test("oversized responses do not evict an existing replay", () => {
  saveIdempotency("small", {value:"OK"}, 200);
  saveIdempotency("large", {value:"x".repeat(1048577)}, 200);
  expect(checkIdempotency("large")).toBeNull();
  expect(checkIdempotency("small")?.status).toBe(200);
});
test("aggregate response bytes evict oldest entries", () => {
  for(let i=0;i<20;i++) saveIdempotency(`bytes-${i}`, {value:"x".repeat(500000)}, 200);
  expect(checkIdempotency("bytes-0")).toBeNull();
  expect(checkIdempotency("bytes-19")?.status).toBe(200);
});
