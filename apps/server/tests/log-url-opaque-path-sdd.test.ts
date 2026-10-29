import { expect, test } from "bun:test";
import { redactLogUrl } from "../src/lib/logUrlRedaction";
import { protectPayloadForLog } from "../src/lib/logPayloads";
import { createRequestLogger } from "../open-sse/utils/requestLogger";

const secret = "synthetic-opaque-path-credential-91b6";

test("URL redaction preserves a known route but conceals an unknown opaque path component", () => {
  const url = `https://example.invalid/v1/chat/completions/${secret}?model=visible`;
  const result = redactLogUrl(url);
  expect(result).not.toContain(secret);
  expect(result).toContain("/v1/chat/completions/");
  expect(result).toContain("model=visible");
});

test("request pipeline protects client endpoint and provider URL opaque paths", async () => {
  const logger = await createRequestLogger();
  logger.logClientRawRequest(`/v1/chat/completions/${secret}?model=visible`, {}, {});
  logger.logTargetRequest(`https://example.invalid/v1/chat/completions/${secret}?model=visible`, {}, {});
  const payloads = logger.getPipelinePayloads()!;
  for (const payload of [payloads.clientRawRequest, payloads.providerRequest]) {
    const text = JSON.stringify(payload);
    expect(text).not.toContain(secret);
    expect(text).toContain("/v1/chat/completions/");
    expect(text).toContain("model=visible");
  }
});

test("protected log payloads conceal opaque path segments in endpoint fields and embedded URLs", () => {
  const payload = protectPayloadForLog({ endpoint: `/v1/chat/completions/${secret}`, error: { message: `failed at https://example.invalid/v1/chat/completions/${secret}?model=visible` } });
  const text = JSON.stringify(payload);
  expect(text).not.toContain(secret);
  expect(text).toContain("/v1/chat/completions/");
  expect(text).toContain("model=visible");
});

test("unknown short and percent-encoded path values are not treated as safe route names", () => {
  for (const value of ["abc", "%73ynthetic-opaque-path-credential-91b6", "tenant%2Fsecret"]) {
    const result = redactLogUrl(`https://example.invalid/v1/chat/completions/${value}`);
    expect(result).not.toContain(value);
    expect(result).not.toContain("synthetic-opaque-path-credential-91b6");
    expect(result).toContain("/v1/chat/completions/");
  }
});
