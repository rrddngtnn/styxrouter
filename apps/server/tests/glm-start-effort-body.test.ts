import {test,expect} from 'bun:test';
import {GlmExecutor} from '../open-sse/executors/glm';
import {initTranslators} from '../open-sse/translator';
test('Start Plan max uses Anthropic output_config effort and matched thinking budget',()=>{
 initTranslators(); const e=new GlmExecutor('glm');
 const body:any=e.transformForTransport('glm-5.3-max',{model:'glm-5.3-max',messages:[{role:'user',content:'hi'}],max_tokens:2048},false,{accessToken:'fixture-key',providerSpecificData:{planFamily:'start',zcodeJwtToken:'fixture-jwt',primaryTransport:'anthropic'}},'anthropic');
 expect(body.model).toBe('glm-5.3');
 expect(body.output_config?.effort).toBe('max');
 expect(body.thinking?.budget_tokens).toBe(32000);
 expect(body.max_tokens).toBeGreaterThan(32000);
 expect(body.effort).toBeUndefined();
});
