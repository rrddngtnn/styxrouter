import { expect, test } from "bun:test";
import { redactLogUrl } from "../src/lib/logUrlRedaction";
import { protectPayloadForLog } from "../src/lib/logPayloads";

test("URL fragment credentials are redacted in logged payloads while preserving diagnostic fields", () => {
  const secret = "synthetic-fragment-secret-92384";
  const url = `https://example.invalid/callback?model=test#access_token=${secret}&state=visible`;
  expect(redactLogUrl(url)).not.toContain(secret);
  const output = JSON.stringify(protectPayloadForLog({ url }));
  expect(output).not.toContain(secret);
  expect(output).toContain("model=test");
  expect(output).toContain("state=visible");
});
