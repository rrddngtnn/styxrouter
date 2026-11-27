import './helpers/test-secrets';
import { expect,test } from 'bun:test';
import { AntigravityExecutor } from '../open-sse/executors/antigravity.ts';
import { openaiToAntigravityRequest } from '../open-sse/translator/request/openai-to-gemini.ts';
import { setParamFilterConfig,deleteParamFilterConfig } from '../src/lib/db/paramFilters.ts';
test('actual final fetch serializes exact Hydrogen tiers with omitted/explicit/blocked budgets',async()=>{
 const saved=globalThis.fetch;
 let captured:any;
 globalThis.fetch=(async(input,init)=>{
  const url=String(input instanceof Request?input.url:input);
  if(url.includes('auto-updater'))return Response.json([{version:'2.31.2'}]);
  if(!url.includes(':streamGenerateContent')&&!url.includes(':generateContent'))throw new Error('unexpected fixture transport');
  captured=JSON.parse(await new Response(init?.body as BodyInit).text());
  return new Response('data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"OK"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1,"totalTokenCount":2}}}\n\n',{headers:{'content-type':'text/event-stream'}});
 }) as typeof fetch;
 try{
  for(const tier of ['low','medium','high','xhigh'])for(const stream of [false,true])for(const budget of [undefined,4096,32768]){
   const model=`gemini-4-hydrogen-${tier}`;
   const body=openaiToAntigravityRequest(model,{messages:[{role:'user',content:'fixture'}],...(budget===undefined?{}:{max_tokens:budget})},stream,{projectId:'fixture-project'});
   const result=await new AntigravityExecutor().execute({model,body,stream,credentials:{accessToken:'synthetic-fixture',projectId:'fixture-project',providerSpecificData:{clientProfile:'hub'}}} as any);
   expect(result.response.status).toBe(200);await result.response.text();
   expect(captured.model).toBe(model);
   expect(captured.request.generationConfig.maxOutputTokens).toBe(budget??32768);
   expect(captured.request.generationConfig.thinkingConfig).toBeUndefined();
  }
  const model='gemini-4-hydrogen-low';
  setParamFilterConfig('antigravity',{block:[],allow:[],models:{[model]:{block:['max_tokens']}}});
  const body=openaiToAntigravityRequest(model,{messages:[]},false,{projectId:'fixture-project'});
  const result=await new AntigravityExecutor().execute({model,body,stream:false,credentials:{accessToken:'synthetic-fixture',projectId:'fixture-project',providerSpecificData:{clientProfile:'hub'}}} as any);
  await result.response.text();expect(captured.request.generationConfig.maxOutputTokens).toBeUndefined();
 }finally{deleteParamFilterConfig('antigravity');globalThis.fetch=saved;}
});
