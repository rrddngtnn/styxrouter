import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

test('runner drops inherited secrets while fixture explicitly supplies synthetic keys to child', () => {
  const root = mkdtempSync(join(tmpdir(), 'clean-env-'));
  try {
    const fixture = join(root, 'fixture.test.ts');
    writeFileSync(fixture, `import {test,expect} from 'bun:test'; test('clean',()=>{ expect(process.env.PRIVATE_SYNTHETIC_SECRET).toBeUndefined(); expect(process.env.JWT_SECRET).toBeUndefined(); expect(process.env.API_KEY_SECRET).toBeUndefined(); process.env.API_KEY_SECRET='fixture-api-key-secret'; const p=Bun.spawnSync([process.execPath,'--no-env-file','-e','if(process.env.API_KEY_SECRET!=="fixture-api-key-secret") process.exit(1)'],{env:{...process.env}}); expect(p.exitCode).toBe(0); });`);
    const result = Bun.spawnSync([process.execPath, '--no-env-file', resolve(import.meta.dir, '../scripts/test-isolated.ts'), fixture], {env: {...process.env, PRIVATE_SYNTHETIC_SECRET:'synthetic-secret', JWT_SECRET:'synthetic-secret', API_KEY_SECRET:'synthetic-inherited-secret'}, stdout:'pipe', stderr:'pipe'});
    expect(`${result.exitCode}: ${result.stderr}`).toStartWith('0:');
  } finally { rmSync(root, {recursive:true, force:true}); }
});
