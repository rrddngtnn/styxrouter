import {test, expect, spyOn} from 'bun:test';
import https from 'node:https';
import {PassThrough} from 'node:stream';
import {EventEmitter} from 'node:events';
import {createServer} from 'node:http';
import {augmentPinnedPost} from '../open-sse/services/augmentApiTransport';
import {runWithProxyContext} from '../open-sse/utils/proxyFetch';
import dns from 'node:dns';
import * as transport from '../src/shared/network/remoteImageFetch';
import {augmentPost, augmentTenantUrl} from '../open-sse/services/augmentApi';

test('tenant allowlist normalizes ASCII case/default port but rejects Unicode and parser-smuggled authority',()=>{
 expect(augmentTenantUrl('HTTPS://SECURITY-FIXTURE.API.AUGMENTCODE.COM:443/')).toBe(tenant);
 for(const value of ['https://security-fixture.api.augmentcode.com.evil.invalid','http://security-fixture.api.augmentcode.com','https://u:p@security-fixture.api.augmentcode.com','https://security-fixture.api.augmentcode.com:444','https://security-fixture.api.augmentcode.com/path','https://security-fixture.api.augmentcode.com?token=hidden','https://security-fixture.api.augmentcode.com#hidden','https://security-fixture.api.augmentcode.com.','https://ｓecurity-fixture.api.augmentcode.com','https://security-fixture。api.augmentcode.com','https://security-fixture.api.augmentcode.com\\\n','https://%73ecurity-fixture.api.augmentcode.com',`${tenant}\n`]) {
  expect(()=>augmentTenantUrl(value),value).toThrow('invalid_tenant_url');
 }
});

const tenant='https://security-fixture.api.augmentcode.com';
const token='synthetic-security-token';

test('private and mixed DNS answers never create credential-bearing transport', async()=>{
 const lookup=spyOn(dns.promises,'lookup');
 const pinned=spyOn(transport,'createPinnedFetch').mockImplementation((()=>async()=>Response.json({})) as any);
 // This fallback makes the old unsafe global-fetch implementation deterministic offline.
 const oldFetch=globalThis.fetch;
 globalThis.fetch=(async()=>Response.json({})) as typeof fetch;
 try {
  for(const address of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.0.1','169.254.169.254','100.100.100.200','0.0.0.0','224.0.0.1','240.0.0.1','198.18.0.1','192.0.2.1','198.51.100.1','203.0.113.1','::1','fe80::1','fd00:ec2::254','::ffff:169.254.169.254','::ffff:8.8.8.8','2001:db8::1','ff02::1']) {
   for(const mixed of [false,true]) {
    lookup.mockImplementation(async()=>[...(mixed?[{address:'8.8.8.8',family:4}]:[]),{address,family:address.includes(':')?6:4}] as any);
    await expect(augmentPost(tenant,token,'/get-models',{}),address).rejects.toThrow('upstream_destination_blocked');
   }
  }
  expect(pinned).not.toHaveBeenCalled();
 } finally {lookup.mockRestore();pinned.mockRestore();globalThis.fetch=oldFetch;}
});

// Real policy and pinned fetch run; only the HTTPS socket boundary is doubled.
// The double invokes Node's actual lookup option and models a changed resolver.
function socketFixture(status=200, location='https://credential-sink.invalid/') {
 let requests=0; let observed:any;
 const request=spyOn(https,'request').mockImplementation(((url:URL,options:any,callback:any)=>{
  requests++; observed={url:String(url),options};
  const req=new EventEmitter() as any;
  req.end=()=>queueMicrotask(()=>{
   options.lookup(url.hostname,{all:true},(error:unknown,answers:any)=>{
    observed.answers=answers;
    const response=new PassThrough() as any;
    response.statusCode=status;
    response.rawHeaders=['Content-Type','application/json',...(status===302?['Location',location]:[])];
    callback(response); response.end(status===302 ? undefined : '{}');
   });
  });
  req.destroy=(error:Error)=>req.emit('error',error);
  return req;
 }) as any);
 return {request,get requests(){return requests;},get observed(){return observed;}};
}

test('DNS rebind is pinned at socket lookup with original TLS hostname and no shared pool',async()=>{
 let lookups=0;
 const lookup=spyOn(dns.promises,'lookup').mockImplementation(async()=>{lookups++;return [{address:lookups===1?'8.8.8.8':'127.0.0.1',family:4}] as any;});
 const socket=socketFixture();
 try {
  expect((await augmentPost(tenant,token,'/get-models',{})).status).toBe(200);
  expect(lookups).toBe(1);
  expect(socket.observed.answers).toEqual([{address:'8.8.8.8',family:4}]);
  expect(socket.observed.url).toBe(`${tenant}/get-models`);
  expect(socket.observed.options.agent).toBe(false);
  expect(socket.observed.options.rejectUnauthorized).not.toBe(false);
  expect(socket.observed.options.headers.authorization).toBe(`Bearer ${token}`);
 }finally{lookup.mockRestore();socket.request.mockRestore();}
});

test('redirects never send Authorization to another destination and return redacted typed error',async()=>{
 const lookup=spyOn(dns.promises,'lookup').mockResolvedValue([{address:'8.8.8.8',family:4}] as any);
 const socket=socketFixture(302,`https://sink.invalid/?token=${token}`);
 try{
  let error:unknown;
  try{await augmentPost(tenant,token,'/get-models',{});}catch(e){error=e;}
  expect((error as Error).message).toBe('upstream_redirect_blocked');
  expect((error as {status:number}).status).toBe(502);
  expect(JSON.stringify(error)).not.toContain(token);expect(JSON.stringify(error)).not.toContain(tenant);
  expect(socket.requests).toBe(1);
 }finally{lookup.mockRestore();socket.request.mockRestore();}
});

test('configured environment proxy rejects before DNS or credential transport without bypass',async()=>{
 const previous=process.env.HTTPS_PROXY;
 process.env.HTTPS_PROXY='http://127.0.0.1:9';
 const lookup=spyOn(dns.promises,'lookup');const socket=socketFixture();
 try{
  await expect(augmentPost(tenant,token,'/get-models',{})).rejects.toThrow('unsupported_augment_proxy');
  expect(lookup).not.toHaveBeenCalled();expect(socket.requests).toBe(0);
 }finally{if(previous===undefined)delete process.env.HTTPS_PROXY;else process.env.HTTPS_PROXY=previous;lookup.mockRestore();socket.request.mockRestore();}
});

test('HTTP proxy and relay contexts fail closed before DNS and never reach redirecting local fixture',async()=>{
 let hits=0;
 const proxy=createServer((_req,res)=>{hits++;res.writeHead(302,{Location:'https://sink.invalid'});res.end();});
 await new Promise<void>(resolve=>proxy.listen(0,'127.0.0.1',resolve));
 const port=(proxy.address() as {port:number}).port;
 const lookup=spyOn(dns.promises,'lookup'); const socket=socketFixture();
 try {
  for(const config of [{type:'http',host:'127.0.0.1',port}, {type:'vercel',host:'127.0.0.1',port,relayAuth:'synthetic-relay-auth'}, {type:'deno',host:'127.0.0.1',port,relayAuth:'synthetic-relay-auth'}]) {
   let error:unknown;
   await runWithProxyContext(config,async()=>{try{await augmentPost(tenant,token,'/get-models',{});}catch(e){error=e;}});
   expect(error).toBeInstanceOf(Error);
   expect((error as Error).message).toBe('unsupported_augment_proxy');
   expect(JSON.stringify(error)).not.toContain(token);expect(JSON.stringify(error)).not.toContain(tenant);
  }
  expect(lookup).not.toHaveBeenCalled(); expect(socket.requests).toBe(0);expect(hits).toBe(0);
 }finally{lookup.mockRestore();socket.request.mockRestore();await new Promise<void>(resolve=>proxy.close(()=>resolve()));}
});

test('empty, malformed and invalid-family DNS results fail closed',async()=>{
 const lookup=spyOn(dns.promises,'lookup');const socket=socketFixture();
 try{
  for(const answers of [[],[{address:'not-an-ip',family:4}],[{address:'8.8.8.8',family:6}]]){
   lookup.mockResolvedValue(answers as any);
   await expect(augmentPost(tenant,token,'/get-models',{})).rejects.toThrow('upstream_destination_blocked');
  }
  expect(socket.requests).toBe(0);
 }finally{lookup.mockRestore();socket.request.mockRestore();}
});

test('DNS resolver deadline and caller abort cannot open transport',async()=>{
 const lookup=spyOn(dns.promises,'lookup').mockImplementation(()=>new Promise(()=>{}));const socket=socketFixture();
 try{
  await expect(augmentPinnedPost(`${tenant}/get-models`,{signal:AbortSignal.timeout(20)})).rejects.toThrow('upstream_destination_blocked');
  const abort=new AbortController();abort.abort();
  await expect(augmentPost(tenant,token,'/get-models',{},abort.signal)).rejects.toThrow('request_cancelled');
  expect(socket.requests).toBe(0);
 }finally{lookup.mockRestore();socket.request.mockRestore();}
});
