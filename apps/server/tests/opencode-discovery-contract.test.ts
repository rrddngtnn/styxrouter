import './helpers/test-secrets';
import { test, expect } from 'bun:test';
import { createModelSyncApi } from '../server/modelSync';
import { createProviderConnection } from '../src/lib/db/providers';
import { getSyncedAvailableModelsByConnection } from '../src/lib/db/models';

test('mounted catalog sync reaches existing Console provider and retains last-good on denial',async()=>{
 const conn:any=await createProviderConnection({provider:'opencode-zen',authType:'apikey',apiKey:'catalog-fixture',name:'Catalog fixture',isActive:true} as any);
 let denied=false;let malformed=false;let calls=0;
 const app=createModelSyncApi({fetch:(async(url,init)=>{calls++;expect(String(url)).toBe('https://opencode.ai/inference/v1/models');expect(new Headers(init?.headers).get('authorization')).toBe('Bearer catalog-fixture');return denied?Response.json({error:'permission denied'},{status:403}):Response.json({data:malformed?[]:[{id:'Exact.Model',name:'Presentation Only'}]});}) as typeof fetch});
 const sync=()=>app.request(`/providers/${conn.id}/sync-models`,{method:'POST'});
 expect((await sync()).status).toBe(200);
 expect((await getSyncedAvailableModelsByConnection('opencode-zen'))[conn.id]?.map(m=>m.id)).toEqual(['Exact.Model']);
 malformed=true;expect((await sync()).status).toBe(502);malformed=false;denied=true;expect((await sync()).status).toBe(502);expect(calls).toBe(3);
 expect((await getSyncedAvailableModelsByConnection('opencode-zen'))[conn.id]?.map(m=>m.id)).toEqual(['Exact.Model']);
});
