import {mock} from 'bun:test';
import {Database} from 'bun:sqlite';
const db=new Database(':memory:');
db.exec('CREATE TABLE key_value (namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY(namespace,key))');
// Deliberately fail closed if an unexpected DB path is required.
mock.module('../src/lib/db/core.ts',()=>({getDbInstance:()=>db,getDb:()=>db,objToSnake:()=>undefined,cleanNulls:()=>undefined,SQLITE_FILE:()=>undefined,getOpenDbInstance:()=>undefined,DB_BACKUPS_DIR:()=>undefined,applyDatabaseOptimizationSettings:()=>undefined,isCloud:()=>undefined,DATA_DIR:()=>undefined,rowToCamel:()=>undefined,isBuildPhase:()=>undefined}));
globalThis.fetch=async()=>{throw Error('network forbidden fixture')};
const {openaiToAntigravityRequest}=await import('../open-sse/translator/request/openai-to-gemini.ts');
import {expect} from 'bun:test';
for(const tier of ['low','medium','high','xhigh']){
const model='gemini-4-hydrogen-'+tier;
for(const budget of [32,1024,4096]){
const value=openaiToAntigravityRequest(model,{model,messages:[{role:'user',content:'Synthetic fixture.'}],max_tokens:budget},false,{projectId:'fixture-project',providerSpecificData:{clientProfile:'hub'}});
expect(value.model).toBe(model);
expect(value.request.generationConfig.maxOutputTokens).toBe(budget);
expect(value.request.generationConfig.thinkingConfig).toBeUndefined();
}}
for(const effort of ['low','medium','high','xhigh']) {
const model='gemini-4-hydrogen-'+effort;
const v=openaiToAntigravityRequest(model,{messages:[{role:'user',content:'Fixture'}],max_tokens:4096,reasoning_effort:effort,tools:[{type:'function',function:{name:'lookup',parameters:{type:'object',properties:{id:{type:'string'}},required:['id']}}}]},false,{projectId:'fixture-project'});
expect(v.request.generationConfig.maxOutputTokens).toBe(4096);
expect(v.request.generationConfig.thinkingConfig).toBeUndefined();
expect(v.request.tools[0].functionDeclarations[0].name).toBe('lookup');
}
console.log('Hydrogen tier/budget/effort/tool fixtures passed');
