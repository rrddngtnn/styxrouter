import './helpers/test-secrets';
import { test, expect } from 'bun:test';
import { OpencodeExecutor } from '../open-sse/executors/opencode';
import { PROVIDER_MODELS } from '../open-sse/config/providerModels';
import { translateRequest } from '../open-sse/translator/index';

test('existing translators and executor dispatch native protocol bodies, exact IDs, tools and errors',async()=>{
 const original=globalThis.fetch;
 const prior=PROVIDER_MODELS['opencode-go'];
 try {
 for(const [format,path] of [['openai','openai/v1/chat/completions'],['openai-responses','openai/v1/responses'],['claude','anthropic/v1/messages'],['gemini','google/v1beta/models/Exact.Model:generateContent']]){
  PROVIDER_MODELS['opencode-go']=[...prior,{id:'Exact.Model',name:'Fixture',targetFormat:format}];
  let calls=0;
  globalThis.fetch=(async(input,init)=>{
   calls++;expect(String(input)).toBe(`https://opencode.ai/inference/go/${path}`);
   expect(init?.method).toBe('POST');expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic');
   const body=JSON.parse(typeof init?.body==='string'?init.body:new TextDecoder().decode(init?.body as Uint8Array));
   if(format!=='gemini')expect(body.model).toBe('Exact.Model');
   expect(Array.isArray(body[format==='openai-responses'?'input':format==='gemini'?'contents':'messages'])).toBe(true);
   expect(body.tools?.length).toBe(1);
   return Response.json({error:{message:'fixture permission denial'}},{status:403});
  }) as typeof fetch;
  const body=translateRequest('openai',format,'Exact.Model',{model:'Exact.Model',messages:[{role:'user',content:'synthetic coding test'}],max_tokens:64,tools:[{type:'function',function:{name:'read_file',parameters:{type:'object',properties:{}}}}]},false,{apiKey:'synthetic'},'opencode-go');
  const result=await new OpencodeExecutor('opencode-go').execute({model:'Exact.Model',body,credentials:{apiKey:'synthetic'},stream:false,skipUpstreamRetry:true});
  expect(result.response.status).toBe(403);expect(calls).toBe(1);
 }
 }finally{globalThis.fetch=original;PROVIDER_MODELS['opencode-go']=prior;}
});
