import {expect,test} from 'bun:test';
import {readFileSync} from 'node:fs';
const css=()=>readFileSync(new URL('../src/main.css',import.meta.url),'utf8');
test('semantic foundation supplies exact light and dark brand pairs',()=>{
 for(const value of ['#F8F6F3','#191D1C','#8D3F4B','#E1A1A0','#252D2A','#F3F1EE','#F5E5E3','#423036']) expect(css()).toContain(value);
});
test('primary controls use deliberate foreground and all focusable families share focus',()=>{
 expect(css()).toContain('var(--on-primary)');expect(css()).toContain('outline-offset: 2px');
 expect(readFileSync(new URL('../src/lib/preferences.tsx',import.meta.url),'utf8')).toContain('accentColor="ruby"');
});
