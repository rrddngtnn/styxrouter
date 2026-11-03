import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CredentialExpiryHint } from "../src/pages/Providers.tsx";

test("expiry evidence never promises automatic refresh", () => {
  for (const expiresAt of [new Date(Date.now() + 3_600_000).toISOString(), "2000-01-01T00:00:00Z", null, undefined, "invalid"]) {
    const html = renderToStaticMarkup(<CredentialExpiryHint expiresAt={expiresAt} />);
    expect(html).not.toContain("auto-refresh");
    expect(html).not.toContain("undefined");
    if (expiresAt === "2000-01-01T00:00:00Z") expect(html).toContain("token expired");
    if (!expiresAt || expiresAt === "invalid") expect(html).toBe("");
  }
  expect(renderToStaticMarkup(<CredentialExpiryHint expiresAt={new Date(Date.now() + 3_600_000).toISOString()} />)).toContain("expires in");
});
