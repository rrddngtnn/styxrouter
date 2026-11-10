import './helpers/test-secrets';
import { test, expect } from 'bun:test';
import { accountProbeCapability } from '../server/providerModels';
test('account probe refuses a specialty compatible node before dispatch',async()=>{
 const {createProviderNode}=await import('../src/lib/db/providers');
 const {addCustomModel}=await import('../src/lib/db/models');
 const node:any=await createProviderNode({type:'openai-compatible',name:'Embedding fixture',prefix:'embeddingfixture',apiType:'embeddings',baseUrl:'https://never.invalid/v1'});
 await addCustomModel(node.id,'embed-model');
 expect(await accountProbeCapability(node.id,'embeddingfixture/embed-model')).toEqual({supported:false,reason:'unsupported_model_type'});
});
test('account probe refuses cross-provider and missing models',async()=>{
 expect((await accountProbeCapability('openai','codex/not-real')).supported).toBe(false);
 expect((await accountProbeCapability('openai','openai/not-real')).supported).toBe(false);
});
