import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QuotaBrowser } from "../src/pages/Quota";
import type { QuotaRow } from "../src/lib/types";
const models = ["low", "medium", "high", "xhigh"].map(t => `gemini-4-hydrogen-${t}`);
export const row: QuotaRow = { provider: "antigravity", connectionId: "synthetic", name: "Fixture account", quotaUsed: 0, quotaTotal: null, percentRemaining: null, resetAt: null, tokenStatus: "valid", unreportedQuotaModels: models };
test("large catalog-only inventories use the existing bounded disclosure pattern", () => {
 const html=renderToStaticMarkup(<QuotaBrowser rows={[{...row,unreportedQuotaModels:Array.from({length:100},(_,i)=>`gemini-future-${i}`)}]} names={new Map()} live={{}} syncingAll={false} onRefresh={()=>{}} onCheckGroup={()=>{}} />);
 expect(html).toContain('<details class="quota-more"');
 expect(html).toContain('gemini-future-99');
});
test("catalog-only Hydrogen is disclosed without making quota windows or allowance", () => {
 const html = renderToStaticMarkup(<QuotaBrowser rows={[row]} names={new Map()} live={{}} syncingAll={false} onRefresh={() => {}} onCheckGroup={() => {}} />);
 expect(html).toContain("Quota not provided");
 for (const model of models) expect(html).toContain(model);
 expect(html).not.toContain('class="quota-window"');
 expect(html).not.toContain('role="progressbar"');
 expect(html).not.toContain("100%");
 expect(html).not.toContain("0% left");
});
