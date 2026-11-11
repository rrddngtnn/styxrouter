import {test,expect} from 'bun:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
import {readFileSync} from 'node:fs';
import {Login} from '../src/pages/Login';
import {RibbonMotif} from '../src/components/RibbonMotif';
test('login uses native labeled password form and no initial focus or URL credential',()=>{
 const html=renderToStaticMarkup(<MemoryRouter><Login/></MemoryRouter>);
 expect(html).toContain('<main');expect(html).toContain('<h1');expect(html).toContain('autoComplete="current-password"');expect(html).toContain('name="password"');expect(html).toContain('Management console');expect(html).toContain('aria-controls="management-password"');expect(html).not.toContain('autofocus');expect(html).not.toContain('expired');
 const source=readFileSync(new URL('../src/pages/Login.tsx',import.meta.url),'utf8');expect(source).toContain('pending.current = true');expect(source).toContain('navigate("/", { replace: true })');expect(source).not.toContain('searchParams');expect(source).not.toContain('localStorage');
});
test('original ribbon is purely static inert-to-pointer decoration and preserves artwork',()=>{
 const html=renderToStaticMarkup(<RibbonMotif/>);expect(html).toContain('aria-hidden="true"');expect(html).toContain('focusable="false"');expect(html).not.toMatch(/<image|<use|<text|<animate/);
 const css=readFileSync(new URL('../src/components/ribbon-motif.css',import.meta.url),'utf8');expect(css).toContain('pointer-events: none');expect(css).not.toMatch(/gradient|animation|filter:|url\(/);
});
