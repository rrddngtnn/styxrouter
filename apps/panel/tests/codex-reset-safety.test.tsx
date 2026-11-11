import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QuotaBrowser } from "../src/pages/Quota.tsx";
import type { QuotaRow } from "../src/lib/types.ts";
const row: QuotaRow = { connectionId: "a", provider: "codex", name: "A", quotaUsed: 0, quotaTotal: null, percentRemaining: null, resetAt: null, tokenStatus: "valid", bankedResetCredits: 4 };
const render = (live: Record<string, unknown>) => renderToStaticMarkup(<QuotaBrowser rows={[row]} names={new Map()} live={live} syncingAll={false} onRefresh={() => {}} onCheckGroup={() => {}} onOpenResetCredits={() => {}} />);
test("a fresh observation omitting reset credits does not resurrect an old count", () => {
  const html = render({ a: { data: { quotas: {} } } });
  expect(html).not.toContain("<strong>4</strong>");
  expect(html).not.toContain(">Redeem reset<");
});
test("stale live reset count is labelled stale rather than actionable fresh inventory", () => {
  const html = render({ a: { data: { _stale: true, bankedResetCredits: 3 } } });
  expect(html).toContain("Banked reset credits");
  expect(html).toContain("3</strong> · Stale");
});
