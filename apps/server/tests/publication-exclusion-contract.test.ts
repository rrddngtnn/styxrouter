import { expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { REGISTRY } from "../open-sse/config/providers/index.ts";
import { getProviderModels, PROVIDER_MODELS } from "../open-sse/config/providerModels.ts";
import * as executors from "../open-sse/executors/index.ts";
import { WEB_COOKIE_PROVIDERS } from "../src/shared/constants/providers/web-cookie.ts";
import { WEB_SESSION_CREDENTIAL_REQUIREMENTS } from "../src/shared/providers/webSessionCredentials.ts";
import { tokenImportProviders, prepareTokenImport } from "../server/tokenImport.ts";

const server = resolve(import.meta.dir, "..");

test("publication candidate excludes the copied Hailuo chat port at every runtime surface", () => {
  expect(existsSync(join(server, "open-sse/executors/hailuo-web.ts"))).toBe(false);
  expect(existsSync(join(server, "open-sse/config/providers/registry/minimax/web/index.ts"))).toBe(false);
  expect(REGISTRY["hailuo-web"]).toBeUndefined();
  expect(getProviderModels("hailuo-web")).toEqual([]);
  expect(Object.keys(PROVIDER_MODELS)).not.toContain("hailuo-web");
  expect(executors.listExecutorAliases()).not.toContain("hailuo-web");
  expect("HailuoWebExecutor" in executors).toBe(false);
  expect(executors.hasSpecializedExecutor("hailuo-web")).toBe(false);
  expect(() => executors.getExecutor("hailuo-web")).toThrow("unsupported_provider");
  expect("hailuo-web" in WEB_COOKIE_PROVIDERS).toBe(false);
  expect("hailuo-web" in WEB_SESSION_CREDENTIAL_REQUIREMENTS).toBe(false);
  expect(tokenImportProviders().some(p => p.id === "hailuo-web")).toBe(false);
  expect(prepareTokenImport({ provider: "hailuo-web", accounts: { access_token: "synthetic-excluded-token" } })).toBeNull();

  // Catch orphaned model catalogs, imports, exports and credential exceptions,
  // while allowing honest legal records, tests and unrelated video model names.
  function check(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) check(path);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
        expect(readFileSync(path, "utf8")).not.toMatch(/hailuo-web|HailuoWebExecutor|hailuo_webProvider|HAILUO_WEB_STATIC_MODELS/);
      }
    }
  }
  for (const dir of ["open-sse", "server", "src"]) check(join(server, dir));
  // Scope guard: official MiniMax APIs and independent video catalogs stay.
  expect(REGISTRY.minimax).toBeDefined();
  expect(REGISTRY["minimax-cn"]).toBeDefined();
  expect(readFileSync(join(server, "open-sse/config/videoRegistry.ts"), "utf8")).toContain("MiniMax-Hailuo-2.3");
});
