import {test,expect} from 'bun:test';
import {resolvePublicCred,decodePublicCred,encodePublicCred} from '../open-sse/utils/publicCreds';
test('embedded OAuth client identities remain valid after branding changes',()=>{
 for(const key of ['antigravity_id','gemini_id'] as const){
  expect(/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(resolvePublicCred(key))).toBe(true);
 }
 expect(resolvePublicCred('antigravity_alt').startsWith('GOCSPX-')).toBe(true);
 expect(resolvePublicCred('codex_id').startsWith('app_')).toBe(true);
 expect(/^[a-f0-9-]{36}$/.test(resolvePublicCred('claude_id'))).toBe(true);
});
test('masked overrides round trip',()=>{
 expect(decodePublicCred(encodePublicCred('fixture-public-client'))).toBe('fixture-public-client');
});
