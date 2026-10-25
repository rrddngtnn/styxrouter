import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { DashboardView } from "../src/pages/Dashboard.tsx";
const loading = { status: "loading" as const, data: null, error: null };
const ok = <T,>(data: T) => ({ status: "ok" as const, data, error: null });

test("dashboard renders configured provider conditions and real activity metadata", () => {
  const html = renderToStaticMarkup(<MemoryRouter><DashboardView range="7d" onRange={() => {}} now={0} health={ok({ ok: true })} stats={loading} conns={ok({ connections: [{ id: "one", provider: "codex", name: "Work", isActive: true, testStatus: null, lastError: null, backoffLevel: 0, rateLimitedUntil: null, tokenExpiresAt: null }] })} provs={ok({ providers: [{ id: "codex", name: "Codex" }] })} logs={ok([{ id: "request", timestamp: "2026-10-20T00:00:00Z", model: "actual-model", status: 503, duration: 120 }])} /></MemoryRouter>);
  expect(html).toContain('/providers/codex');
  expect(html).toContain('1 unchecked');
  expect(html).toContain('actual-model');
  expect(html).toContain('503');
  expect(html).not.toContain('all healthy');
});

test("dashboard reports fetch failures rather than empty success", () => {
  const failed = { status: "error" as const, data: null, error: new Error("Endpoint unavailable") };
  const html = renderToStaticMarkup(<MemoryRouter><DashboardView range="7d" onRange={() => {}} now={0} health={failed} stats={failed} conns={failed} provs={failed} logs={failed} /></MemoryRouter>);
  expect(html).toContain('Endpoint unavailable');
  expect(html).not.toContain('No recent requests');
  expect(html).not.toContain('No account problems');
});

test("dashboard keeps unavailable operations distinct from healthy or empty states", () => {
  const html = renderToStaticMarkup(<MemoryRouter><DashboardView range="7d" onRange={() => {}} now={0} health={loading} stats={loading} conns={loading} provs={loading} logs={loading} /></MemoryRouter>);
  expect(html).toContain("Traffic");
  expect(html).toContain("Provider health");
  expect(html).toContain("Recent activity");
  expect(html).toContain("Account problems");
  expect(html).toContain('/activity?errors=true');
  expect(html).not.toContain("all healthy");
  expect(html).not.toContain("0/0");
  expect(html).toContain('aria-pressed="true"');
});
