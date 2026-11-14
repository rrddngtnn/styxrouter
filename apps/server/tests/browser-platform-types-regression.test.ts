import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// This gate checks the server configuration's browser library contract, not the
// entire server a second time. The independent full server typecheck remains required.
test("server typecheck includes browser platform types used by browser executors", () => {
  const root = resolve(import.meta.dir, "../../..");
  const scratch = mkdtempSync(join(tmpdir(), "browser-types-"));
  try {
    const source = join(scratch, "browser-contract.ts");
    writeFileSync(source, `export {};
      window; document; navigator; location; localStorage; sessionStorage;
      let node: Node; let element: HTMLElement; let body: BodyInit;
      let key: JsonWebKey; let blob: BlobPart; let image: ImageData;
      let context: CanvasRenderingContext2D; let mouse: MouseEvent;
      let keyboard: KeyboardEvent; let event: Event; let css: CSSStyleDeclaration;
      caches; DOMParser; XMLSerializer; FileReader; MutationObserver;
      new Headers().entries(); new Headers().keys();
      async function headers(h: Headers) { for await (const pair of h) { pair; } }
    `);
    const config = join(scratch, "tsconfig.json");
    const check = (withoutBrowserLibs: boolean) => {
      writeFileSync(config, JSON.stringify({
        extends: resolve(root, "apps/server/tsconfig.json"),
        // No ambient packages: the browser globals must come from configured libs.
        compilerOptions: { types: [], ...(withoutBrowserLibs ? { lib: ["esnext"] } : {}) },
        files: [source], include: [], exclude: [],
      }));
      return Bun.spawnSync([
        process.execPath, "--bun",
        resolve(root, "apps/panel/node_modules/typescript/bin/tsc"),
        "--noEmit", "--pretty", "false", "-p", config,
      ], { cwd: root, stdout: "pipe", stderr: "pipe", timeout: 30_000 });
    };
    const negative = check(true);
    expect(negative.exitCode).toBe(2);
    expect(new TextDecoder().decode(negative.stdout)).toContain("Cannot find name 'window'");
    const result = check(false);
    expect(result.exitCode).toBe(0);
    expect(new TextDecoder().decode(result.stdout)).toBe("");
    expect(new TextDecoder().decode(result.stderr)).toBe("");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}, 65_000);
