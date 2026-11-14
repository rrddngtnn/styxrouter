import { test, expect } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { poolCount, poolTarget, quotaView, QuotaWorkspaceTabs } from '../src/pages/Quota.tsx';
test('workspace query is whitelisted and does not consume free text',()=>{
 expect(quotaView('pools')).toBe('pools'); expect(quotaView('accounts')).toBe('accounts'); expect(quotaView('secret text')).toBe('accounts');
 const html=renderToStaticMarkup(<QuotaWorkspaceTabs view="pools" onChange={()=>{}} count={null}/>);
 expect(html).toContain('role="tablist"'); expect(html).toContain('Account Quota'); expect(html).toContain('Shared Pools'); expect(html).not.toContain('Shared Pools (0)');
});
test('pool count loading/error remain unknown, validated total and complete empty differ',()=>{
 expect(poolCount(null)).toBe(null); expect(poolCount({pools:[],total:0})).toBe(0);
 expect(poolCount({pools:[],total:12})).toBe(12); expect(poolCount({pools:[],total:-1})).toBe(0);
});
test('selection is explicit, deleted or disabled targets cannot submit; missing quota is not ineligibility',()=>{
 const inventory=[{id:'b',provider:'antigravity',name:'No observation',isActive:true},{id:'off',provider:'antigravity',isActive:false}];
 expect(poolTarget(inventory,'')).toBe(null); expect(poolTarget(inventory,'deleted')).toBe(null);
 expect(poolTarget(inventory,'off')).toBe(null); expect(poolTarget(inventory,'b')?.id).toBe('b');
});
