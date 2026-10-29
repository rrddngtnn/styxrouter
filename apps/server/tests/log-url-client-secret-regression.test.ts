import { expect, test } from "bun:test";
import { redactLogUrl } from "../src/lib/logUrlRedaction";
import { protectPayloadForLog } from "../src/lib/logPayloads";

test("client_secret URL parameters do not leak in protected request payloads", () => {
  const secret = "synthetic-client-secret-91657";
  const url = `https://example.invalid/oauth?client_secret=${secret}&model=ok`;
  expect(redactLogUrl(url)).not.toContain(secret);
  const protectedPayload = JSON.stringify(protectPayloadForLog({ url }));
  expect(protectedPayload).not.toContain(secret);
  expect(protectedPayload).toContain("model=ok");
});
