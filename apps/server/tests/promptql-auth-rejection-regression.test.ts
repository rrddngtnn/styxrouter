import {expect, test} from "bun:test";
import {PromptQlExecutor} from "../open-sse/executors/promptql.ts";
const p=(x:unknown)=>Buffer.from(JSON.stringify(x)).toString("base64url");
const id="12345678-1234-4123-8123-123456789012";
const jwt=`${p({alg:"none"})}.${p({iss:"enrich-token",aud:"promptql.hasura.io","https://promptql.hasura.io":{"x-hasura-project-id":id}})}.synthetic`;
for (const status of [401,403]) test(`PromptQL executor stops on upstream ${status}`,async()=>{
 const original=globalThis.fetch; let calls=0;
 globalThis.fetch=(async()=>{calls++;return new Response(`synthetic-secret ${jwt}`,{status})}) as typeof fetch;
 try { const result=await new PromptQlExecutor().execute({model:"claude-sonnet-4",body:{messages:[{role:"user",content:"hello"}]},stream:false,credentials:{accessToken:jwt,providerSpecificData:{projectId:id,importedToken:true,nonRefreshable:true}}} as any); const text=await result.response.text(); expect(result.response.status).toBe(status); expect(calls).toBe(1); expect(text).not.toContain(jwt); expect(text).not.toContain("synthetic-secret"); } finally {globalThis.fetch=original}
});
