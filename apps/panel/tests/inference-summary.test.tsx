import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { InferenceSummary } from '../src/components/InferenceSummary.tsx';
const render = (result: any, language: 'en' | 'id' = 'en') => renderToStaticMarkup(<InferenceSummary result={result} language={language} locale={language === 'id' ? 'id-ID' : 'en-US'} onDetails={() => {}} />);
test('last model test separates truthful status and calendar time, never credential health', () => {
 const html=render({status:'failed',observedAt:'2026-11-12T12:29:20Z'});
 expect(html).toContain('Last model test'); expect(html).toContain('Failed'); expect(html).toContain('<time'); expect(html).toContain('Nov');
 expect(html).not.toContain('Inference:'); expect(html).not.toContain('expired'); expect(html).not.toContain('Open test details');
});
test('unknown remains unknown; old success remains historical success', () => {
 for (const result of [{}, {ok:true}, {status:'timeout'}, {httpStatus:200}]) expect(render(result)).toContain('Unknown');
 expect(render({status:'success',observedAt:'2020-01-02T03:04:05Z'})).toContain('Success');
});
test('missing invalid and timezone-less timestamps remain unavailable', () => {
 for (const observedAt of [undefined,'bad','2026-11-12T12:29:20']) { const html=render({status:'failed',observedAt}); expect(html).toContain('Time unavailable'); expect(html).not.toContain('<time'); }
});
test('safe reasons never repeat raw error; 403 is not expiry', () => {
 const html=render({status:'failed',httpStatus:403,error:'secret-token-DO-NOT-RENDER'});
 expect(html).toContain('Upstream access denied (403)'); expect(html).not.toContain('secret-token'); expect(html).not.toContain('expired'); expect(html).toContain('Open test details');
 expect(render({status:'failed',error:'Request timed out'})).toContain('Request timed out');
 expect(render({status:'failed'})).not.toContain('inference-summary-reason');
});
test('Indonesian preference controls labels and full zone remains accessible', () => {
 const html=render({status:'failed',observedAt:'2026-11-12T12:29:20Z',error:'timeout'},'id');
 for (const text of ['Tes model terakhir','Gagal','Permintaan kehabisan waktu','Buka detail tes','aria-label=','2026-11-12T12:29:20.000Z']) expect(html).toContain(text);
});
