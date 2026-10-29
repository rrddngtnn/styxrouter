import { appendModelLine } from "../src/lib/model-selection.ts";
import { readFileSync } from "node:fs";
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelPicker } from "../src/components/ModelPicker.tsx";
import { EmptyState, LoadingState } from "../src/components/PageStates.tsx";
import { filterProviders } from "../src/lib/provider-search.ts";

test("model additions retain manual IDs, preserve fallback order and optionally deduplicate restrictions", () => {
  expect(appendModelLine("codex/gpt-5", " private/CaseSensitive ")).toBe("codex/gpt-5\nprivate/CaseSensitive");
  expect(appendModelLine("codex/gpt-5", "codex/gpt-5", true)).toBe("codex/gpt-5");
  expect(appendModelLine("codex/gpt-5", "codex/gpt-5")).toBe("codex/gpt-5\ncodex/gpt-5");
  expect(appendModelLine("codex/gpt-5", "  ")).toBe("codex/gpt-5");
});

test("owned pages wire catalog pickers, search and reusable states", () => {
  const page = (name: string) => readFileSync(new URL(`../src/pages/${name}.tsx`, import.meta.url), "utf8");
  expect(page("Providers")).toContain('aria-label={tr("Search providers")}');
  expect(page("Providers")).toContain("filterProviders(nodes, search)");
  for (const name of ["Providers", "Keys", "Routing"]) {
    expect(page(name)).toContain("<LoadingState");
    expect(page(name)).toContain("<EmptyState");
  }
  expect(page("Keys")).toContain("<ModelPicker");
  expect(page("Routing").split("<ModelPicker").length - 1).toBe(2);
});

test("provider detail rotation does not introduce a hook after conditional loading returns", () => {
  const source = readFileSync(new URL("../src/pages/Providers.tsx", import.meta.url), "utf8");
  const detail = source.slice(source.indexOf("export function ProviderDetail"));
  expect(detail.indexOf("const rotatingAccount")).toBeLessThan(detail.indexOf("if (loading && !target)"));
});

test("model picker offers canonical catalog IDs while preserving unknown manual values", () => {
  const html = renderToStaticMarkup(<ModelPicker label="Add model" value="private/unlisted" onChange={() => {}} catalog={[{ id: "codex/gpt-5", owned_by: "openai" }]} />);
  expect(html).toContain('value="private/unlisted"');
  expect(html).toContain('value="codex/gpt-5"');
  expect(html).toContain("list=");
  expect(html).toContain("Add model");
  expect(html).not.toContain('role="combobox"'); // native datalist supplies the semantics
});

test("reusable states announce loading and expose a useful empty action", () => {
  const loading = renderToStaticMarkup(<LoadingState label="Loading providers" />);
  expect(loading).toContain('role="status"');
  expect(loading).toContain('aria-busy="true"');
  expect(loading).toContain("Loading providers");
  const empty = renderToStaticMarkup(<EmptyState title="No matching providers" description="Try a different search." action={<button>Clear search</button>} />);
  expect(empty).toContain("No matching providers");
  expect(empty).toContain("Clear search");
});

test("provider search matches id, name, vendor and custom prefix without case sensitivity", () => {
  const rows = [
    { id: "codex", name: "Code service", vendor: "OpenAI" },
    { id: "node-1", name: "Private endpoint", prefix: "Muse" },
  ];
  for (const query of ["codex", "code SERVICE", "openai", " OpenAI "]) {
    expect(filterProviders(rows, query)).toEqual([rows[0]]);
  }
  expect(filterProviders(rows, "muse")).toEqual([rows[1]]);
  expect(filterProviders(rows, "missing")).toEqual([]);
  expect(filterProviders(rows, "  ")).toEqual(rows);
});
