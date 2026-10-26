import {expect,test} from 'bun:test';
import {readFileSync} from 'node:fs';
const read=(p:string)=>readFileSync(new URL('../src/'+p,import.meta.url),'utf8');
test('content styles never shrink normal copy below fourteen pixels',()=>{
 for(const file of ['pages/dashboard.css','pages/quota.css','pages/tools.css','components/catalog-controls.css','components/pagination.css']){
  const sizes=[...read(file).matchAll(/font-size:\s*([\d.]+)px/g)].map(m=>Number(m[1]));
  expect(sizes.every(n=>n>=14)).toBe(true);
 }
});
test('inline body labels do not override the readable content scale',()=>{
 for(const file of ['Routing','Providers','Activity','Settings','Login','Usage','Dashboard']){
  const sizes=[...read('pages/'+file+'.tsx').matchAll(/fontSize:\s*["']?([\d.]+)/g)].map(m=>Number(m[1]));
  expect(sizes.every(n=>n>=14)).toBe(true);
 }
});
