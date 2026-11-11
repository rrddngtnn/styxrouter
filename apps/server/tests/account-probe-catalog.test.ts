import './helpers/test-secrets';
import { test, expect } from 'bun:test';
import { createProviderNode, createProviderConnection } from '../src/lib/db/providers';
import { addCustomModel } from '../src/lib/db/models';
import { createProviderModelsApi, accountProbeCapability } from '../server/providerModels';
import { getDbInstance } from '../src/lib/db/core';

test('account inventory restricts known catalogs and validates exact active provider ownership over HTTP', async () => {
 const node:any = await createProviderNode({type:'openai-compatible',name:'Catalog fixture',prefix:'catalogfixture',apiType:'chat',baseUrl:'https://never.invalid/v1'});
 const account:any = await createProviderConnection({provider:node.id,authType:'apikey',apiKey:'synthetic',isActive:true} as any);
 const other:any = await createProviderConnection({provider:'openai',authType:'apikey',apiKey:'synthetic',isActive:true} as any);
 const inactive:any = await createProviderConnection({provider:node.id,authType:'apikey',apiKey:'inactive-synthetic',isActive:false} as any);
 await addCustomModel(node.id,'vendor/allowed'); await addCustomModel(node.id,'vendor/sibling');
 const db=getDbInstance();
 db.prepare("INSERT OR REPLACE INTO key_value(namespace,key,value) VALUES(?,?,?)").run('syncedAvailableModels',`${node.id}:${account.id}`,JSON.stringify([{id:'vendor/allowed'}]));
 const app=createProviderModelsApi();
 const request=(id:string)=>app.request(`http://fixture/providers/${node.id}/models?connectionId=${id}`);
 const response=await request(account.id);const data:any=await response.json();
 expect(response.status).toBe(200);expect(data.catalogStatus).toBe('known');expect(data.models.map((m:any)=>m.id)).toEqual(['vendor/allowed']);
 expect((await request(other.id)).status).toBe(400);expect((await request(inactive.id)).status).toBe(400);expect((await request('missing')).status).toBe(400);
 expect((await accountProbeCapability(node.id,'catalogfixture/vendor/sibling',account.id)).supported).toBe(false);
 const unknown:any=await createProviderConnection({provider:node.id,authType:'apikey',apiKey:'unknown-synthetic'} as any);
 const unknownData:any=await (await request(unknown.id)).json();expect(unknownData.catalogStatus).toBe('unknown');expect(unknownData.models.length).toBe(2);
});
