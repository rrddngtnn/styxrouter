import {expect} from 'bun:test';
const {getModelProbePolicy}=await import('../server/modelProbePolicy.ts');
for(const tier of ['low','medium','high','xhigh'])expect(getModelProbePolicy('antigravity/gemini-4-hydrogen-'+tier)).toEqual({maxTokens:32768,timeoutMs:60000});
for(const model of ['codex/gpt-5','opencode/glm','antigravity/claude-sonnet','antigravity/gemini-4-hydrogen-disabled','gemini/gemini-4-hydrogen','antigravity/gemini-4-carbon-high'])expect(getModelProbePolicy(model)).toEqual({maxTokens:8,timeoutMs:10000});
console.log('Hydrogen-only probe limits and unrelated preservation passed');
