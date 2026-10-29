import { test, expect } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("nested Bun inherits a dotenv-free cwd with relative project paths available", () => {
  const root = mkdtempSync(join(tmpdir(), "runner-nested-dotenv-"));
  try {
    const server = join(root, "server");
    mkdirSync(join(server, "scripts"), { recursive: true });
    mkdirSync(join(server, "tests"));
    mkdirSync(join(server, "src"));
    copyFileSync(resolve(import.meta.dir, "../scripts/test-isolated.ts"), join(server, "scripts/test-isolated.ts"));
    writeFileSync(join(server, ".env"), "NESTED_DOTENV_SYNTHETIC=leaked\n");
    writeFileSync(join(server, "src", "fixture.txt"), "fixture");
    writeFileSync(join(server, "tests", "fixture.test.ts"), `import {test,expect} from 'bun:test'; import {readFileSync} from 'node:fs'; test('nested',()=>{expect(readFileSync('src/fixture.txt','utf8')).toBe('fixture'); const p=Bun.spawnSync([process.execPath,'-e','if(process.env.NESTED_DOTENV_SYNTHETIC) process.exit(42)'],{stdout:'pipe',stderr:'pipe'}); expect(p.exitCode).toBe(0); const explicit=Bun.spawnSync([process.execPath,'-e','if(process.env.NESTED_DOTENV_SYNTHETIC!=="leaked") process.exit(43)'],{cwd:${JSON.stringify(server)},stdout:'pipe',stderr:'pipe'}); expect(explicit.exitCode).toBe(0);});`);
    const p = Bun.spawnSync([process.execPath, "--no-env-file", join(server, "scripts/test-isolated.ts"), "tests/fixture.test.ts"], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(`${p.exitCode}: ${p.stdout} ${p.stderr}`).toStartWith("0:");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
