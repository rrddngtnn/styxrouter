import './helpers/test-secrets';
import { test, expect } from 'bun:test';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { stopTestProcess } from './helpers/stop-test-process';

test('real isolated Hono routes OpenCode canonical ID, stream, tools and rejection without plan fallback', async () => {
 const {createProviderConnection} = await import('../src/lib/db/providers');
 const {createApiKey} = await import('../src/lib/db/apiKeys');
 const {updateSettings} = await import('../src/lib/db/settings');
 await updateSettings({call_log_pipeline_enabled:true});
 const connection: any = await createProviderConnection({provider:'opencode-zen',authType:'apikey',apiKey:'opencode-fixture-upstream',name:'Console fixture',isActive:true} as any);
 const key=(await createApiKey('opencode-fixture','test-machine')).key;
 const proc=spawn(process.execPath,['--no-env-file',join(import.meta.dir,'helpers/opencode-contract-server.ts')],{cwd:join(import.meta.dir,'..'),env:{...process.env,STYX_TEST_MODE:'1',STYX_DISABLE_TOKEN_HEALTHCHECK:'1',DISABLE_PROVIDER_LIMITS_AUTO_SYNC:'1'},stdio:['ignore','pipe','pipe']});
 let output='';proc.stdout!.on('data',x=>output+=x);proc.stderr!.on('data',x=>output+=x);
 try {
 const base=await new Promise<string>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(output)),30000);proc.stdout!.on('data',()=>{const m=output.match(/STYX_TEST_LISTENING:(\d+)\r?\n/);if(m){clearTimeout(timer);resolve(`http://127.0.0.1:${m[1]}`)}});proc.once('exit',()=>reject(Error(output)));});
 const request=(model:string,stream=false,authorized=true)=>fetch(base+'/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json',...(authorized?{authorization:`Bearer ${key}`} : {}),'x-styx-connection':connection.id,'x-opencode-session':'fixture-conversation','cache-control':'no-cache'},body:JSON.stringify({model,messages:[{role:'user',content:'synthetic coding fixture'}],tools:[{type:'function',function:{name:'read_file',parameters:{type:'object',properties:{}}}}],stream,max_tokens:12})});
 expect((await request('opencode-zen/fixture-model',false,false)).status).toBe(401);
 const response=await request('opencode-zen/fixture-model');expect(response.status).toBe(200);expect((await response.json()).choices[0].message.content).toBe('fixture completion');
 const stream=await request('opencode-zen/fixture-model',true);expect(stream.status).toBe(200);const streamed=await stream.text();expect(streamed).toContain('[DONE]');expect(streamed).toContain('prompt_tokens');expect(streamed).toContain('\"cost\":0');expect(streamed).toContain('\"allowance\":0.01');
 const calls:any[]=await (await fetch(base+'/fixture/calls')).json();
 expect(calls).toHaveLength(2);
 for(const call of calls){expect(call.url).toBe('https://opencode.ai/inference/openai/v1/chat/completions');expect(call.method).toBe('POST');expect(call.model).toBe('fixture-model');expect(call.auth).toBe(true);expect(call.ua).toBe('StyxRouter/1.0');expect(call.body.tools[0].function.name).toBe('read_file');}
 expect(calls[0].session).toBe(calls[1].session);
 const secondKey=(await createApiKey('opencode-fixture-second','test-machine')).key;
 const cross=await fetch(base+'/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+secondKey,'x-styx-connection':connection.id,'x-opencode-session':'fixture-conversation','x-styx-session-principal':key,'cache-control':'no-cache'},body:JSON.stringify({model:'opencode-zen/fixture-model',messages:[{role:'user',content:'synthetic second caller'}],max_tokens:12,stream:false})});expect(cross.status).toBe(200);await cross.text();
 const scoped:any[]=await(await fetch(base+'/fixture/calls')).json();expect(scoped).toHaveLength(3);expect(scoped[2].session).not.toBe(scoped[0].session);
 const denied=await request('opencode-zen/fixture-denied');expect(denied.status).toBe(502);expect((await denied.json()).error.code).toBe('UPSTREAM_AUTH_REJECTED');
 const after:any[]=await(await fetch(base+'/fixture/calls')).json();expect(after.filter(c=>c.model==='fixture-denied')).toHaveLength(1);expect(after.every(c=>!c.url.includes('/go/'))).toBe(true);
 const {getCallLogs,getCallLogById}=await import('../src/lib/usage/callLogs');
 let details:any[]=[];
 for(let attempt=0;attempt<100;attempt++){
  const rows=await getCallLogs({model:'fixture-model'});
  details=await Promise.all(rows.map((row:any)=>getCallLogById(row.id)));
  if(details.length>=3 && details.every(row=>row?.pipelinePayloads?.clientRawRequest))break;
  await Bun.sleep(20);
 }
 expect(details.length).toBeGreaterThanOrEqual(3);
 for(const detail of details){
  expect(detail.pipelinePayloads.clientRawRequest.headers['x-opencode-session']).toBe('[REDACTED]');
  expect(detail.pipelinePayloads.providerRequest).toBeDefined();
  expect(JSON.stringify(detail)).not.toContain('fixture-conversation');
 }
 expect(output).not.toContain('fixture-conversation');
 } finally {await stopTestProcess(proc)}
},60000);
