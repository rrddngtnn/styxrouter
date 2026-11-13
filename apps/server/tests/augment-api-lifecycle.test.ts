import './helpers/test-secrets';
import {test,expect,mock} from 'bun:test';
mock.module('../open-sse/services/augmentApiTransport',()=>({augmentPinnedPost:(url:string,init:RequestInit)=>globalThis.fetch(url,init)}));
import {AugmentApiExecutor} from '../open-sse/executors/augment-api';
import {augmentPost} from '../open-sse/services/augmentApi';
const credentials={apiKey:'synthetic-private-sentinel',providerSpecificData:{apiUrl:'https://fixture.api.augmentcode.com'}};
test('tools preserve IDs/history; missing usage stays absent; malformed terminal fails closed',async()=>{
 const original=globalThis.fetch;let responseText='';let outgoing:Record<string,unknown>={};
 globalThis.fetch=Object.assign(async(input:string|URL|Request,init?:RequestInit)=>{
  if(String(input).endsWith('/get-models'))return Response.json({feature_flags:{model_info_registry:'{"canonical":{}}'}});
  outgoing=JSON.parse(String(init?.body));return new Response(responseText);
 },{preconnect:original.preconnect});
 try{
 const executor=new AugmentApiExecutor();const run=(body:Record<string,unknown>,stream=false)=>executor.execute({model:'canonical',body,stream,credentials});
 responseText=JSON.stringify({nodes:[{type:5,tool_use:{tool_use_id:'call-1',tool_name:'read_file',input_json:'{"path":"fixture"}'}},{type:8,thinking:{content:'reasoning fixture'}}],stop_reason:3})+'\n';
 const first=await run({messages:[{role:'user',content:'tool please'}],tools:[{type:'function',function:{name:'read_file',parameters:{type:'object'}}}]});
 const result=await first.response.json() as {usage?:unknown;choices:{message:{tool_calls:unknown[];reasoning_content:string};finish_reason:string}[]};
 expect(result.usage).toBeUndefined();expect(result.choices[0].finish_reason).toBe('tool_calls');expect(result.choices[0].message.reasoning_content).toBe('reasoning fixture');
 responseText='{"text":"continued","stop_reason":1}\n';
 const next=await run({messages:[{role:'user',content:'tool please'},{role:'assistant',content:null,tool_calls:result.choices[0].message.tool_calls},{role:'tool',tool_call_id:'call-1',content:'caller executed result'}]});expect(next.response.status).toBe(200);
 expect(outgoing).toMatchObject({nodes:[{id:0,type:1,tool_result_node:{tool_use_id:'call-1',content:'caller executed result',is_error:false}}],chat_history:[{response_nodes:[{type:5,tool_use:{tool_use_id:'call-1'}}]}]});
 for(const text of ['{"text":"partial"}\n','{"stop_reason":99}\n','{"stop_reason":6}\n','{"text":"x"}\n{"error":{"message":"synthetic-private-sentinel"}}\n','[]\n','{"text":']){
  responseText=text;const failed=await run({messages:[{role:'user',content:'x'}]});expect(failed.response.status).toBe(502);expect(await failed.response.text()).not.toContain(credentials.apiKey);
 }
 responseText='{"text":"partial"}\n{"error":{"message":"synthetic-private-sentinel"}}\n';const late=await run({messages:[{role:'user',content:'x'}]},true);const lateText=await late.response.text();expect(lateText).toContain('upstream_stream_error');expect(lateText).not.toContain('[DONE]');expect(lateText).not.toContain(credentials.apiKey);
 }finally{globalThis.fetch=original;}
});
test('reader cancellation reaches upstream while read is pending',async()=>{
 const original=globalThis.fetch;let cancelled=false;let n=0;
 globalThis.fetch=Object.assign(async(input:string|URL|Request)=>String(input).endsWith('/get-models')?Response.json({feature_flags:{model_info_registry:'{"canonical":{}}'}}):new Response(new ReadableStream<Uint8Array>({pull(c){if(n++===0)c.enqueue(new TextEncoder().encode('{"text":"start"}\n'));},cancel(){cancelled=true;}})),{preconnect:original.preconnect});
 try{const result=await new AugmentApiExecutor().execute({model:'canonical',body:{messages:[{role:'user',content:'x'}]},stream:true,credentials});const reader=result.response.body!.getReader();await reader.read();await reader.cancel();expect(cancelled).toBe(true);}finally{globalThis.fetch=original;}
});
test('typed status errors never expose credential-bearing upstream error bodies',async()=>{
 const original=globalThis.fetch;
 try{for(const [status,code] of [[401,'upstream_authentication'],[403,'upstream_entitlement'],[429,'upstream_quota'],[503,'upstream_transient']] as const){
  globalThis.fetch=Object.assign(async()=>new Response(credentials.apiKey,{status}),{preconnect:original.preconnect});
  await expect(augmentPost(credentials.providerSpecificData.apiUrl,credentials.apiKey,'/get-models',{})).rejects.toThrow(code);
 }}finally{globalThis.fetch=original;}
});
