import { expect, test } from "bun:test";
import { redactLogUrl } from "../src/lib/logUrlRedaction";
import { protectPayloadForLog } from "../src/lib/logPayloads";
import { createRequestLogger } from "../open-sse/utils/requestLogger";

test("OAuth authorization codes are redacted from callback URLs in payload and request logs", async () => {
  const secret = "synthetic-auth-code-1bc93";
  const url = `https://example.invalid/oauth/callback?%63ode=${secret}&state=visible`;
  expect(redactLogUrl(url)).not.toContain(secret);
  const payload = JSON.stringify(protectPayloadForLog({ url }));
  expect(payload).not.toContain(secret);
  expect(payload).toContain("state=visible");
  const logger = await createRequestLogger();
  logger.logTargetRequest(url, {}, {});
  expect(JSON.stringify(logger.getPipelinePayloads())).not.toContain(secret);
});
