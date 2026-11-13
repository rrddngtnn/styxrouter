import {randomUUID} from 'node:crypto';
import { BaseExecutor, type ExecuteInput } from './base.ts';
import {AugmentError,assertAugmentParameters,record,discoverAugment,augmentPost,augmentFrames} from '../services/augmentApi.ts';

function payload(body:Record<string,unknown>,model:string,conversation:string){
 if(!Array.isArray(body.messages))throw new AugmentError('messages_required',400);
 let message='';let nodes:Record<string,unknown>[]=[];const history:Record<string,unknown>[]=[];
 for(const raw of body.messages){const m=record(raw);let text='';
  if(typeof m.content==='string')text=m.content;
  else if(Array.isArray(m.content))text=m.content.map(rawPart=>{const part=record(rawPart);if(part.type!=='text'||typeof part.text!=='string')throw new AugmentError('unsupported_content',400);return part.text;}).join('');
  else if(m.content!=null)throw new AugmentError('unsupported_content',400);
  if(m.role==='assistant'){
   const response:Record<string,unknown>[]=[];if(text)response.push({id:response.length,type:0,content:text});
   if(typeof m.reasoning_content==='string')response.push({id:response.length,type:8,thinking:{content:m.reasoning_content}});
   if(m.tool_calls!==undefined){if(!Array.isArray(m.tool_calls))throw new AugmentError('invalid_tool_history',400);for(const rawCall of m.tool_calls){const call=record(rawCall),fn=record(call.function);if(typeof call.id!=='string'||typeof fn.name!=='string'||typeof fn.arguments!=='string')throw new AugmentError('invalid_tool_history',400);response.push({id:response.length,type:5,tool_use:{tool_use_id:call.id,tool_name:fn.name,input_json:fn.arguments}});}}
   history.push({request_message:message,request_nodes:nodes,response_text:text,response_nodes:response});message='';nodes=[];
  }else if(m.role==='tool'){
   if(typeof m.tool_call_id!=='string'||!m.tool_call_id)throw new AugmentError('invalid_tool_history',400);
   nodes.push({id:nodes.length,type:1,tool_result_node:{tool_use_id:m.tool_call_id,content:text,is_error:false}});
  }else if(['system','developer','user'].includes(String(m.role))){
   if(m.role!=='user')text=`System: ${text}`;
   nodes.push({id:nodes.length,type:0,text_node:{content:text}});message+=(message?'\n':'')+text;
  }else throw new AugmentError('unsupported_role',400);
 }
 const definitions:Record<string,unknown>[]=[];
 if(body.tools!==undefined){if(!Array.isArray(body.tools))throw new AugmentError('invalid_tools',400);for(const raw of body.tools){const tool=record(raw);if(tool.type!=='function')throw new AugmentError('unsupported_tool',400);const fn=record(tool.function);if(typeof fn.name!=='string'||!fn.name||fn.strict!==undefined)throw new AugmentError('unsupported_tool',400);definitions.push({name:fn.name,description:typeof fn.description==='string'?fn.description:'',input_schema_json:JSON.stringify(record(fn.parameters))});}}
 return {mode:'CLI_AGENT',model,message,nodes,chat_history:history,conversation_id:conversation,...(definitions.length?{tool_definitions:definitions}:{})};
}
export class AugmentApiExecutor extends BaseExecutor {
 constructor(){super('augment-api',{format:'openai'});}
 async execute(input:ExecuteInput){
  const headers:Record<string,string>={};const url='augment-api://native';let requestBody:unknown={};
  try{
   const body=record(input.body);assertAugmentParameters(body);
   for(const key of ['mode','reasoning','max_new_tokens'])if(Object.hasOwn(body,key))throw new AugmentError(`unsupported_parameter:${key}`,400);
   // Stateless conversation IDs are unique per dispatch; never trust cross-key session headers.
   const conversation=randomUUID();requestBody=payload(body,input.model,conversation);
   const credentials=input.credentials;const apiUrl=credentials.providerSpecificData?.apiUrl;
   const assertCurrentConnection=async()=>{
    try {await credentials.augmentAuthorize?.();}catch{throw new AugmentError('caller_policy_revoked',403);}
    if(!credentials.connectionId)return; // Direct executor fixtures have no persisted account.
    const {getProviderConnectionById}=await import('../../src/lib/db/providers.ts');
    const current=await getProviderConnectionById(credentials.connectionId);
    if(!current || current.provider!=='augment-api' || !current.isActive || ['banned','expired','invalid','error'].includes(String(current.testStatus)) || current.apiKey!==credentials.apiKey || record(current.providerSpecificData??{}).apiUrl!==apiUrl)throw new AugmentError('connection_revoked',403);
   };
   await assertCurrentConnection();
   const models=await discoverAugment(apiUrl,credentials.apiKey,input.signal);
   if(!models.some(m=>m.id===input.model))throw new AugmentError('model_not_in_tenant_catalog',400);
   const cancellation=new AbortController();
   const signal=input.signal ? AbortSignal.any([input.signal,cancellation.signal]) : cancellation.signal;
   await assertCurrentConnection();
   const upstream=await augmentPost(apiUrl,credentials.apiKey,'/chat-stream',requestBody,signal);
   if(!upstream.body)throw new AugmentError('missing_upstream_body');
   const id=`chatcmpl-${randomUUID()}`,created=Math.floor(Date.now()/1000);const encoder=new TextEncoder();
   let content='',reasoning='',finish:string|null=null,usage:Record<string,number>|undefined;
   const tools:Record<string,unknown>[]=[];const seen=new Set<string>();
   const frame=(delta:Record<string,unknown>,reason:string|null=null)=>({id,object:'chat.completion.chunk',created,model:input.model,choices:[{index:0,delta,finish_reason:reason}],...(usage?{usage}:{})});
   const frames=augmentFrames(upstream.body,signal);
   async function* events(){
    for await(const chunk of frames){
     if(finish)throw new AugmentError('frame_after_terminal');
     if(chunk.error)throw new AugmentError('upstream_stream_error');
     if(typeof chunk.text==='string'&&chunk.text){content+=chunk.text;yield frame({content:chunk.text});}
     if(chunk.nodes!==undefined){if(!Array.isArray(chunk.nodes))throw new AugmentError('invalid_response_nodes');
      for(const raw of chunk.nodes){const node=record(raw);
       if(node.type===5){const tool=record(node.tool_use);if(typeof tool.tool_use_id!=='string'||typeof tool.tool_name!=='string'||typeof tool.input_json!=='string')throw new AugmentError('invalid_tool_response');
        if(!seen.has(tool.tool_use_id)){seen.add(tool.tool_use_id);const call={id:tool.tool_use_id,type:'function',function:{name:tool.tool_name,arguments:tool.input_json}};tools.push(call);yield frame({tool_calls:[{index:tools.length-1,...call}]});}
       else {const index=tools.findIndex(call=>call.id===tool.tool_use_id);const fn=tools[index].function as {name:string;arguments:string};if(fn.name!==tool.tool_name)throw new AugmentError('invalid_tool_response');fn.arguments+=tool.input_json;yield frame({tool_calls:[{index,function:{arguments:tool.input_json}}]});}
       }else if(node.type===8){const thinking=record(node.thinking);const text=thinking.content??thinking.summary;if(typeof text==='string'){reasoning+=text;yield frame({reasoning_content:text});}}
       else if(node.type===10){const tokens=record(node.token_usage);const a=tokens.input_tokens,b=tokens.output_tokens;
        usage={};if(typeof a==='number'&&Number.isSafeInteger(a)&&a>=0)usage.prompt_tokens=a;if(typeof b==='number'&&Number.isSafeInteger(b)&&b>=0)usage.completion_tokens=b;
        if(usage.prompt_tokens!==undefined&&usage.completion_tokens!==undefined)usage.total_tokens=usage.prompt_tokens+usage.completion_tokens;
        if(!Object.keys(usage).length)usage=undefined;
       }
      }
     }
     if(chunk.stop_reason!==undefined){if(typeof chunk.stop_reason!=='number')throw new AugmentError('unknown_stop_reason');finish=({1:'stop',2:'length',3:'tool_calls',4:'content_filter',5:'content_filter'} as Record<string,string>)[String(chunk.stop_reason)]??null;if(!finish)throw new AugmentError('unknown_stop_reason');}
    }
    if(!finish)throw new AugmentError('truncated_upstream_stream');
    yield frame({},finish);
   }
   if(input.stream){
    const iterator=events();
    const stream=new ReadableStream<Uint8Array>({async pull(controller){try{const next=await iterator.next();if(next.done){controller.enqueue(encoder.encode('data: [DONE]\n\n'));controller.close();}else controller.enqueue(encoder.encode(`data: ${JSON.stringify(next.value)}\n\n`));}catch{controller.enqueue(encoder.encode('data: {"error":{"code":"upstream_stream_error","message":"Augment stream failed"}}\n\n'));controller.close();await iterator.return(undefined);}},async cancel(){cancellation.abort();await iterator.return(undefined);}});
    return {response:new Response(stream,{headers:{'Content-Type':'text/event-stream'}}),url,headers,transformedBody:requestBody};
   }
   for await(const event of events())void event;
   return {response:Response.json({id,object:'chat.completion',created,model:input.model,choices:[{index:0,message:{role:'assistant',content,...(reasoning?{reasoning_content:reasoning}:{}),...(tools.length?{tool_calls:tools}:{})},finish_reason:finish}],...(usage?{usage}:{})}),url,headers,transformedBody:requestBody};
  }catch(error){const failure=error instanceof AugmentError?error:new AugmentError('invalid_augment_contract');return {response:Response.json({error:{code:failure.code,type:failure.status===400?'invalid_request_error':'upstream_error',message:failure.code}},{status:failure.status}),url,headers,transformedBody:requestBody};}
 }
}
