import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { CodeBuddyCnExecutor } from "../open-sse/executors/codebuddy-cn";
import { CodebuddyIntlExecutor } from "../open-sse/executors/codebuddy-intl";

const custom = "Synthetic custom instruction: preserve the user's chosen identity. " + "Policy detail. ".repeat(160);
const neutral = "You are a helpful AI assistant that helps with software engineering tasks.";

test("synthetic long custom system instructions are discarded by both CodeBuddy variants", () => {
  for (const executor of [new CodeBuddyCnExecutor(), new CodebuddyIntlExecutor()]) {
    for (const content of [custom, [{ type: "text", text: custom, cache_control: { type: "ephemeral" } }]]) {
      const body = { messages: [{ role: "system", content }, { role: "user", content: "hello" }] };
      const result = executor.transformRequest("fixture", body, false, {} as never) as any;
      expect(JSON.stringify(result.messages)).not.toContain("Synthetic custom instruction");
      expect(JSON.stringify(result.messages)).toContain(neutral);
    }
  }
});

test("default agent marker also discards unrelated appended instructions", () => {
  for (const executor of [new CodeBuddyCnExecutor(), new CodebuddyIntlExecutor()]) {
    const system = "You are Claude Code\n" + "Default agent context. ".repeat(120) + "\nCUSTOM_SENTINEL: follow the project rules.";
    const result = executor.transformRequest("fixture", { system, messages: [{ role: "user", content: "hello" }] }, false, {} as never) as any;
    expect(result.system).toBe(neutral);
    expect(JSON.stringify(result)).not.toContain("CUSTOM_SENTINEL");
  }
});

test("CN configured soul replaces a long custom instruction", () => {
  const dir = mkdtempSync(join(process.env.TMPDIR!, "cbcn-soul-"));
  const soul = join(dir, "soul.md");
  try {
    writeFileSync(soul, "SYNTHETIC_SOUL_IDENTITY");
    const script = `import { CodeBuddyCnExecutor } from './open-sse/executors/codebuddy-cn'; const r = new CodeBuddyCnExecutor().transformRequest('fixture', {messages:[{role:'system',content:${JSON.stringify(custom)}}]}, false, {}); console.log(JSON.stringify(r));`;
    const proc = Bun.spawnSync([process.execPath, "-e", script], { cwd: process.cwd(), env: { ...process.env, RATMAN_SOUL_PATH: soul }, stdout: "pipe", stderr: "pipe" });
    expect(proc.exitCode).toBe(0);
    const output = proc.stdout.toString();
    expect(output).toContain("SYNTHETIC_SOUL_IDENTITY");
    expect(output).not.toContain("Synthetic custom instruction");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
