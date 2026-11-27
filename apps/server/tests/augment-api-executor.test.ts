import './helpers/test-secrets';
import {test,expect,mock} from 'bun:test';
mock.module('../open-sse/services/augmentApiTransport',()=>({augmentPinnedPost:(url:string,init:RequestInit)=>globalThis.fetch(url,init)}));
import { AugmentApiExecutor } from '../open-sse/executors/augment-api.ts';
test('native executor discovers exact tenant model then translates native response',async()=>{
 const original=globalThis.fetch;const calls:{url:string;body:unknown}[]=[];
 globalThis.fetch=Object.assign(async(input: string|URL|Request,init?:RequestInit)=>{
  const url=String(input);calls.push({url,body:JSON.parse(String(init?.body))});expect(init?.redirect).toBe('error');
  return url.endsWith('/get-models') ? Response.json({feature_flags:{model_info_registry:'{"canonical":{"displayName":"Fixture"}}'}}) : new Response('{"text":"native output","nodes":[{"type":10,"token_usage":{"input_tokens":4,"output_tokens":2}}]}\n{"stop_reason":1}\n');
 },{preconnect:original.preconnect});
 try{const executor=new AugmentApiExecutor();
 const result=await executor.execute({model:'canonical',body:{messages:[{role:'user',content:'hello'}]},stream:false,credentials:{apiKey:'synthetic-test-key',providerSpecificData:{apiUrl:'https://fixture.api.augmentcode.com'}}});
 expect(result.response.status).toBe(200);expect(await result.response.json()).toMatchObject({choices:[{message:{content:'native output'},finish_reason:'stop'}],usage:{prompt_tokens:4,completion_tokens:2,total_tokens:6}});
 expect(calls.map(c=>c.url)).toEqual(['https://fixture.api.augmentcode.com/get-models','https://fixture.api.augmentcode.com/chat-stream']);expect(calls[1].body).toMatchObject({mode:'CLI_AGENT',model:'canonical',message:'hello',nodes:[{id:0,type:0,text_node:{content:'hello'}}]});
 const unknown=await executor.execute({model:'haiku4.5',body:{messages:[{role:'user',content:'x'}]},stream:false,credentials:{apiKey:'synthetic-test-key',providerSpecificData:{apiUrl:'https://fixture.api.augmentcode.com'}}});expect(unknown.response.status).toBe(400);expect(calls).toHaveLength(3);
 const bad=await executor.execute({model:'canonical',body:{max_tokens:4,messages:[]},stream:false,credentials:{apiKey:'synthetic-test-key',providerSpecificData:{apiUrl:'https://fixture.api.augmentcode.com'}}});expect(bad.response.status).toBe(400);expect(calls).toHaveLength(3);
 }finally{globalThis.fetch=original;}
});
