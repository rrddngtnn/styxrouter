import {expect,test} from 'bun:test';
import {ANTIGRAVITY_PUBLIC_MODELS,resolveAntigravityModelId} from '../open-sse/config/antigravityModelAliases';
test('Argon catalog publishes native low medium high tiers unchanged',()=>{
 for(const tier of ['low','medium','high']){
 const id=`gemini-4-argon-${tier}`;
 expect(ANTIGRAVITY_PUBLIC_MODELS.some(m=>m.id===id)).toBe(true);
 expect(resolveAntigravityModelId(id)).toBe(id);
 }
});
