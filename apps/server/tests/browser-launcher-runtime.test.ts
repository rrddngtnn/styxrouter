import {expect,test} from 'bun:test';
import {readFileSync,readdirSync} from 'node:fs';
test('compiler regression fixtures explicitly launch Bun, never Node shebangs or bunx defaults',()=>{
 for(const name of readdirSync(import.meta.dir).filter(name=>name.endsWith('.test.ts')&&name!=='browser-launcher-runtime.test.ts')){
  const source=readFileSync(new URL(name,import.meta.url),'utf8');
  expect(source, name).not.toMatch(/(?:"node"|'node')\s*,\s*["']--max-old-space-size/);
  expect(source, name).not.toMatch(/Bun\.spawnSync\(\[\s*resolve\([^\n]*node_modules\/\.bin\/tsc/);
  expect(source, name).not.toContain('spawnSync("bunx", ["tsc"');
 }
});
test('account browser fixture uses the current Bun executable, never a Node subprocess',()=>{
 const source=readFileSync(new URL('./account-model-browser-integration.test.ts',import.meta.url),'utf8');
 expect(source).toContain('spawn(process.execPath,[join(import.meta.dir,');
 expect(source).not.toContain("spawn('node',");
});
