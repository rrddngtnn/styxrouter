import {test,expect} from 'bun:test';
import {resolveAntigravityModelId} from '../open-sse/config/antigravityModelAliases';
test('bare Argon maps to the callable medium tier',()=>{
 expect(resolveAntigravityModelId('gemini-4-argon')).toBe('gemini-4-argon-medium');
 expect(resolveAntigravityModelId('gemini-4-argon-high')).toBe('gemini-4-argon-high');
});
