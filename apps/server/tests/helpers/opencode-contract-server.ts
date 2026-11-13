export {};
const original = globalThis.fetch;
const calls: unknown[] = [];
const cancelled: string[] = [];
globalThis.fetch = (async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (/^http:\/\/127\.0\.0\.1:\d+\//.test(url)) return original(input, init);
  if (!url.startsWith('https://opencode.ai/inference/')) throw Error('External traffic forbidden');
  const body = JSON.parse(typeof init?.body === 'string' ? init.body : new TextDecoder().decode(init?.body as Uint8Array));
  const headers = new Headers(init?.headers);
  calls.push({url, method: init?.method, model: body.model || decodeURIComponent(url.match(/models\/([^:]+)/)?.[1] || ""), body, auth: headers.get('authorization') === 'Bearer opencode-fixture-upstream', ua: headers.get('user-agent'), session: headers.get('x-opencode-session')});
  const nativeModel=body.model || decodeURIComponent(url.match(/models\/([^:]+)/)?.[1] || '');
  if(nativeModel.startsWith('fixture-') && /responses|messages|gemini/.test(nativeModel)) {
   const streaming=body.stream===true || url.includes('streamGenerateContent');
   const usage={cost:0,opencode:{billing_source:'go',allowance:0.01,list_cost:0.01}};
   const toolMode=JSON.stringify(body).includes('request-tool');
   const result = nativeModel==='fixture-responses'
    ? {id:'resp_fixture',object:'response',status:'completed',model:nativeModel,output:[{id:'msg_fixture',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'native completion',annotations:[]}]}],usage:{input_tokens:3,output_tokens:2,total_tokens:5,...usage}}
    : nativeModel==='fixture-messages'
    ? {id:'msg_fixture',type:'message',role:'assistant',model:nativeModel,content:[{type:'text',text:'native completion'}],stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:3,output_tokens:2,...usage}}
    : {candidates:[{content:{role:'model',parts:[{text:'native completion'}]},finishReason:'STOP',index:0}],usageMetadata:{promptTokenCount:3,candidatesTokenCount:2,totalTokenCount:5,...usage},modelVersion:nativeModel};
   if(toolMode) {
    if(nativeModel==='fixture-responses') (result as any).output=[{type:'function_call',id:'fc_fixture',call_id:'call_fixture',name:'read_file',arguments:'{"path":"fixture"}',status:'completed'}];
    if(nativeModel==='fixture-messages') { (result as any).content=[{type:'tool_use',id:'call_fixture',name:'read_file',input:{path:'fixture'}}];(result as any).stop_reason='tool_use'; }
    if(nativeModel==='fixture-gemini') (result as any).candidates[0].content.parts=[{thoughtSignature:'synthetic-fixture-thought-signature',functionCall:{name:'read_file',args:{path:'fixture'}}}];
   }
   if(!streaming) return Response.json(result);
   const events:any[]=nativeModel==='fixture-responses' ? [
    {type:'response.created',response:{...result,status:'in_progress',output:[]}},
    {type:'response.output_item.added',output_index:0,item:{id:'msg_fixture',type:'message',role:'assistant',content:[]}},
    {type:'response.content_part.added',item_id:'msg_fixture',output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}},
    {type:'response.output_text.delta',item_id:'msg_fixture',output_index:0,content_index:0,delta:'native completion'},
    {type:'response.output_text.done',item_id:'msg_fixture',output_index:0,content_index:0,text:'native completion'},
    {type:'response.output_item.done',output_index:0,item:(result as any).output[0]},
    {type:'response.completed',response:result}
   ] : nativeModel==='fixture-messages' ? [
    {type:'message_start',message:{...result,content:[],stop_reason:null,usage:{input_tokens:3,output_tokens:0}}},
    {type:'content_block_start',index:0,content_block:{type:'text',text:''}},
    {type:'content_block_delta',index:0,delta:{type:'text_delta',text:'native completion'}},
    {type:'content_block_stop',index:0},
    {type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:2,...usage}},
    {type:'message_stop'}
   ] : [result];
   if(toolMode) {
    if(nativeModel==='fixture-responses') events.splice(0,events.length,
     {type:'response.created',response:{...result,status:'in_progress',output:[]}},
     {type:'response.output_item.added',output_index:0,item:{...(result as any).output[0],arguments:''}},
     {type:'response.function_call_arguments.delta',item_id:'fc_fixture',output_index:0,delta:'{"path":"fixture"}'},
     {type:'response.function_call_arguments.done',item_id:'fc_fixture',output_index:0,arguments:'{"path":"fixture"}'},
     {type:'response.output_item.done',output_index:0,item:(result as any).output[0]},
     {type:'response.completed',response:result});
    if(nativeModel==='fixture-messages') events.splice(0,events.length,
     {type:'message_start',message:{...result,content:[],stop_reason:null,usage:{input_tokens:3,output_tokens:0}}},
     {type:'content_block_start',index:0,content_block:{type:'tool_use',id:'call_fixture',name:'read_file',input:{}}},
     {type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:'{"path":"fixture"}'}},
     {type:'content_block_stop',index:0},
     {type:'message_delta',delta:{stop_reason:'tool_use'},usage:{output_tokens:2,...usage}}, {type:'message_stop'});
   }
   if(JSON.stringify(body).includes('request-error')) {
    if(nativeModel==='fixture-responses') events.splice(events.length-1,1,{type:'response.failed',response:{id:'resp_fixture',status:'failed',error:{code:'server_error',message:'fixture late error'}}});
    else if(nativeModel==='fixture-messages') events.splice(events.length-2,2,{type:'error',error:{type:'overloaded_error',message:'fixture late error'}});
    else events.push({error:{code:503,status:'UNAVAILABLE',message:'fixture late error'}});
   }
   const text=events.map(e=>(e.type?'event: '+e.type+'\n':'')+'data: '+JSON.stringify(e)+'\n\n').join('');
   // Real byte-stream split frames, not one pre-parsed event per network chunk.
   const bytes=new TextEncoder().encode(text);let pos=0;
   return new Response(new ReadableStream({cancel(){cancelled.push(nativeModel)},pull(c){if(pos===bytes.length){if(JSON.stringify(body).includes('request-cancel'))return new Promise<void>(resolve=>init?.signal?.addEventListener('abort',()=>{cancelled.push(nativeModel);resolve()},{once:true}));c.close();return;} const end=Math.min(pos+7,bytes.length);c.enqueue(bytes.slice(pos,end));pos=end;}}),{headers:{'content-type':'text/event-stream'}});
  }
  if (body.model === 'fixture-denied') return Response.json({error:{message:'Permission denied',code:'permission_denied'}},{status:403});
  if (body.stream) return new Response('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:body.model,choices:[{index:0,delta:{role:'assistant',content:'fixture stream'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:body.model,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:3,completion_tokens:2,total_tokens:5,cost:0,opencode:{billing_source:'go',allowance:0.01,list_cost:0.01}}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  return Response.json({id:'fixture',object:'chat.completion',model:body.model,choices:[{index:0,message:{role:'assistant',content:'fixture completion'},finish_reason:'stop'}],usage:{prompt_tokens:3,completion_tokens:2,total_tokens:5}});
}) as typeof fetch;
const { PROVIDER_MODELS } = await import('../../open-sse/config/providerModels');
for(const [id,targetFormat] of [['fixture-responses','openai-responses'],['fixture-messages','claude'],['fixture-gemini','gemini']]) PROVIDER_MODELS['opencode-zen'].push({id,name:id,targetFormat});
const {default: config} = await import('../../server/styx.ts');
const runtime = globalThis as typeof globalThis & { Bun: { serve(options: any): { port: number } } };
const server = runtime.Bun.serve({...config, hostname:'127.0.0.1',port:0,fetch(request:Request){
  if(new URL(request.url).pathname === '/fixture/cancelled') return Response.json(cancelled);
  if(new URL(request.url).pathname === '/fixture/calls') return Response.json(calls);
  return config.fetch(request);
}});
console.log(`STYX_TEST_LISTENING:${server.port}`);
