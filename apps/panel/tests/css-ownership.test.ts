import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
test('mobile workspace column ownership is defined once and reduced motion does not target unrelated documents',()=>{
 const css=readFileSync(new URL('../src/main.css',import.meta.url),'utf8');
 expect(css.match(/\.page > \.tabs \{[^}]*grid-template-columns/g)?.length).toBe(1);
 expect(css).not.toContain('*,*::before,*::after { animation: none');
 expect(css).toContain('.shell-responsive :where(*)');
});
