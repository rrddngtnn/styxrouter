import './helpers/test-secrets';
import { test, expect } from 'bun:test';
import { pickOpencodeBilling } from '../open-sse/utils/opencodeBilling';
import { extractUsage, filterUsageForFormat } from '../open-sse/utils/usageTracking';
import { sanitizeOpenAIResponse, sanitizeStreamingChunk, sanitizeResponsesApiResponse } from '../open-sse/handlers/responseSanitizer';
test('known Console billing survives sanitizers and normalization without copying raw metadata',()=>{
 const bill={cost:0,opencode:{billing_source:'go',allowance:0.01,list_cost:0.02,estimated:false,tokens:{input:3,output:2,reasoning:1},secret:'sentinel',balance:999},secret:'sentinel'};
 const usage={prompt_tokens:3,completion_tokens:2,total_tokens:5,...bill};
 const safe={cost:0,opencode:{billing_source:'go',allowance:0.01,list_cost:0.02,estimated:false,tokens:{input:3,output:2,reasoning:1}}};
 expect(pickOpencodeBilling(usage)).toEqual(safe);
 for(const output of [sanitizeOpenAIResponse({choices:[],usage}),sanitizeStreamingChunk({choices:[],usage}),sanitizeResponsesApiResponse({object:'response',output:[],usage:{input_tokens:3,output_tokens:2,...bill}})]) {
  expect((output as any).usage).toMatchObject(safe);expect(JSON.stringify(output)).not.toContain('sentinel');expect(JSON.stringify(output)).not.toContain('balance');
 }
 for(const event of [{usage},{type:'response.completed',response:{usage:{input_tokens:3,output_tokens:2,...bill}}},{type:'message_delta',usage:{output_tokens:2,...bill}},{usageMetadata:{promptTokenCount:3,candidatesTokenCount:2,...bill}}]) {
  const extracted=extractUsage(event as any);expect(extracted).toMatchObject(safe);expect(filterUsageForFormat(extracted,'openai')).toMatchObject(safe);
 }
 for(const invalid of [{cost:0.1},{cost:1,opencode:{billing_source:{toString:()=>"go"},allowance:1}},{cost:-1,opencode:{billing_source:'bogus',allowance:1}},{cost:NaN,opencode:{billing_source:'go',allowance:Infinity,list_cost:'1'}}]) {
  const safe=pickOpencodeBilling(invalid);expect(safe.cost).toBeUndefined();expect((safe.opencode as any)?.allowance).toBeUndefined();expect((safe.opencode as any)?.list_cost).toBeUndefined();
 }
});
