import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("server typecheck includes browser platform types used by browser executors", () => {
  const root = resolve(import.meta.dir, "../../..");
  const result = Bun.spawnSync([
    resolve(root, "apps/panel/node_modules/.bin/tsc"),
    "--noEmit", "--pretty", "false", "-p", resolve(root, "apps/server/tsconfig.json"),
  ], { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect([0, 2]).toContain(result.exitCode);
  const output = new TextDecoder().decode(result.stdout);
  const browserPlatformErrors = output.split("\n").filter((line) =>
    /error TS(?:2304|2552|2584): Cannot find name '(?:window|document|navigator|location|localStorage|sessionStorage|HTML\w+|Element|Node|BodyInit|JsonWebKey|caches|DOMParser|XMLSerializer|FileReader|BlobPart|ImageData|CanvasRenderingContext2D|MutationObserver|MouseEvent|KeyboardEvent|Event|CSSStyleDeclaration)'/.test(line) ||
    /error TS2339: Property '(?:entries|keys)' does not exist on type 'Headers'/.test(line)
  );
  expect(browserPlatformErrors).toEqual([]);
}, 120_000);
