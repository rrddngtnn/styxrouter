import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { CustomNodeCard, NodeForm } from "../src/pages/Providers.tsx";
const node = { id: "custom-fixture", name: "Fixture", type: "openai-compatible", prefix: "fixture", apiType: "chat", baseUrl: "https://fixture.invalid/v1", chatPath: null, modelsPath: null, customHeaders: null, createdAt: null };
test("custom card distinguishes missing credentials from unavailable inventory and offers exact-provider key handoff", () => {
  const render = (accounts: number | null) => renderToStaticMarkup(<MemoryRouter><CustomNodeCard node={node} view="cards" accounts={accounts} activeAccounts={0}/></MemoryRouter>);
  expect(render(0)).toContain("No accounts connected");
  expect(render(0)).toContain("Add API key");
  expect(render(null)).toContain("Data unavailable");
  expect(render(null)).not.toContain("No accounts connected");
});
test("endpoint creation explains separation and offers key handoff without putting secrets in definition", () => {
  const html = renderToStaticMarkup(<NodeForm onDone={() => {}} onCancel={() => {}}/>);
  expect(html).toContain("Create &amp; add API key");
  expect(html).toContain("Create without key");
  expect(html).not.toContain('type="password"');
  expect(html).toContain("not a no-auth mode");
});
