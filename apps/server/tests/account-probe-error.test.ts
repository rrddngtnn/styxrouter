import {test,expect} from 'bun:test';
import {sanitizeProbeError} from '../server/modelProbeResult';
test('probe errors preserve diagnostic reason but remove credentials and verification URLs before truncation',()=>{
 const error=sanitizeProbeError('Quota exhausted; Bearer private-token; https://verify.invalid/?token=private-value; api_key=other-secret; '+ 'a'.repeat(500)+'exact-private-secret', ['exact-private-secret']);
 expect(error).toContain('Quota exhausted');
 for(const value of ['private-token','private-value','other-secret','exact-private-secret','https://verify']) expect(error).not.toContain(value);
 expect(error.length).toBeLessThanOrEqual(512);
});
