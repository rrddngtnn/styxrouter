import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
const css=readFileSync(new URL('../src/main.css',import.meta.url),'utf8');
test('approved B separates decorative outer edge from neutral divider and identifying control',()=>{
 for(const value of ['--border-edge: #57464A','--border-divider: #424A46','--border-control: #AF9095','--border-edge: #DFCED0','--border-divider: #DEDAD5','--border-control: #927078']) expect(css).toContain(value);
 expect(css).toContain('--border: var(--border-control)');
 expect(css).toContain('--border-subtle: var(--border-divider)');
});
