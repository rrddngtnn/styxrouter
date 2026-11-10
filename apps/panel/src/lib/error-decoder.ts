export interface DecodedUpstreamError {
  code: string;
  title: string;
  summary: string;
  recommendedAction: string;
}

export function decodeUpstreamError(input: {
  provider?: string | null;
  status?: number | null;
  error?: string | null;
}): DecodedUpstreamError | null {
  const rawError = (input.error ?? "").trim();
  const status = input.status ?? null;
  if (!rawError && (status == null || status < 400)) return null;

  const lower = rawError.toLowerCase();

  if (/\b11128\b|conversation id missing|request illegal/i.test(rawError)) {
    return {
      code: "CBAI_11128_CHANNEL",
      title: "CodeBuddy channel / session verification rejected (11128)",
      summary:
        "The upstream gateway rejected the request due to a missing session/conversation header or sticky-session mismatch across accounts.",
      recommendedAction:
        "Ensure sticky session routing is enabled in Settings → Routing & Runtime and check that the CodeBuddy CLI version header is up to date.",
    };
  }

  if (/\b11102\b|service info not found/i.test(rawError)) {
    return {
      code: "CBCN_11102_MODEL_NOT_FOUND",
      title: "Model not served by upstream gateway (11102)",
      summary:
        "The requested model ID does not exist on this CodeBuddy gateway tier or spelling variant.",
      recommendedAction:
        "Verify the canonical model ID in the provider Models tab or switch the combo fallback step to a supported model.",
    };
  }

  if (/\b11101\b/i.test(rawError)) {
    return {
      code: "CBCN_11101_STREAM_REQUIRED",
      title: "Upstream gateway requires streaming mode (11101)",
      summary: "This CodeBuddy endpoint rejects non-streaming completion payloads.",
      recommendedAction: "Send requests with stream=true or route through the CodeBuddy executor.",
    };
  }

  if (/stream_early_eof|provider returned empty content/i.test(rawError)) {
    return {
      code: "STREAM_EARLY_EOF",
      title: "Upstream closed stream with zero output tokens",
      summary:
        "The provider accepted the request (HTTP 200) but terminated the SSE stream after metadata frames without emitting any content or tool call.",
      recommendedAction:
        "StyxRouter converts metadata-only EOFs into 502 so combo/account fallback can retry automatically. If persistent on one account, test or rotate that account.",
    };
  }

  if (input.provider === "kiro" && (status === 403 || status === 502) &&
      rawError.replace(/^\[(?:403|502)\]:\s*/, "") === "This version of Kiro is no longer supported. Please update to the latest version of Kiro to continue.") {
    return {
      code: "UPSTREAM_CLIENT_UNSUPPORTED",
      title: "Kiro client version is no longer supported",
      summary: "Kiro rejected the client contract, not the account credentials.",
      recommendedAction: "Update the router's Kiro client contract to the current official supported client. Retest after the update; changing account tokens will not fix this rejection.",
    };
  }

  if (
    status === 401 ||
    /expiredtoken|token.*expired|invalid_api_key|authentication_error|unauthorized|re-authenticate/i.test(lower)
  ) {
    return {
      code: "UPSTREAM_AUTH_EXPIRED",
      title: "Upstream credential expired or rejected",
      summary:
        "The access token, refresh token, or API key for this account was rejected by the upstream vendor.",
      recommendedAction:
        "Open Providers → select this provider → run Test on the account, or re-authenticate / re-import a fresh token.",
    };
  }

  if (status === 403) {
    const blocked = /\baccount\b.*\b(banned|suspended|deactivated|disabled)\b|\b(banned|suspended|deactivated)\b.*\baccount\b/i.test(rawError);
    return {
      code: blocked ? "UPSTREAM_ACCOUNT_BLOCKED" : "UPSTREAM_FORBIDDEN",
      title: blocked ? "Upstream account blocked" : "Upstream access denied (403)",
      summary: blocked ? "The provider explicitly reports an account restriction." : "The provider denied this request. HTTP 403 alone does not establish expired credentials or an account ban.",
      recommendedAction: blocked ? "Review the provider's account restriction and contact its support before enabling this account again." : "Inspect the upstream reason and verify model permissions, plan access, and provider policy before changing credentials.",
    };
  }

  if (
    status === 429 ||
    /\b6000\b|quota_exhausted|rate_limit|too many requests|insufficient balance|slow_down/i.test(lower)
  ) {
    return {
      code: "UPSTREAM_429_RATE_LIMIT",
      title: "Upstream quota exhausted or rate-limited (429)",
      summary:
        "The selected account hit a per-minute rate limit, 5-hour session cap, or plan balance ceiling.",
      recommendedAction:
        "Check the Quota page for the account's reset window. Add sibling accounts or a multi-provider combo so traffic fails over automatically.",
    };
  }

  if (
    /context_length_exceeded|prompt is too long|maximum context length|tokens.*exceed/i.test(lower)
  ) {
    return {
      code: "CONTEXT_LENGTH_EXCEEDED",
      title: "Prompt exceeds model context window",
      summary:
        "The input messages and tool definitions exceed the upstream model's maximum input token limit.",
      recommendedAction:
        "Compact conversation history on the client or configure a larger-context fallback model in your routing combo.",
    };
  }

  if (status != null && status >= 500) {
    return {
      code: "UPSTREAM_5XX_UNAVAILABLE",
      title: `Upstream server error (HTTP ${status})`,
      summary: "The upstream provider experienced an internal error or gateway timeout.",
      recommendedAction:
        "Transient 5xx errors automatically trigger account/combo failover when retries are configured.",
    };
  }

  if (rawError) {
    return {
      code: "UPSTREAM_GENERIC_ERROR",
      title: status ? `Upstream request failed (HTTP ${status})` : "Upstream request failed",
      summary: "The provider returned an error response for this dispatch attempt.",
      recommendedAction:
        "Inspect the raw upstream error message below and verify the account status in Providers.",
    };
  }

  return null;
}
