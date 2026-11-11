import {test,expect} from 'bun:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {ReadFreshness} from '../src/components/OperationalUI';
test('retained refresh failure is persistent and labeled as client fetch time not provider observation',()=>{
 const html=renderToStaticMarkup(<ReadFreshness state={{stale:true,error:new Error('offline'),lastSuccessAt:'2026-11-11T00:00:00Z'}}/>);
 expect(html).toContain('role="alert"');expect(html).toContain('Cached data');expect(html).toContain('Last successful client fetch');expect(html).toContain('offline');
 expect(renderToStaticMarkup(<ReadFreshness state={{stale:false}}/>)).toBe('');
});
