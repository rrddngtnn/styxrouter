import { test, expect } from 'bun:test';
import { createProviderNode, createProviderConnection, updateProviderConnection } from '../src/lib/db/providers';
import { updateSettings } from '../src/lib/db/settings';
import { initTranslators } from '../open-sse/translator/index';
import { handleChat } from '../src/sse/handlers/chat';
import { resolveSessionAffinityTtlMs } from '../src/sse/services/sessionAffinityPin';
import { getSessionAccountAffinity, upsertSessionAccountAffinity } from '../src/lib/db/sessionAccountAffinity';

test('real loopback HTTP dispatch sticks and fails over after account becomes unavailable', async () => {
 await initTranslators();
 const node:any = await createProviderNode({type:'openai-compatible',name:'affinityreview',prefix:'affinityreview',apiType:'chat',baseUrl:'https://affinityreview.example/v1'});
 const a:any = await createProviderConnection({provider:node.id,authType:'apikey',apiKey:'fixture-a',name:'a',priority:1,isActive:true,providerSpecificData:{prefix:'affinityreview',apiType:'chat',baseUrl:'https://affinityreview.example/v1'}} as any);
 const b:any = await createProviderConnection({provider:node.id,authType:'apikey',apiKey:'fixture-b',name:'b',priority:2,isActive:true,providerSpecificData:{prefix:'affinityreview',apiType:'chat',baseUrl:'https://affinityreview.example/v1'}} as any);
 const realFetch=globalThis.fetch; const calls:string[]=[];
 globalThis.fetch = (async (url:any,opts:any) => { if (!String(url).startsWith('https://affinityreview.example/')) return realFetch(url,opts); calls.push(new Headers(opts.headers).get('authorization')!); const body=JSON.parse(opts.body); return Response.json({id:'fixture',object:'chat.completion',model:body.model,choices:[{index:0,message:{role:'assistant',content:'ok'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}); }) as typeof fetch;
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:handleChat});
 const request=async()=>{const r=await realFetch(`http://127.0.0.1:${server.port}/v1/chat/completions`,{method:'POST',headers:{'content-type':'application/json','x-session-id':'independent-review'},body:JSON.stringify({model:'affinityreview/fixture',stream:false,messages:[{role:'user',content:'hi'}]})}); const t=await r.text(); expect([r.status,t]).toEqual([200,expect.any(String)]);};
 try { await request(); await request(); expect(calls).toEqual(['Bearer fixture-a','Bearer fixture-a']); await updateProviderConnection(a.id,{isActive:false}); await request(); await request(); expect(calls).toEqual(['Bearer fixture-a','Bearer fixture-a','Bearer fixture-b','Bearer fixture-b']); expect(b.id).not.toBe(a.id); } finally { server.stop(true); globalThis.fetch=realFetch; }
},60000);

test('expiration and explicit persisted zero', async()=>{ const ttl=1800000; upsertSessionAccountAffinity('expiry-review','fixture','a',1000,ttl); expect(getSessionAccountAffinity('expiry-review','fixture',ttl,1800999)?.connectionId).toBe('a'); expect(getSessionAccountAffinity('expiry-review','fixture',ttl,1801000)).toBeNull(); await updateSettings({sessionAffinityTtlMs:0}); const {getSettings}=await import('../src/lib/db/settings'); expect(resolveSessionAffinityTtlMs('fixture',{},await getSettings())).toBe(0); });

test('explicit request zero disables a positive setting',()=>{ expect(resolveSessionAffinityTtlMs('fixture',{sessionAffinityTtlMs:0},{sessionAffinityTtlMs:1800000})).toBe(0); });
