import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { basename } from "node:path";

test("browser fixtures use names excluded from Bun's automatic test discovery", () => {
  const browserFiles = readdirSync(import.meta.dir, { recursive: true }).filter((name) => basename(name).includes(".browser."));
  expect(browserFiles).toContain("navigation-landmark-language.browser.mjs");
  expect(browserFiles).toContain("usage-provider.browser.mjs");
  expect(browserFiles.filter((name) => /(?:^test[._-]|(?:\.test|_test|\.spec|_spec)\.[cm]?[jt]sx?$)/.test(basename(name)))).toEqual([]);
});
