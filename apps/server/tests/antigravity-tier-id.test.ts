import {expect,test} from 'bun:test';
import {applyClaudeEffortVariant} from '../open-sse/handlers/chatCore/claudeEffortVariant';
test('Antigravity native Claude tier remains part of upstream model identity',()=>{
 const body={model:'claude-sonnet-5-5-low'};
 expect(applyClaudeEffortVariant({provider:'antigravity',effectiveModel:body.model,body,sourceFormat:'openai'}).effectiveModel).toBe('claude-sonnet-5-5-low');
 expect(body.model).toBe('claude-sonnet-5-5-low');
});
