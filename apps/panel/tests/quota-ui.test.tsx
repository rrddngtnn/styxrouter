import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QuotaBrowser, quotaPage } from "../src/pages/Quota.tsx";
import type { QuotaRow } from "../src/lib/types.ts";

const account = (id: string, provider = "codex"): QuotaRow => ({
  connectionId: id, provider, name: `Account ${id}`, quotaUsed: 0, quotaTotal: null,
  percentRemaining: 100, resetAt: null, tokenStatus: "valid",
});
const rows = Array.from({ length: 18 }, (_, i) => account(String(i + 1)));

test("quota pools are searched before pagination and stale pages are clamped", () => {
  expect(quotaPage(rows, "", 1).rows.map(r => r.connectionId)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
  expect(quotaPage(rows, "", 3).rows).toHaveLength(2);
  expect(quotaPage(rows, "ACCOUNT 18", 3)).toMatchObject({ page: 1, pages: 1, total: 1 });
  expect(quotaPage(rows, "absent", 9)).toMatchObject({ page: 1, pages: 1, total: 0, rows: [] });
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
