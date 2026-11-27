import './helpers/test-secrets';
import {test,expect} from 'bun:test';
import {OpencodeExecutor} from '../open-sse/executors/opencode';

test('base URL composition owns pathname only, preserves query, encodes model IDs and avoids endpoint duplication', () => {
 const e=new OpencodeExecutor('opencode-go');
 const cases:[string,string,string,string,boolean?][]=[
  ['openai','https://gateway.example/v1?tenant=abc','Exact.Model','https://gateway.example/v1/chat/completions?tenant=abc'],
  ['openai','https://gateway.example/v1/chat/completions/?tenant=abc','Exact.Model','https://gateway.example/v1/chat/completions?tenant=abc'],
  ['claude','https://gateway.example/p%2Fq/v1/?tenant=a%2Fb','Exact.Model','https://gateway.example/p%2Fq/v1/messages?tenant=a%2Fb'],
  ['openai-responses','https://gateway.example/v1/responses?tenant=abc','Exact.Model','https://gateway.example/v1/responses?tenant=abc'],
  ['gemini','https://gateway.example/v1beta?tenant=abc','models/a/b','https://gateway.example/v1beta/models/models%2Fa%2Fb:streamGenerateContent?tenant=abc&alt=sse',true],
  ['gemini','https://gateway.example/v1beta/models/Exact.Model:generateContent/?tenant=abc','Exact.Model','https://gateway.example/v1beta/models/Exact.Model:streamGenerateContent?tenant=abc&alt=sse',true],
  ['gemini','https://gateway.example/v1beta?alt=json&tenant=abc','Exact.Model','https://gateway.example/v1beta/models/Exact.Model:streamGenerateContent?alt=sse&tenant=abc',true],
  ['claude','https://opencode.ai/inference/go/?tenant=abc','Exact.Model','https://opencode.ai/inference/go/anthropic/v1/messages?tenant=abc'],
  ['openai','https://gateway.example/v1/?','Exact.Model','https://gateway.example/v1/chat/completions'],
 ];
 for(const [format,baseUrl,model,expected,stream] of cases){
  e._requestFormat=format;expect(e.buildUrl(model,!!stream,0,{providerSpecificData:{baseUrl}})).toBe(expected);
 }
});

test('fragment and malformed bases reject before any fetch without reflecting configuration secrets',async()=>{
 const e=new OpencodeExecutor('opencode-go');const original=globalThis.fetch;let calls=0;
 globalThis.fetch=(async()=>{calls++;return Response.json({});}) as typeof fetch;
 try{for(const baseUrl of ['https://gateway.example/v1#fragment-secret','https://gateway.example/v1#','not-a-url?token=secret']){
  let error:unknown;try{await e.execute({model:'fixture',body:{messages:[]},stream:false,credentials:{apiKey:'synthetic',providerSpecificData:{baseUrl}},skipUpstreamRetry:true});}catch(e){error=e;}
  expect(error).toBeInstanceOf(Error);expect((error as Error).message).toBe('Invalid OpenCode base URL: use an absolute HTTP(S) URL without a fragment');expect(calls).toBe(0);
 }}finally{globalThis.fetch=original;}
});
