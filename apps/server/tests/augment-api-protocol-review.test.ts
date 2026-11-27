import './helpers/test-secrets';
import {test,expect,mock} from 'bun:test';
mock.module('../open-sse/services/augmentApiTransport',()=>({augmentPinnedPost:(url:string,init:RequestInit)=>globalThis.fetch(url,init)}));
import {AugmentApiExecutor} from '../open-sse/executors/augment-api';
const credentials={apiKey:'FAKE-protocol-only',providerSpecificData:{apiUrl:'https://fixture.api.augmentcode.com'}};
async function run(text:string,body:Record<string,unknown>={},stream=false){
 const original=globalThis.fetch;
 globalThis.fetch=Object.assign(async(input:string|URL|Request)=>String(input).endsWith('/get-models')?Response.json({feature_flags:{model_info_registry:'{"Exact-Wire-ID":{}}'}}):new Response(text),{preconnect:original.preconnect});
 try{return await new AugmentApiExecutor().execute({model:'Exact-Wire-ID',body:{messages:[{role:'user',content:'fixture'}],...body},stream,credentials});}finally{globalThis.fetch=original;}
}
test('terminal frame is final, duplicate terminal and trailing content fail closed',async()=>{
 for(const text of ['{"stop_reason":1}\n{"text":"after"}\n','{"stop_reason":1}\n{"stop_reason":1}\n'])expect((await run(text)).response.status).toBe(502);
});
test('numeric terminal enums are strict rather than string-coerced',async()=>{expect((await run('{"stop_reason":"1"}\n')).response.status).toBe(502);});
test('invalid native mode and unrecognized caller options reject before transport',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=Object.assign(async()=>{calls++;throw Error('network forbidden');},{preconnect:original.preconnect});
 try{for(const extra of [{mode:'BAD'},{reasoning:{effort:'high'}},{max_new_tokens:4},{max_output_tokens:8},{max_tokens:8},{max_completion_tokens:8},{min_tokens:2},{min_p:0.1},{logit_bias:{'1':10}}]){const result=await new AugmentApiExecutor().execute({model:'Exact-Wire-ID',body:{messages:[],...extra},stream:false,credentials});expect(result.response.status).toBe(400);}expect(calls).toBe(0);}finally{globalThis.fetch=original;}
});
test('tool argument fragments accumulate preserving exact call identity',async()=>{
 const node=(args:string)=>JSON.stringify({nodes:[{type:5,tool_use:{tool_use_id:'call-fixture',tool_name:'lookup',input_json:args}}]})+'\n';
 const result=await run(node('{"q":')+node('"fixture"}')+'{"stop_reason":3}\n');
 expect(await result.response.json()).toMatchObject({choices:[{message:{tool_calls:[{id:'call-fixture',function:{name:'lookup',arguments:'{"q":"fixture"}'}}]}}]});
});
