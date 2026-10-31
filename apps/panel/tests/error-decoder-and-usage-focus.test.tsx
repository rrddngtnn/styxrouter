import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { decodeUpstreamError } from "../src/lib/error-decoder.ts";
import { UsageFocusBar } from "../src/pages/Usage.tsx";

test("decodeUpstreamError classifies known upstream error signatures and returns actionable advice", () => {
  const cbai = decodeUpstreamError({
    provider: "codebuddy-intl",
    status: 400,
    error: "11128 request illegal: conversation id missing",
  });
  expect(cbai).not.toBeNull();
  expect(cbai?.code).toBe("CBAI_11128_CHANNEL");
  expect(cbai?.summary).toContain("session");

  const cbcnNotFound = decodeUpstreamError({
    provider: "codebuddy-cn",
    status: 400,
    error: "model [foo] service info not found (11102)",
  });
  expect(cbcnNotFound?.code).toBe("CBCN_11102_MODEL_NOT_FOUND");

  const rateLimit = decodeUpstreamError({
    provider: "claude",
    status: 429,
    error: "rate_limit_error: Number of request tokens has exceeded your per-minute rate limit",
  });
  expect(rateLimit?.code).toBe("UPSTREAM_429_RATE_LIMIT");

  const kiroAuth = decodeUpstreamError({
    provider: "kiro",
    status: 401,
    error: "ExpiredTokenException: The security token included in the request is expired",
  });
  expect(kiroAuth?.code).toBe("UPSTREAM_AUTH_EXPIRED");

  const earlyEof = decodeUpstreamError({
    provider: "claude",
    status: 502,
    error: "STREAM_EARLY_EOF: Provider returned empty content",
  });
  expect(earlyEof?.code).toBe("STREAM_EARLY_EOF");

  expect(decodeUpstreamError({ provider: "openai", status: 200, error: null })).toBeNull();
});

test("UsageFocusBar renders All providers reset pill and selectable provider focus cards", () => {
  const html = renderToStaticMarkup(
    <UsageFocusBar
      selected="alpha"
      onSelect={() => {}}
      label={(id) => (id === "alpha" ? "Alpha Provider" : "Beta Provider")}
      providers={[
        {
          provider: "Alpha Provider",
          providerId: "alpha",
          requests: 120,
          totalTokens: 45000,
          avgLatencyMs: 320,
          successRatePct: 98.5,
          cost: 1.25,
        },
        {
          provider: "Beta Provider",
          providerId: "beta",
          requests: 40,
          totalTokens: 12000,
          avgLatencyMs: 210,
          successRatePct: 100,
          cost: 0,
        },
      ]}
    />,
  );

  expect(html).toContain("All providers");
  expect(html).toContain("Alpha Provider");
  expect(html).toContain("Beta Provider");
  expect(html).toContain("98.5%");
});
