import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Pagination } from "../src/components/Pagination.tsx";
import { paginationItems, paginationState } from "../src/lib/pagination.ts";
import { QuotaBrowser, quotaPage } from "../src/pages/Quota.tsx";
import type { QuotaRow } from "../src/lib/types.ts";

const accounts: QuotaRow[] = Array.from({ length: 64 }, (_, i) => ({ connectionId: String(i), provider: "codex", name: `Account ${i}`, quotaUsed: 0, quotaTotal: null, percentRemaining: 100, resetAt: null, tokenStatus: "valid" }));

test("quota uses numbered eight-item pagination and accepts changed page sizes", () => {
  const html = renderToStaticMarkup(<QuotaBrowser rows={accounts} names={new Map()} now={0} live={{}} syncingAll={false} onRefresh={() => {}} onCheckGroup={() => {}} />);
  expect(html).toContain('aria-label="Go to page 8"');
  expect(html).toContain('1–8 of 64 accounts');
  expect(html).toContain('Items per page');
  expect(quotaPage(accounts, "", 2, 16).rows).toHaveLength(16);
  expect(quotaPage(accounts, "Account 63", 8, 16)).toMatchObject({ page: 1, pages: 1, total: 1 });
});

test("pagination state clamps stale pages and reports exact empty and final ranges", () => {
  const state = paginationState;
  expect(state(18, 8, 99)).toEqual({ total: 18, pageSize: 8, pages: 3, page: 3, start: 17, end: 18 });
  expect(state(0, 8, 4)).toEqual({ total: 0, pageSize: 8, pages: 1, page: 1, start: 0, end: 0 });
  expect(state(18, 8, -2)).toMatchObject({ page: 1, start: 1, end: 8 });
  expect(state(18, 0, NaN)).toMatchObject({ pageSize: 1, page: 1, pages: 18 });
});

test("pagination renders accessible numbered controls, range, optional size and direct jump", () => {
  const html = renderToStaticMarkup(<Pagination total={80} pageSize={8} page={5} onPageChange={() => {}} onPageSizeChange={() => {}} pageSizeOptions={[8, 16, 32]} itemLabel="accounts" />);
  expect(html).toContain('aria-label="Pagination"');
  expect(html).toContain('aria-current="page"');
  expect(html).toContain('aria-label="Go to page 1"');
  expect(html).toContain('aria-label="Go to page 10"');
  expect(html).toContain('33–40 of 80 accounts');
  expect(html).toContain('Page 5 of 10');
  expect(html).toContain('Previous');
  expect(html).toContain('Next');
  expect(html).toContain('Items per page');
  expect(html).toContain('Go to page');
  expect(html).toContain('type="number"');
  const empty = renderToStaticMarkup(<Pagination total={0} pageSize={8} page={1} onPageChange={() => {}} />);
  expect(empty).toContain('0–0 of 0 items');
  expect(empty.match(/disabled=""/g)).toHaveLength(3);
  expect(empty).not.toContain('type="number"');
});

test("numbered pages keep boundaries, current neighbors and ellipses without orphan gaps", () => {
  const items = paginationItems;
  expect(items(1, 8)).toEqual([1, 2, 3, 4, 5, "ellipsis", 8]);
  expect(items(5, 10)).toEqual([1, "ellipsis", 4, 5, 6, "ellipsis", 10]);
  expect(items(10, 10)).toEqual([1, "ellipsis", 6, 7, 8, 9, 10]);
  expect(items(3, 6)).toEqual([1, 2, 3, 4, 5, 6]);
});
