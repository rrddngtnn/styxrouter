import './helpers/test-secrets';
import {test,expect} from 'bun:test';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {stopTestProcess} from './helpers/stop-test-process';
function marker(proc:any, pattern:RegExp) {return new Promise<string>((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('startup timeout: '+text)),30000);proc.stdout.on('data',(x:any)=>{text+=x;const m=text.match(pattern);if(m){clearTimeout(timer);resolve(m[1]);}});proc.once('exit',()=>{clearTimeout(timer);reject(Error('early exit: '+text));});});}
test.skipIf(!process.env.PLAYWRIGHT_MODULE || !process.env.CHROMIUM_PATH)('browser account model control reaches the real Hono inference endpoint',async()=>{
 const {createProviderNode,createProviderConnection}=await import('../src/lib/db/providers');
 const {addCustomModel}=await import('../src/lib/db/models');
 const node:any=await createProviderNode({type:'openai-compatible',name:'Browser fixture',prefix:'accountprobe',apiType:'chat',baseUrl:'https://probe-fixture.invalid/v1'});
 const meta={baseUrl:node.baseUrl,apiType:'chat',prefix:'accountprobe'};
 await createProviderConnection({provider:node.id,authType:'apikey',apiKey:'wrong-fixture-key',priority:1,providerSpecificData:meta} as any);
 const account:any=await createProviderConnection({provider:node.id,authType:'apikey',apiKey:'upstream-fixture-secret',priority:20,providerSpecificData:meta} as any);
 await addCustomModel(node.id,'vendor/model');
 const browser=spawn('node',[join(import.meta.dir,'../../panel/tests/account-model-test.real.browser.mjs')],{env:{...process.env,NODE_ENV:'development',TMPDIR:process.env.STYX_BROWSER_TMPDIR || process.env.TMPDIR},stdio:['pipe','pipe','pipe']});
 let logs='';browser.stdout.on('data',x=>{logs+=x;process.stderr.write(x);});browser.stderr.on('data',x=>{logs+=x;process.stderr.write(x);});let server:any;
 try {
 const vite=await marker(browser,/VITE_READY:(\S+)\r?\n/);
 server=spawn(process.execPath,['--no-env-file',join(import.meta.dir,'helpers/provider-model-probe-server.ts')],{cwd:join(import.meta.dir,'..'),env:{...process.env,PANEL_FIXTURE_ORIGIN:vite,JWT_SECRET:'fixture-jwt-secret-01234567890123456789',INITIAL_PASSWORD:'fixture-password'},stdio:['ignore','pipe','pipe']});
 let serverLogs='';server.stdout.on('data',(x:any)=>serverLogs+=x);server.stderr.on('data',(x:any)=>serverLogs+=x);
 const port=await marker(server,/STYX_TEST_LISTENING:(\d+)\r?\n/);
 browser.stdin.write(JSON.stringify({base:`http://127.0.0.1:${port}`,provider:node.id,account:account.id})+'\n');
 const exit=await new Promise(resolve=>browser.once('close',resolve));
 expect({exit,logs}).toMatchObject({exit:0});
 expect(logs).toContain('PASS browser -> real session-authenticated Hono');
 expect(serverLogs).not.toContain('PROBE_SUCCESS_SENTINEL_9467');
 expect(serverLogs).not.toContain('upstream-fixture-secret');
 } finally {await stopTestProcess(browser);if(server)await stopTestProcess(server);}
},60000);
