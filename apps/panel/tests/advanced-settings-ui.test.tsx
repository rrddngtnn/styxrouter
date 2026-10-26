import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import * as advanced from "../src/components/settings/AdvancedSettings.tsx";

test("inspector renders redacted readable configuration with read-only export controls", () => {
  expect(advanced).toHaveProperty("AdvancedSettings");
  const html = renderToStaticMarkup(<advanced.AdvancedSettings settings={{ strategy: "priority", apiKey: "DO_NOT_RENDER", nested: { password: "NESTED_SECRET" } }} />);
  expect(html).toContain("Configuration inspector");
  expect(html).toContain("Search setting keys");
  expect(html).toContain("Copy JSON");
  expect(html).toContain("Download JSON");
  expect(html).toContain("[REDACTED]");
  expect(html).not.toContain("DO_NOT_RENDER");
  expect(html).not.toContain("NESTED_SECRET");
  expect(html).not.toContain("textarea");
  expect(html).toContain("Not available from a remote domain");
  expect(html).toMatch(/type="checkbox"[^>]*checked=""/);
  expect(html).not.toContain("/home/youruser");
});

test("loading and errors do not expose a stale configuration snapshot", () => {
  const loading = renderToStaticMarkup(<advanced.AdvancedSettings settings={{ stale: "HIDDEN" }} loading />);
  expect(loading).toContain("Loading configuration");
  expect(loading).not.toContain("HIDDEN");
  const error = renderToStaticMarkup(<advanced.AdvancedSettings settings={{ stale: "HIDDEN" }} error="Configuration request failed" />);
  expect(error).toContain("Configuration request failed");
  expect(error).not.toContain("HIDDEN");
});
