import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ProviderIcon } from "../src/components/ProviderIcon.tsx";

test("known providers use local recognizable marks and unknown providers get a safe monogram", () => {
  const known = renderToStaticMarkup(<ProviderIcon providerId="anthropic" label="Anthropic" />);
  expect(known).toContain("<svg");
  expect(known).not.toContain("http");
  const unknown = renderToStaticMarkup(<ProviderIcon providerId="custom-id" label="Acme Labs" size={32} />);
  expect(unknown).toContain("AL");
  expect(unknown).not.toContain("<svg");
  expect(renderToStaticMarkup(<ProviderIcon providerId="custom-id" label="" />)).toContain("?");
});
