import {test,expect} from 'bun:test';
import {GlmExecutor} from '../open-sse/executors/glm';
test('Start Plan effort tiers never select coding transport',async()=>{
 const e:any=new GlmExecutor('glm');
 e.executeTransport=async(_input:any,transport:string)=>({response:new Response('{}'),transport});
 const r=await e.execute({model:'glm-5.3-max',credentials:{providerSpecificData:{planFamily:'start',zcodeJwtToken:'fixture-platform-jwt',primaryTransport:'anthropic'}},body:{},stream:false});
 expect(r.transport).toBe('anthropic');
});
