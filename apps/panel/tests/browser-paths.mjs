import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url)).replace(/[\\/]$/, '');

// Test tooling only. Default to the repository's ignored evidence directory.
// Relative overrides are resolved against the repository, never the caller's cwd.
export function browserEvidencePath(suite, file = '', env = process.env) {
  const root = resolve(repoRoot, env.REDESIGN_EVIDENCE || 'evidence/browser');
  return resolve(root, suite, file);
}
