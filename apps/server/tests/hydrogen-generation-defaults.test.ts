import { expect, test, afterEach } from 'bun:test';
import { setParamFilterConfig, deleteParamFilterConfig } from '../src/lib/db/paramFilters.ts';
import { resolveGenerationBudget } from '../open-sse/services/generationBudgetPolicy.ts';
import { setModelCapabilityOverride, removeModelCapabilityOverride } from '../src/lib/db/modelCapabilityOverrides.ts';
afterEach(() => { delete process.env.STYX_GENERATION_DEFAULTS; removeModelCapabilityOverride('antigravity/gemini-4-hydrogen-low', 'max_output_tokens'); });
import { openaiToAntigravityRequest } from '../open-sse/translator/request/openai-to-gemini.ts';
import { getModelProbePolicy } from '../server/modelProbePolicy.ts';
globalThis.fetch = async () => { throw new Error('external network forbidden'); };
const model = 'gemini-4-hydrogen-low';
const wire = (body: Record<string, unknown> = {}, stream = false) => openaiToAntigravityRequest(model, {messages:[{role:'user',content:'Synthetic fixture.'}], ...body}, stream, {projectId:'fixture-project'});
test('Hydrogen intentionally replaces upstream omitted budget with 32768 for both transports', () => {
  for (const stream of [false,true]) {
    const value = wire({}, stream);
    expect(value.model).toBe(model);
    expect(value.request.generationConfig.maxOutputTokens).toBe(32768);
    expect(value.request.generationConfig.thinkingConfig).toBeUndefined();
  }
});
test('explicit caller budgets, including modern precedence and invalid zero, are never raised', () => {
  for (const budget of [0, 32, 4096, 32768]) expect(wire({max_tokens:budget}).request.generationConfig.maxOutputTokens).toBe(budget);
  expect(wire({max_tokens:32768,max_completion_tokens:4096}).request.generationConfig.maxOutputTokens).toBe(4096);
  expect(wire({max_tokens:999999}).request.generationConfig.maxOutputTokens).toBe(262144);
});
test('exact configured defaults and capability ceilings beat fallback', () => {
  process.env.STYX_GENERATION_DEFAULTS = JSON.stringify({models:{['antigravity/'+model]:8192}, fallbackMaxTokens:20000});
  expect(wire().request.generationConfig.maxOutputTokens).toBe(8192);
  expect(wire({max_tokens:4096}).request.generationConfig.maxOutputTokens).toBe(4096);
  setModelCapabilityOverride('antigravity/'+model,'max_output_tokens',2048);
  expect(wire().request.generationConfig.maxOutputTokens).toBe(2048);
  expect(wire({max_tokens:32768}).request.generationConfig.maxOutputTokens).toBe(2048);
});
test('configured fallback is scoped to Hydrogen, malformed config is ignored', () => {
  process.env.STYX_GENERATION_DEFAULTS = JSON.stringify({fallbackMaxTokens:12000});
  expect(wire().request.generationConfig.maxOutputTokens).toBe(12000);
  expect(openaiToAntigravityRequest('gemini-3-flash',{messages:[]},false).request.generationConfig.maxOutputTokens).toBeUndefined();
  process.env.STYX_GENERATION_DEFAULTS = '{';
  expect(wire().request.generationConfig.maxOutputTokens).toBe(32768);
});
test('generic policy preserves supported default, refuses unknown limits and caps fallback', () => {
  expect(resolveGenerationBudget({supportedDefault:4096,fallback:32768,hardLimit:32768})).toBe(4096);
  expect(resolveGenerationBudget({fallback:32768})).toBeUndefined();
  expect(resolveGenerationBudget({fallback:32768,hardLimit:1024})).toBe(1024);
  expect(resolveGenerationBudget({explicit:0,fallback:32768,hardLimit:32768})).toBe(0);
});
test('all exact tier IDs stay intact without numeric thinking', () => {
  for (const tier of ['low','medium','high','xhigh']) for (const stream of [true,false]) {
    const id = 'gemini-4-hydrogen-'+tier;
    const value = openaiToAntigravityRequest(id,{messages:[],reasoning_effort:'high'},stream);
    expect(value.model).toBe(id);
    expect(value.request.generationConfig.maxOutputTokens).toBe(32768);
    expect(value.request.generationConfig.thinkingConfig).toBeUndefined();
  }
});
test('existing per-model parameter block suppresses fallback reinjection', () => {
  try {
    setParamFilterConfig('antigravity',{block:[],allow:[],models:{[model]:{block:['max_tokens']}}});
    expect(wire().request.generationConfig.maxOutputTokens).toBeUndefined();
  } finally { deleteParamFilterConfig('antigravity'); }
});
test('actual converter to executor wire keeps intended 32K and explicit 4096 separately', async () => {
  const {AntigravityExecutor} = await import('../open-sse/executors/antigravity.ts');
  const executor = new AntigravityExecutor();
  const credentials = {projectId:'fixture-project',providerSpecificData:{clientProfile:'hub'}};
  for (const stream of [false,true]) for (const max_tokens of [undefined,4096]) {
    const converted = wire({max_tokens},stream);
    const value = await executor.transformRequest(model,converted,stream,credentials,model);
    expect(value.model).toBe(model);
    expect(value.request.generationConfig.maxOutputTokens).toBe(max_tokens ?? 32768);
    expect(value.request.generationConfig.thinkingConfig).toBeUndefined();
    // Print only the public wire policy fields, never persona or account metadata.
    console.log(JSON.stringify({model:value.model,stream,generationConfig:value.request.generationConfig}));
  }
});
test('Hydrogen panel probe increases 4096 to 32768 and retains 60 seconds', () => {
  expect(getModelProbePolicy('antigravity/'+model)).toEqual({maxTokens:32768,timeoutMs:60000});
});
