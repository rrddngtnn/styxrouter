import "./helpers/test-secrets";
import {expect,test} from "bun:test";
test("resolved alias cannot bypass blocked wire model", async () => {
 const {setMitmAliasAll}=await import("../src/lib/db/models/mitmAlias.ts");
 const {createProviderConnection}=await import("../src/lib/db/providers.ts");
 const {createApiKey,updateApiKeyPermissions}=await import("../src/lib/db/apiKeys.ts");
 await setMitmAliasAll("antigravity",{"test-alias":"antigravity/test-wire"});
 await createProviderConnection({provider:"antigravity",authType:"oauth",accessToken:"synthetic",projectId:"synthetic",isActive:true} as any);
 const key=await createApiKey("independent","test");
 await updateApiKeyPermissions(key.id,{blockedModels:["antigravity/test-wire"]});
 const wire:string[]=[]; const old=globalThis.fetch;
 globalThis.fetch=(async (url,init)=>{ if(String(url).includes("auto-updater")) return Response.json([{version:"1.0.0"}]); if(String(url).includes(":streamGenerateContent")) wire.push(JSON.parse(await new Response(init?.body as BodyInit).text()).model); return new Response('data: {"response":{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}}\n\n',{status:200,headers:{"content-type":"text/event-stream"}}); }) as typeof fetch;
 try {const {handleChat}=await import("../src/sse/handlers/chat.ts"); const r=await handleChat(new Request("http://localhost/v1/chat/completions",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${key.key}`},body:JSON.stringify({model:"antigravity/test-alias",messages:[{role:"user",content:"hi"}],stream:true})})); await r.text(); expect(wire).toEqual([]); } finally {globalThis.fetch=old;}
},30000);
