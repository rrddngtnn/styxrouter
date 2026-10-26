import {expect,test} from 'bun:test';
import {translate} from '../src/lib/preferences-core.ts';
test('Indonesian catalog covers operational pages and interpolates without changing identifiers',()=>{
 expect(translate('id','Model Capabilities')).toBe('Kapabilitas Model');
 expect(translate('id','No matching requests')).toBe('Tidak ada permintaan yang cocok');
 expect(translate('id','Test failed ({0})',{0:429})).toBe('Pengujian gagal (429)');
 expect(translate('en','Test failed ({0})',{0:429})).toBe('Test failed (429)');
 expect(translate('id','codex/gpt-test')).toBe('codex/gpt-test');
});
