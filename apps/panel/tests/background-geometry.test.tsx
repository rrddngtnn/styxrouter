import {test, expect} from 'bun:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {DecorativeGeometry} from '../src/components/shell/DecorativeGeometry';

test('ribbon fragment is inert decoration with no controls or image fetch',()=>{
 const html=renderToStaticMarkup(<DecorativeGeometry/>);
 expect(html).toContain('aria-hidden="true"');
 expect(html).toContain('inert=""');
 expect(html).toContain('geometry-quiet-space');
 expect(html).not.toMatch(/<(?:img|svg|button|a)\b/);
 const css=readFileSync(new URL('../src/styles/background-geometry.css',import.meta.url),'utf8');
 expect(css).toContain('data:image/svg+xml,');
 expect(css).toContain('pointer-events: none');
 expect(css).toContain('mask-repeat: no-repeat');
 expect(css).not.toMatch(/gradient\(|animation:|filter:|https?:/);
});
