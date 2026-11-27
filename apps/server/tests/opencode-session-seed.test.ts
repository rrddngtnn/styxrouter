import './helpers/test-secrets';
import {test,expect} from 'bun:test';
import {OpencodeExecutor} from '../open-sse/executors/opencode';
test('native histories seed from first user only and missing stable secret fails closed',()=>{
 const e=new OpencodeExecutor('opencode-go');
 const session=(body:any)=>e.buildHeaders({apiKey:'synthetic'},false,{authorization:'Bearer caller'},'fixture',undefined,body)['x-opencode-session'];
 for(const field of ['input','contents']) {
  const user=field==='input'?{role:'user',content:'original'}:{role:'user',parts:[{text:'original'}]};
  expect(session({[field]:[user]})).toBe(session({[field]:[user,{role:'assistant',content:'reply'},{role:'user',content:'next'}]}));
 }
 const saved=process.env.API_KEY_SECRET;delete process.env.API_KEY_SECRET;
 try {expect(()=>session({messages:[]})).toThrow('API_KEY_SECRET');}finally{process.env.API_KEY_SECRET=saved;}
});
