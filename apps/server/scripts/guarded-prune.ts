#!/usr/bin/env bun
// Guarded single-subdir prune. For each candidate:
//  1. Delete the subdir
//  2. Find references anywhere outside the subdir — absolute "providers/registry/<name>"
//     OR intra-registry relative "../<name>/" / "../../<name>/" from a sibling
//  3. If any external ref exists => keep (do NOT delete)
//  4. After pass, strip dangling imports from the central providers/index.ts

import { readdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

const ROOT = "/home/youruser/styx-maintenance/candidate/styx";
const REG = `${ROOT}/open-sse/config/providers/registry`;
const INDEX_FILE = `${ROOT}/open-sse/config/providers/index.ts`;

const KEEP = new Set([
  "codex", "codex-app-server",
  "antigravity",
  "kiro",
  "codebuddy-intl", "codebuddy-cn",
  "glm",
  "claude",
  "github",
  "openai", "anthropic", "gemini",
  "openrouter",
  "chatgpt-web-codex",
]);

function externalRefs(subdir: string): string[] {
  const absPat = `providers/registry/${subdir}($|/)`;
  const relPat = `from.*"\\.\\./${subdir}(/|")`;
  const relPat2 = `from.*"\\.\\./\\.\\./${subdir}(/|")`;
  try {
    const out = execSync(
      `grep -rlE '(${absPat.replace(/\$/g, "\\$")})|(${relPat})|(${relPat2})' ${ROOT}/open-sse ${ROOT}/src ${ROOT}/server 2>/dev/null || true`,
      { encoding: "utf8" },
    );
    return out
      .split("\n")
      .filter((line: string) =>
        line && !line.includes(`/registry/${subdir}/`) && !line.endsWith(`/registry/${subdir}.ts`),
      )
      .filter((line: string) => !line.endsWith(`/providers/index.ts`));
  } catch {
    return [];
  }
}

const subdirs = readdirSync(REG)
  .filter((d) => !KEEP.has(d))
  .sort();
console.log(`candidate count: ${subdirs.length}`);

let pruned = 0;
let kept = 0;
for (const d of subdirs) {
  const dir = join(REG, d);
  if (!existsSync(dir)) continue;
  if (externalRefs(d).length > 0) {
    kept++;
    continue;
  }
  rmSync(dir, { recursive: true, force: true });
  pruned++;
}
console.log(`PRUNED: ${pruned}  KEPT: ${kept}  (keeplist=${KEEP.size})`);

// Strip dangling imports in central index.ts
const indexText = readFileSync(INDEX_FILE, "utf8");
const lines = indexText.split("\n");
const out: string[] = [];
const removedVars: string[] = [];
for (const line of lines) {
  const m = line.match(/^import\s+\{([^}]+)\}\s+from\s+"\.\/registry\/([^"]+)";/);
  if (m) {
    const [, varsStr, path] = m;
    const subpath = join(REG, path);
    if (!existsSync(subpath)) {
      removedVars.push(...varsStr.split(",").map((v) => v.trim()));
      continue;
    }
  }
  out.push(line);
}
let newText = out.join("\n");
for (const v of removedVars) {
  const esc = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  newText = newText.replace(new RegExp(`\\s*"?[a-z0-9_-]+"?:\\s*${esc},?\\n`, "g"), "\n");
}
newText = newText.replace(/\n{3,}/g, "\n\n");
writeFileSync(INDEX_FILE, newText);
console.log(`index.ts: stripped ${removedVars.length} dangling imports`);
