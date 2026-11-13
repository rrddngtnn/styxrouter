import {test, expect} from 'bun:test';
import {openaiToAntigravityRequest as after} from '../open-sse/translator/request/openai-to-gemini.ts';
import {openaiToAntigravityRequest as before} from '../open-sse/translator/request/hydrogen-baseline.fixture.ts';
const clean = (v) => { delete v.requestId; delete v.request.sessionId; return JSON.stringify(v); };
test('45 legacy converter cases remain identical', () => {
let n=0;
for(const model of ['gemini-2.5-pro','gemini-3-flash','gemini-3.8-flash-high','gemini-4-argon-high','claude-sonnet-4-5'])for(const effort of [undefined,'low','high'])for(const max_tokens of [undefined,32,4096]){
const body={model,messages:[{role:'user',content:'Fixture'}],max_tokens,reasoning_effort:effort};
const creds={projectId:'fixture-project'};
expect(clean(after(model,body,false,creds))).toBe(clean(before(model,body,false,creds)));n++;
}expect(n).toBe(45);
});
