import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { ProviderCard } from "../src/pages/Providers.tsx";

const card = (accounts: number | null, activeAccounts: number) => renderToStaticMarkup(<MemoryRouter><ProviderCard provider={{id:"anthropic", name:"Anthropic"}} tab="apikey" accounts={accounts} activeAccounts={activeAccounts} /></MemoryRouter>);

test("provider card exposes independent native links and truthful unknown account data", () => {
  const html = card(null, 0);
  expect(html).toContain("Data unavailable");
  expect(html).not.toContain("no accounts");
  expect(html.match(/<a /g)).toHaveLength(2);
  expect(html).not.toContain('role="link"');
  expect(card(1, 0)).not.toContain('class="health down"');
});
