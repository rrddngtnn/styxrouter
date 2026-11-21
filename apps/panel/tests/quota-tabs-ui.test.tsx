import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { Quota } from "../src/pages/Quota.tsx";

function renderQuota(initialEntry: string) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Quota />
    </MemoryRouter>
  );
}

test("Quota uses standard workspace .tabs/.tab chrome matching Activity and Models", () => {
  const accountsHtml = renderQuota("/quota");
  expect(accountsHtml).toContain('class="section-head"');
  expect(accountsHtml).toContain('class="tabs" role="tablist" aria-label="Quota workspace"');
  expect(accountsHtml).toContain('role="tab"');
  expect(accountsHtml).toContain('class="tab active"');
  expect(accountsHtml).toContain("<span>Account Quota</span>");
  expect(accountsHtml).toContain("<span>Shared Pools</span>");
  expect(accountsHtml).toContain('role="tabpanel"');
  expect(accountsHtml).not.toContain("rt-TabsList");
  expect(accountsHtml).not.toContain("rt-TabsTrigger");

  const poolsHtml = renderQuota("/quota?tab=pools");
  expect(poolsHtml).toContain('aria-selected="true" class="tab active"><span>Shared Pools</span>');
  expect(poolsHtml).toContain('aria-selected="false" class="tab"><span>Account Quota</span>');
});
