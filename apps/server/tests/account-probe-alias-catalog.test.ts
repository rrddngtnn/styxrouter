import './helpers/test-secrets';
import {test,expect} from 'bun:test';
import {createProviderConnection} from '../src/lib/db/providers';
import {getDbInstance} from '../src/lib/db/core';
import {createProviderModelsApi} from '../server/providerModels';
test('account catalog preserves literal Codex effort IDs before resolving aliases',async()=>{
 const a:any=await createProviderConnection({provider:'codex',authType:'oauth',accessToken:'fixture-a'} as any);
 const b:any=await createProviderConnection({provider:'codex',authType:'oauth',accessToken:'fixture-b'} as any);
 const db=getDbInstance();
 for(const [id,models] of [[a.id,[{id:'gpt-6.1-terra',supportedThinkingEfforts:['high']}]], [b.id,[{id:'gpt-6.1-terra-high'}]]] as const)
  db.prepare('INSERT OR REPLACE INTO key_value(namespace,key,value) VALUES(?,?,?)').run('syncedAvailableModels',`codex:${id}`,JSON.stringify(models));
 const api=createProviderModelsApi();
 const data:any=await (await api.request(`http://fixture/providers/codex/models?connectionId=${a.id}`)).json();
 expect(data.catalogStatus).toBe('known');
 expect(data.models.some((m:any)=>m.id==='gpt-6.1-terra-high')).toBe(false);
 expect(data.models.some((m:any)=>m.id==='gpt-6.1-terra')).toBe(true);
});
