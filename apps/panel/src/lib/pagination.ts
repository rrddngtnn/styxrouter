export type PaginationItem = number | "ellipsis";

export function paginationState(total: number, pageSize: number, requestedPage: number) {
  total = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  pageSize = Number.isFinite(pageSize) ? Math.max(1, Math.floor(pageSize)) : 1;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Number.isFinite(requestedPage) ? Math.min(pages, Math.max(1, Math.floor(requestedPage))) : 1;
  return { total, pageSize, pages, page, start: total ? (page - 1) * pageSize + 1 : 0, end: Math.min(page * pageSize, total) };
}

/** A bounded seven-slot window, retaining first/last pages and avoiding single-page gaps. */
export function paginationItems(page: number, pages: number): PaginationItem[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, "ellipsis", pages];
  if (page >= pages - 3) return [1, "ellipsis", pages - 4, pages - 3, pages - 2, pages - 1, pages];
  return [1, "ellipsis", page - 1, page, page + 1, "ellipsis", pages];
}
