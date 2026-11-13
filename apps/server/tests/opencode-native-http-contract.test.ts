import './helpers/test-secrets';
import { test, expect } from 'bun:test';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { stopTestProcess } from './helpers/stop-test-process';

test('Hono translator chain consumes native JSON and split SSE through exact pinned Console target',async()=>{
 const {createProviderConnection}=await import('../src/lib/db/providers');const {createApiKey}=await import('../src/lib/db/apiKeys');
 const connection:any=await createProviderConnection({provider:'opencode-zen',authType:'apikey',apiKey:'opencode-fixture-upstream',name:'native fixture',isActive:true} as any);
 await createProviderConnection({provider:'opencode-zen',authType:'apikey',apiKey:'sibling-must-never-dispatch',name:'unselected sibling',isActive:true} as any);
 await createProviderConnection({provider:'opencode-go',authType:'apikey',apiKey:'other-plan-must-never-dispatch',name:'unselected plan',isActive:true} as any);
 const key=(await createApiKey('native-fixture','test-machine')).key;
 const proc=spawn(process.execPath,['--no-env-file',join(import.meta.dir,'helpers/opencode-contract-server.ts')],{cwd:join(import.meta.dir,'..'),env:{...process.env,STYX_DISABLE_TOKEN_HEALTHCHECK:'1',DISABLE_PROVIDER_LIMITS_AUTO_SYNC:'1'},stdio:['ignore','pipe','pipe']});
 let output='';proc.stdout!.on('data',x=>output+=x);proc.stderr!.on('data',x=>output+=x);
 try {
 const base=await new Promise<string>((resolve,reject)=>{const t=setTimeout(()=>reject(Error(output)),30000);proc.stdout!.on('data',()=>{const m=output.match(/STYX_TEST_LISTENING:(\d+)\r?\n/);if(m){clearTimeout(t);resolve('http://127.0.0.1:'+m[1])}});proc.once('exit',()=>reject(Error(output)))});
 for(const model of ['fixture-responses','fixture-messages','fixture-gemini']) for(const stream of [false,true]) {
 const r=await fetch(base+'/v1/chat/completions',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json','x-styx-connection':connection.id,'cache-control':'no-cache'},body:JSON.stringify({model:'opencode-zen/'+model,stream,max_tokens:12,messages:[{role:'user',content:'native fixture'}]})});
 const text=await r.text();expect({model,stream,status:r.status,text}).toMatchObject({status:200});expect(text).toContain('native completion');expect(text).toContain('prompt_tokens');expect(text).toContain('\"allowance\":0.01');if(stream)expect(text).toContain('[DONE]');
 }
 for(const model of ['fixture-responses','fixture-messages','fixture-gemini']) for(const stream of [false,true]) {
 const send=(messages:any[])=>fetch(base+'/v1/chat/completions',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json','x-styx-connection':connection.id,'x-opencode-session':'tool-roundtrip-'+model,'cache-control':'no-cache'},body:JSON.stringify({model:'opencode-zen/'+model,stream,max_tokens:12,messages,tools:[{type:'function',function:{name:'read_file',parameters:{type:'object',properties:{path:{type:'string'}}}}}]})});
 const messages:any[]=[{role:'user',content:'request-tool'}];
 const r=await send(messages);const text=await r.text();expect(r.status).toBe(200);
 let tool:any;
 if(stream) {
  const frames=text.split('\n').filter(l=>l.startsWith('data: {')).map(l=>JSON.parse(l.slice(6)));
  const pieces=frames.flatMap(f=>f.choices?.[0]?.delta?.tool_calls||[]);
  expect(pieces.some(p=>p.function?.name==='read_file')).toBe(true);
  tool={id:pieces.find(p=>p.id)?.id,type:'function',function:{name:'read_file',arguments:pieces.map(p=>p.function?.arguments||'').join('')}};
 } else tool=JSON.parse(text).choices[0].message.tool_calls[0];
 expect(tool.function.name).toBe('read_file');expect(JSON.parse(tool.function.arguments)).toEqual({path:'fixture'});
 // Remove trigger; the second upstream request must carry the actual tool result.
 messages[0].content='continue';messages.push({role:'assistant',content:null,tool_calls:[tool]},{role:'tool',tool_call_id:tool.id,name:'read_file',content:'fixture-tool-result'});
 const follow=await send(messages);expect(follow.status).toBe(200);expect(await follow.text()).toContain('native completion');
 }
 for(const [model,path,body] of [
 ['fixture-responses','/v1/responses',{input:[{role:'user',content:'native caller'}],max_output_tokens:12}],
 ['fixture-messages','/v1/messages',{messages:[{role:'user',content:'native caller'}],max_tokens:12}]
 ] as const) for(const stream of [false,true]) {
 const r=await fetch(base+path,{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json','x-styx-connection':connection.id,'cache-control':'no-cache'},body:JSON.stringify({...body,model:'opencode-zen/'+model,stream})});
 const text=await r.text();expect(r.status).toBe(200);expect(text).toContain('native completion');if(stream) expect(text).toContain(model==='fixture-responses'?'response.completed':'message_stop');
 }
 for(const model of ['fixture-responses','fixture-messages','fixture-gemini']) {
 const r=await fetch(base+'/v1/chat/completions',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json','x-styx-connection':connection.id,'cache-control':'no-cache'},body:JSON.stringify({model:'opencode-zen/'+model,stream:true,max_tokens:12,messages:[{role:'user',content:'request-error'}]})});
 const text=await r.text();expect(text).toContain('fixture late error');
 }
 for(const model of ['fixture-responses','fixture-messages','fixture-gemini']) {
 const abort=new AbortController();
 const r=await fetch(base+'/v1/chat/completions',{method:'POST',signal:abort.signal,headers:{authorization:'Bearer '+key,'content-type':'application/json','x-styx-connection':connection.id,'cache-control':'no-cache'},body:JSON.stringify({model:'opencode-zen/'+model,stream:true,max_tokens:12,messages:[{role:'user',content:'request-cancel'}]})});
 const reader=r.body!.getReader();await reader.read();abort.abort();await reader.cancel().catch(()=>{});
 }
 for(let n=0;n<40;n++) {const cancelled:string[]=await(await fetch(base+'/fixture/cancelled')).json();if(['fixture-responses','fixture-messages','fixture-gemini'].every(m=>cancelled.includes(m)))break;await new Promise(r=>setTimeout(r,25));}
 const cancelled:string[]=await(await fetch(base+'/fixture/cancelled')).json();for(const model of ['fixture-responses','fixture-messages','fixture-gemini'])expect(cancelled).toContain(model);
 const calls:any[]=await(await fetch(base+'/fixture/calls')).json();expect(calls).toHaveLength(28);expect(calls.filter(c=>JSON.stringify(c.body).includes('fixture-tool-result'))).toHaveLength(6);
 for(const c of calls.filter(c=>JSON.stringify(c.body).includes('fixture-tool-result'))) {
  if(c.model==='fixture-responses') expect(c.body.input.some((i:any)=>i.type==='function_call_output'&&i.call_id&&i.output==='fixture-tool-result')).toBe(true);
  if(c.model==='fixture-messages') expect(c.body.messages.some((m:any)=>Array.isArray(m.content)&&m.content.some((i:any)=>i.type==='tool_result'&&i.tool_use_id&&JSON.stringify(i.content).includes('fixture-tool-result')))).toBe(true);
  if(c.model==='fixture-gemini') expect(c.body.contents.some((m:any)=>m.parts?.some((i:any)=>i.functionResponse?.name==='read_file'&&JSON.stringify(i.functionResponse.response).includes('fixture-tool-result')))).toBe(true);
 }
for(const c of calls) {if(c.body.max_tokens!==undefined)expect(c.body.max_tokens).toBe(12);if(c.body.max_output_tokens!==undefined)expect(c.body.max_output_tokens).toBe(12);if(c.body.generationConfig?.maxOutputTokens!==undefined)expect(c.body.generationConfig.maxOutputTokens).toBe(12);}expect(calls.every(c=>c.auth&&!c.url.includes('/go/'))).toBe(true);for(const c of calls){expect(['fixture-responses','fixture-messages','fixture-gemini']).toContain(c.model);expect(c.url).toContain(c.model==='fixture-responses'?'/openai/v1/responses':c.model==='fixture-messages'?'/anthropic/v1/messages':'/google/v1beta/models/fixture-gemini:');}
 }finally{await stopTestProcess(proc)}
},60000);
