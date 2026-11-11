import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QuotaBrowser, quotaPage, mergeWindows } from "../src/pages/Quota.tsx";
import type { QuotaRow } from "../src/lib/types.ts";
import { when } from "../src/lib/format.ts";

const account = (id: string, provider = "codex"): QuotaRow => ({
  connectionId: id, provider, name: `Account ${id}`, quotaUsed: 0, quotaTotal: null,
  percentRemaining: 100, resetAt: null, tokenStatus: "valid",
});
const rows = Array.from({ length: 18 }, (_, i) => account(String(i + 1)));

test("unknown CodeBuddy credit never renders a full balance", () => {
  const row: QuotaRow = { ...account("cbcn", "codebuddy-cn"), percentRemaining: null, creditStatus: "unknown" };
  const html = renderToStaticMarkup(<QuotaBrowser rows={[row]} names={new Map()} live={{}} syncingAll={false} onRefresh={() => {}} onCheckGroup={() => {}} />);
  expect(html).not.toContain("100%");
  expect(html).toContain("Not synced yet");
});

test("CodeBuddy separates credit status from account and process-local model cooldowns", () => {
  const row = { ...account("cbcn", "codebuddy-cn"), creditStatus: "stale" as const, accountCooldownUntil: "2028-01-01T00:00:00Z", modelCooldowns: [{ model: "model-a", reason: "rate limit", until: "2028-01-02T00:00:00Z" }] };
  const html = renderToStaticMarkup(<QuotaBrowser rows={[row]} names={new Map()} live={{}} syncingAll={false} onRefresh={() => {}} onCheckGroup={() => {}} />);
  expect(html).toContain("Credit: Stale");
  expect(html).toContain("Account cooldown");
  expect(html).toContain("Model cooldowns (this process only)");
  expect(html).toContain("model-a");
  expect(html).toContain("rate limit");
});

test("quota pools are searched before pagination and stale pages are clamped", () => {
  expect(quotaPage(rows, "", 1).rows.map(r => r.connectionId)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
  expect(quotaPage(rows, "", 3).rows).toHaveLength(2);
  expect(quotaPage(rows, "ACCOUNT 18", 3)).toMatchObject({ page: 1, pages: 1, total: 1 });
  expect(quotaPage(rows, "absent", 9)).toMatchObject({ page: 1, pages: 1, total: 0, rows: [] });
});

test("quota cards expose searchable providers and disabled account refresh", () => {
  const disabled = { ...account("disabled"), isActive: false };
  const html = renderToStaticMarkup(<QuotaBrowser rows={[disabled]} names={new Map()} now={0} live={{}} syncingAll={false} onRefresh={() => {}} onCheckGroup={() => {}} />);
  expect(html).toContain("Search providers");
  expect(html).toContain("Selected");
  expect(html).toMatch(/<button[^>]*disabled[^>]*>Check now<\/button>/);
});

test("fresh data cannot hide cached quota windows or stale warnings", () => {
  const cached: QuotaRow = { ...account("1"), fetchedAt: "2026-01-01T00:00:00Z", windows: [
    { key: "session", label: "5h Session", used: 2, total: 10, remaining: 8, percentRemaining: 80, resetAt: null, unlimited: false },
    { key: "weekly", label: "Weekly", used: 4, total: 10, remaining: 6, percentRemaining: 60, resetAt: null, unlimited: false },
  ] };
  const html = renderToStaticMarkup(<QuotaBrowser rows={[cached]} names={new Map()} now={0} live={{"1": { data: { quotas: { session: { used: 3, total: 10, remaining: 7 } }, _stale: true, _staleReason: "Rate limited" } } }} syncingAll={false} onRefresh={() => {}} onCheckGroup={() => {}} />);
  expect(html).toContain("Weekly");
  expect(html).toContain("Rate limited");
  expect(html).toContain("Stale");
});

test("cached snapshot renders each window's own freshness and observation time", () => {
  const windows = [
    { key: "session", label: "5h Session", used: 2, total: 10, remaining: 8, percentRemaining: 80, resetAt: null, unlimited: false, fetchedAt: "2026-01-02T00:00:00Z", stale: false },
    { key: "weekly", label: "Weekly", used: 4, total: 10, remaining: 6, percentRemaining: 60, resetAt: null, unlimited: false, fetchedAt: "2026-01-01T00:00:00Z", stale: true },
  ];
  const html = renderToStaticMarkup(<QuotaBrowser rows={[{ ...account("1"), fetchedAt: "2026-01-02T00:00:00Z", windows }]} names={new Map()} live={{}} syncingAll={false} onRefresh={() => {}} onCheckGroup={() => {}} />);
  const sections = html.match(/<section class="quota-window">.*?<\/section>/g) ?? [];
  expect(sections[0]).toContain(when(windows[0].fetchedAt));
  expect(sections[0]).toContain("Cached");
  expect(sections[1]).toContain(when(windows[1].fetchedAt));
  expect(sections[1]).toContain("Stale");
});

test("stale live response cannot replace known per-window provenance with a request time", () => {
  const cached: QuotaRow = { ...account("1"), fetchedAt: "2026-01-02T00:00:00Z", windows: [
    { key: "weekly", label: "Weekly", models: ["weekly"], used: 4, total: 10, remaining: 6, percentRemaining: 60, resetAt: null, unlimited: false, fetchedAt: "2026-01-01T00:00:00Z", stale: true },
  ] };
  const html = renderToStaticMarkup(<QuotaBrowser rows={[cached]} names={new Map()} live={{"1": { checkedAt: "2026-01-03T00:00:00Z", data: { _stale: true, _staleSince: "2026-01-02T00:00:00Z", quotas: { weekly: { used: 4, total: 10, remaining: 6 } } } } }} syncingAll={false} onRefresh={() => {}} onCheckGroup={() => {}} />);
  const section = html.match(/<section class="quota-window">.*?<\/section>/)?.[0] ?? "";
  expect(section).toContain("Stale");
  expect(section).toContain(when("2026-01-01T00:00:00Z"));
  expect(section).not.toContain(when("2026-01-03T00:00:00Z"));
});

test("partial live refresh marks omitted cached windows stale immediately", () => {
  const cached: QuotaRow = { ...account("1"), fetchedAt: "2026-01-01T00:00:00Z", windows: [
    { key: "weekly", label: "Weekly", models: ["weekly"], used: 4, total: 10, remaining: 6, percentRemaining: 60, resetAt: null, unlimited: false, fetchedAt: "2026-01-01T00:00:00Z", stale: false },
  ] };
  const html = renderToStaticMarkup(<QuotaBrowser rows={[cached]} names={new Map()} live={{"1": { checkedAt: "2026-01-02T00:00:00Z", data: { quotas: { session: { used: 2, total: 10, remaining: 8 } } } } }} syncingAll={false} onRefresh={() => {}} onCheckGroup={() => {}} />);
  const sections = html.match(/<section class="quota-window">.*?<\/section>/g) ?? [];
  expect(sections[0]).toContain("Fresh");
  expect(sections[0]).toContain(when("2026-01-02T00:00:00Z"));
  expect(sections[1]).toContain("Stale");
  expect(sections[1]).toContain(when("2026-01-01T00:00:00Z"));
});

test("new snapshot supersedes a completed refresh even if its server timestamp precedes the browser receipt", () => {
  const row: QuotaRow = { ...account("1"), fetchedAt: "2026-01-02T00:00:00Z", windows: [
    { key: "session", label: "5h Session", models: ["session"], used: 2, total: 10, remaining: 8, percentRemaining: 80, resetAt: null, unlimited: false, fetchedAt: "2026-01-02T00:00:00Z", stale: true },
  ] };
  const html = renderToStaticMarkup(<QuotaBrowser rows={[row]} names={new Map()} live={{"1": { snapshotAt: "2026-01-01T00:00:00Z", checkedAt: "2026-01-03T00:00:00Z", data: { quotas: { session: { used: 2, total: 10, remaining: 8 } } } } }} syncingAll={false} onRefresh={() => {}} onCheckGroup={() => {}} />);
  const section = html.match(/<section class="quota-window">.*?<\/section>/)?.[0] ?? "";
  expect(section).toContain("Stale");
  expect(section).toContain(when("2026-01-02T00:00:00Z"));
  expect(section).not.toContain("Fresh");
});

test("unknown window observation time is not described as never synced", () => {
  const row: QuotaRow = { ...account("1"), windows: [
    { key: "weekly", label: "Weekly", used: 4, total: 10, remaining: 6, percentRemaining: 60, resetAt: null, unlimited: false },
  ] };
  const html = renderToStaticMarkup(<QuotaBrowser rows={[row]} names={new Map()} live={{}} syncingAll={false} onRefresh={() => {}} onCheckGroup={() => {}} />);
  const section = html.match(/<section class="quota-window">.*?<\/section>/)?.[0] ?? "";
  expect(section).toContain("Time unknown");
  expect(section).not.toContain("Never synced");
});

test("antigravity windows with different remaining fractions stay separate", () => {
  const html = renderToStaticMarkup(<QuotaBrowser rows={[account("1", "agy")]} names={new Map()} live={{"1": { data: { quotas: { "claude-a": { used: 0, total: 1000, remaining: 700, remainingPercentage: 70 }, "claude-b": { used: 0, total: 1000, remaining: 300, remainingPercentage: 30 } } } } }} syncingAll={false} onRefresh={() => {}} onCheckGroup={() => {}} />);
  expect(html).toContain("70% left");
  expect(html).toContain("30% left");
});

test("unknown Antigravity fractions are not reported as exhausted", () => {
  const html = renderToStaticMarkup(<QuotaBrowser rows={[account("1", "agy")]} names={new Map()} live={{"1": { data: { quotas: { "gemini-model": { used: 0, total: 1000, remaining: 0, remainingPercentage: 0, fractionReported: false } } } } }} syncingAll={false} onRefresh={() => {}} onCheckGroup={() => {}} />);
  expect(html).toContain("Remaining unknown");
  expect(html).not.toContain("0% left");
});

test("merging grouped model windows retains models omitted by a partial refresh", () => {
  const window = { key: "claude:1000:200:", label: "Claude", models: ["model-a", "model-b"], used: 200, total: 1000, remaining: 800, percentRemaining: 80, resetAt: null, unlimited: false };
  const merged = mergeWindows([window], [{ ...window, models: ["model-a"] }]);
  expect(merged.map(w => w.models)).toEqual([["model-a"], ["model-b"]]);
});

test("additional real windows are disclosed with their models", () => {
  const windows = Array.from({ length: 5 }, (_, i) => ({ key: `w${i}`, label: `Window ${i}`, models: [`model-${i}`], used: null, total: null, remaining: null, percentRemaining: null, resetAt: null, unlimited: false }));
  const html = renderToStaticMarkup(<QuotaBrowser rows={[{ ...account("1"), windows }]} names={new Map()} live={{}} syncingAll={false} onRefresh={() => {}} onCheckGroup={() => {}} />);
  expect(html).toContain("More quota windows");
  expect(html).toContain("Window 4");
  expect(html).toContain("model-4");
  expect(html).not.toContain("role=\"progressbar\"");
});

test("provider cards show only the selected pool, capped at eight account cards", () => {
  const html = renderToStaticMarkup(<QuotaBrowser rows={[...rows, account("other", "claude")]} names={new Map()} now={0} live={{}} syncingAll={false} onRefresh={() => {}} onCheckGroup={() => {}} />);
  expect(html).toContain("Search accounts");
  expect(html).toContain("aria-pressed=\"true\"");
  expect(html).toContain("Account 1");
  expect(html).not.toContain("Account 9<");
  expect(html).not.toContain("Account other");
  expect(html).not.toContain("<table");
  expect(html).toContain("Page 1 of 3");
  expect(html).toContain("Not synced yet");
  expect(html).not.toContain("100%");
});

test("Codex quota card surfaces banked reset credits and inventory review trigger when callback is provided", () => {
  const codexRow: QuotaRow = { ...account("codex-1", "codex"), bankedResetCredits: 2 };
  const html = renderToStaticMarkup(
    <QuotaBrowser
      rows={[codexRow]}
      names={new Map()}
      live={{}}
      syncingAll={false}
      onRefresh={() => {}}
      onCheckGroup={() => {}}
      onOpenResetCredits={() => {}}
    />,
  );
  expect(html).toContain("Banked reset credits");
  expect(html).toContain("<strong>2</strong>");
  expect(html).toContain("Reset credits");
  expect(html).not.toContain(">Redeem reset<");
});
