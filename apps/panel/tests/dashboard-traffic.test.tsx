import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TrafficGraph } from "../src/pages/dashboard-traffic.tsx";
import type { Day } from "../src/lib/types.ts";

test("traffic graph exposes actual daily values to hover and keyboard without invented intervals", () => {
  const day: Day = { date: "2026-10-20", requests: 42, totalTokens: 1234, promptTokens: 1000, completionTokens: 234, cost: 0.12 };
  const html = renderToStaticMarkup(<TrafficGraph days={[day]} />);
  expect(html).toContain("2026-10-20: 42 requests");
  expect(html).toContain('tabindex="0"');
  expect(html).toContain("1,234 tokens");
  expect(html).not.toContain("NaN");
  expect(renderToStaticMarkup(<TrafficGraph days={[]} />)).toContain("No traffic recorded in this range.");
});
