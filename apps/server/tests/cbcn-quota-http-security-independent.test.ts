import { test, expect, spyOn } from 'bun:test';
import * as isolation from '../src/lib/exclusiveLeaseIsolation';
import { createProviderConnection } from '../src/lib/db/providers';
import { setProviderLimitsCache } from '../src/lib/db/providerLimits';
import { GET as quota } from '../src/app/api/usage/quota/route';
import { GET as live } from '../src/app/api/usage/[connectionId]/route';

const marker = 'synthetic-secret-http-independent-123';
test('real HTTP quota sanitizes upstream and legacy cache in unknown and stale states', async () => {
 const c = await createProviderConnection({provider:'codebuddy-cn',authType:'oauth',accessToken:'synthetic-token',isActive:true} as any);
 const upstream = Bun.serve({hostname:'127.0.0.1',port:0,fetch(){return Response.json({code:91,msg:marker});}});
 const server = Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){const u=new URL(req.url); return u.pathname === '/quota' ? quota(req) : live(req,{params:Promise.resolve({connectionId:c.id})});}});
 const original = globalThis.fetch;
 globalThis.fetch = ((input: any, init?: any) => String(input).startsWith('https://copilot.tencent.com/v2/billing/') ? original(`http://127.0.0.1:${upstream.port}/`,init) : original(input,init)) as typeof fetch;
 const logs:string[]=[]; const old=[console.log,console.warn,console.error] as const;
 console.log=console.warn=console.error=(...args:unknown[])=>{logs.push(args.map(String).join(' '));};
 try {
  const origin=`http://127.0.0.1:${server.port}`;
  const liveText=await (await fetch(`${origin}/live`)).text(); expect(liveText).not.toContain(marker);
  let text=await (await fetch(`${origin}/quota?connectionId=${c.id}`)).text(); expect(text).not.toContain(marker); expect(JSON.parse(text).providers[0].creditStatus).toBe('unknown');
  setProviderLimitsCache(c.id,{quotas:{Monthly:{used:2,total:10,displayName:marker,resetAt:marker}},plan:marker,message:marker,fetchedAt:new Date().toISOString(),refreshFailed:true});
  text=await (await fetch(`${origin}/quota?connectionId=${c.id}`)).text(); expect(text).not.toContain(marker); expect(JSON.parse(text).providers[0].creditStatus).toBe('stale');
  expect(logs.join('\n')).not.toContain(marker);
 } finally {globalThis.fetch=original; [console.log,console.warn,console.error]=old; server.stop(true); upstream.stop(true);}
});

test('real HTTP usage route does not expose thrown internal errors in response or free-text logs', async () => {
 const spy=spyOn(isolation,'isConnectionUnavailableToAuxiliaryActivity').mockImplementation(async()=>{throw new Error(marker);});
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){return live(req,{params:Promise.resolve({connectionId:'synthetic-id'})});}});
 const logs:string[]=[]; const old=[console.log,console.warn,console.error] as const;
 console.log=console.warn=console.error=(...args:unknown[])=>{logs.push(args.map(String).join(' '));};
 try {const response=await fetch(`http://127.0.0.1:${server.port}/`); expect(response.status).toBe(500); expect(await response.text()).not.toContain(marker); expect(logs.join('\n')).not.toContain(marker);}
 finally {spy.mockRestore(); [console.log,console.warn,console.error]=old; server.stop(true);}
});
