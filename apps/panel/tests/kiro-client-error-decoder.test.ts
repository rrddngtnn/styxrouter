import { expect, test } from "bun:test";
import { decodeUpstreamError } from "../src/lib/error-decoder";
const notice = "This version of Kiro is no longer supported. Please update to the latest version of Kiro to continue.";
test("Kiro client retirement recommends a client update, not reauthentication", () => {
  for (const status of [403, 502]) for (const error of [notice, `[403]: ${notice}`, `[502]: ${notice}`]) {
    const result = decodeUpstreamError({provider:"kiro", status, error});
    expect(result?.code).toBe("UPSTREAM_CLIENT_UNSUPPORTED");
    expect(result?.recommendedAction).toMatch(/update/i);
    expect(result?.recommendedAction).not.toMatch(/re-authenticate|re-import|run Test/);
  }
});
test("403 permission and unknown denials do not claim expired credentials", () => {
  for (const error of ["Forbidden", "Model access denied", "Permission denied"]) {
    const result = decodeUpstreamError({provider:"kiro",status:403,error});
    expect(result?.code).toBe("UPSTREAM_FORBIDDEN");
    expect(result?.recommendedAction).not.toMatch(/re-authenticate|re-import/);
  }
});
test("invalid tokens remain authentication failures and unrelated errors remain unchanged", () => {
  for (const status of [401,403]) expect(decodeUpstreamError({provider:"kiro",status,error:"ExpiredTokenException: token expired"})?.code).toBe("UPSTREAM_AUTH_EXPIRED");
  expect(decodeUpstreamError({provider:"kiro",status:403,error:"Account suspended"})?.code).toBe("UPSTREAM_ACCOUNT_BLOCKED");
  expect(decodeUpstreamError({provider:"kiro",status:429,error:"Too many requests"})?.code).toBe("UPSTREAM_429_RATE_LIMIT");
  expect(decodeUpstreamError({provider:"openai",status:500,error:"Internal error"})?.code).toBe("UPSTREAM_5XX_UNAVAILABLE");
  expect(decodeUpstreamError({provider:"openai",status:403,error:notice})?.code).toBe("UPSTREAM_FORBIDDEN");
  expect(decodeUpstreamError({provider:"kiro",status:403,error:`Quoted: ${notice}`})?.code).toBe("UPSTREAM_FORBIDDEN");
});
