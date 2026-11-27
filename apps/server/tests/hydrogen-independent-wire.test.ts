import { expect, test } from 'bun:test';
import { openaiToAntigravityRequest } from '../open-sse/translator/request/openai-to-gemini.ts';
import { AntigravityExecutor } from '../open-sse/executors/antigravity.ts';
import { resolveAntigravityOutputCap } from '../open-sse/executors/antigravityOutputCap.ts';
const executor = new AntigravityExecutor();
globalThis.fetch = async () => { throw new Error('external network forbidden'); };
test('independent exact tier converter/executor outgoing budgets and legacy ceilings', async () => {
 for (const tier of ['low','medium','high','xhigh']) for (const stream of [false,true]) for (const budget of [undefined,4096,32768]) {
  const model = `gemini-4-hydrogen-${tier}`;
  const converted = openaiToAntigravityRequest(model,{messages:[],...(budget === undefined ? {} : {max_tokens:budget})},stream,{projectId:'fixture'});
  const actual = await executor.transformRequest(model,converted,stream,{projectId:'fixture',providerSpecificData:{clientProfile:'hub'}},model);
  expect(actual.model).toBe(model);
  expect(actual.request.generationConfig.maxOutputTokens).toBe(budget ?? 32768);
  expect(actual.request.generationConfig.thinkingConfig).toBeUndefined();
 }
 // The converter's established Claude bridge cap remains 16K; its known-model
 // executor ceiling is independently catalog-derived (65536 before this patch).
 expect(openaiToAntigravityRequest('claude-sonnet-4-6',{messages:[],max_tokens:32768},false).request.generationConfig.maxOutputTokens).toBe(16384);
 expect(resolveAntigravityOutputCap('claude-sonnet-4-6')).toBe(65536);
 expect(resolveAntigravityOutputCap('unknown-fixture')).toBe(16384);
 expect(resolveAntigravityOutputCap('gemini-4-hydrogen-ultra')).toBe(16384);
});
