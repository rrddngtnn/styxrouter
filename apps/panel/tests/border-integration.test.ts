import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
const read=(p:string)=>readFileSync(new URL('../src/'+p,import.meta.url),'utf8');
test('Tools owner assigns decorative edges, neutral divisions and identifying fields',()=>{
 const css=read('pages/tools.css');
 expect(css).toMatch(/\.tools-snippet-card\s*\{[^}]*border: 1px solid var\(--border-edge\)/);
 expect(css).toMatch(/\.tools-snippet-head\s*\{[^}]*border-bottom: 1px solid var\(--border-divider\)/);
 expect(css).toMatch(/\.tools-field input[^}]*border: 1px solid var\(--border-control\)/);
 expect(css).not.toContain('var(--border)');
});
test('shared confirmation owns decorative frame and resource edge without weakening actions',()=>{
 const css=read('components/confirmation.css');
 expect(css).toMatch(/\.styx-confirmation\.rt-DialogContent\s*\{[^}]*border:1px solid var\(--border-edge\)/);
 expect(css).toMatch(/\.styx-confirmation-resource\s*\{[^}]*border:1px solid var\(--border-edge\)/);
});
