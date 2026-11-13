import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Compile the real implementations and their transitive production dependencies,
// not the entire server again. The independent full server typecheck is still required.
test("backup result and CodeBuddy message narrowing typecheck", () => {
  const root = resolve(import.meta.dir, "../../..");
  const scratch = mkdtempSync(join(tmpdir(), "backup-codebuddy-types-"));
  try {
    const source = join(scratch, "narrowing-contract.ts");
    const config = join(scratch, "tsconfig.json");
    const backups = resolve(root, "apps/server/server/backups.ts");
    const codebuddy = resolve(root, "apps/server/open-sse/executors/codebuddy-cn.ts");
    const imports = `import type { BackupResult } from ${JSON.stringify(backups)};
      import type { CodeBuddyCnExecutor } from ${JSON.stringify(codebuddy)};
      declare const result: BackupResult;
      declare const transformed: ReturnType<CodeBuddyCnExecutor["transformRequest"]>;
    `;
    writeFileSync(config, JSON.stringify({
      extends: resolve(root, "apps/server/tsconfig.json"),
      files: [source], include: [], exclude: [],
    }));
    const check = (body: string) => {
      writeFileSync(source, imports + body);
      return Bun.spawnSync([
        "node", "--max-old-space-size=1024",
        resolve(root, "apps/panel/node_modules/typescript/bin/tsc"),
        "--noEmit", "--pretty", "false", "-p", config,
      ], { cwd: root, stdout: "pipe", stderr: "pipe", timeout: 45_000 });
    };
    // RED control: truthiness does not narrow the failure arm with this real
    // strict:false config; transformRequest deliberately exposes unknown, not any.
    const negative = check(`
      result.ok ? result.filename : result.error;
      transformed.messages;
    `);
    expect(negative.exitCode).toBe(2);
    const diagnostics = new TextDecoder().decode(negative.stdout);
    expect(diagnostics).toMatch(/narrowing-contract\.ts\(\d+,\d+\): error TS2339: Property 'error'/);
    expect(diagnostics).toMatch(/narrowing-contract\.ts\(\d+,\d+\): error TS2339: Property 'messages'.*'unknown'/);
    expect(new TextDecoder().decode(negative.stderr)).toBe("");
    const result = check(`
      const backup: string = result.ok === true ? result.filename : result.error;
      if (transformed && typeof transformed === "object" && !Array.isArray(transformed)) {
        const request = transformed as Record<string, unknown>;
        if (Array.isArray(request.messages)) {
          const messages = request.messages as Array<Record<string, unknown>>;
          messages.map(message => typeof message.content === "string" ? message.content : "");
        }
      }
    `);
    expect(result.exitCode).toBe(0);
    expect(new TextDecoder().decode(result.stdout)).toBe("");
    expect(new TextDecoder().decode(result.stderr)).toBe("");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}, 100_000);
