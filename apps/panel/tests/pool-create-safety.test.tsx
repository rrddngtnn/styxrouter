import { expect, test } from 'bun:test';

for (const scenario of ['duplicate', 'unknown-remount', 'storage-denied', 'deleted-account', 'rejected', 'locale', 'success', 'malformed', 'auth-unknown']) {
  test(`pool create ${scenario}`, () => {
    const child = Bun.spawnSync([process.execPath, 'test', '--no-env-file', import.meta.path, '--test-name-pattern', '^harness$'], { env: { ...process.env, STYX_POOL_HARNESS: scenario }, stdout: 'pipe', stderr: 'pipe' });
    expect(child.exitCode, child.stdout.toString() + child.stderr.toString()).toBe(0);
  });
}
if (process.env.STYX_POOL_HARNESS) {
  const { mock } = await import('bun:test');
  const scenario = process.env.STYX_POOL_HARNESS;
  let language = 'en';
  const slots: any[] = []; let cursor = 0; const posts: any[] = [];
  const values = new Map<string,string>();
  const store = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { if (scenario === 'storage-denied') throw new Error('denied'); values.set(key,value); }, removeItem: (key: string) => values.delete(key) };
  (globalThis as any).window = { sessionStorage: store };
  const react = { ...await import('react') };
  mock.module('react', () => ({ ...react, useEffect: () => {}, useRef: (v: any) => { const i=cursor++; return slots[i] ?? (slots[i]={current:v}); }, useState: (v: any) => {const i=cursor++; if (!(i in slots)) slots[i]=typeof v==='function'?v():v;return [slots[i],(next:any)=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];} }));
  mock.module('../src/lib/preferences.tsx', () => ({ usePreferences: () => ({ language, t: (s:string) => s }) }));
  class ApiError extends Error { status=scenario==='auth-unknown'?401:400; }
  mock.module('../src/lib/api.ts', () => ({ ApiError, api: {
    get: async (path: string) => path === '/api/connections' ? { connections: scenario==='deleted-account'?[]:[{id:'a',provider:'test'}] } : { pools: [] },
    post: async (_path:string, body:any) => { posts.push(body); if(scenario==='rejected'||scenario==='auth-unknown') throw new ApiError('rejected'); if(scenario==='success') return {pool:{id:'new',connectionId:'a'}}; if(scenario==='malformed') return {pool:{}}; throw new Error('transport lost'); }
  } }));
  const { QuotaPoolsSection } = await import('../src/pages/Quota.tsx');
  const render = () => { cursor=0; return QuotaPoolsSection({active:true,onCount:()=>{},onDirty:()=>{}}); };
  const all = (n:any):any[] => !n||typeof n!=='object'?[]:[n,...[n.props?.children].flat(Infinity).flatMap(all)];
  const form = (tree:any) => all(tree).find(n=>n.type==='form');
  const field = (tree:any,label:string) => all(tree).find(n=>n.props?.['aria-label']===label);
  test('harness', async () => {
    let tree=render();
    const retry=all(tree).find(n=>n.type==='button'&&n.props.children==='Retry accounts');
    await retry.props.onClick();
    tree=render(); field(tree,'Pool name').props.onChange({target:{value:'private draft'}}); field(tree,'Primary account').props.onChange({target:{value:'a'}});
    tree=render(); const submit=form(tree).props.onSubmit; const event={preventDefault:()=>{}};
    await Promise.all([submit(event), submit(event)]);
    expect(posts.length).toBe(scenario==='storage-denied'||scenario==='deleted-account'?0:1);
    if(posts.length) expect(posts[0].connectionId).toBe('a');
    if(scenario==='unknown-remount') {
      slots.length=0; tree=render();
      await all(tree).find(n=>n.type==='button'&&n.props.children==='Retry accounts').props.onClick();
      tree=render(); field(tree,'Pool name').props.onChange({target:{value:'another draft'}}); field(tree,'Primary account').props.onChange({target:{value:'a'}});
      tree=render(); expect(all(tree).find(n=>n.type==='button'&&n.props.children==='Create pool').props.disabled).toBe(true);
      await form(tree).props.onSubmit(event); expect(posts.length).toBe(1); expect(values.size).toBe(1);
    }
    if(scenario==='rejected'||scenario==='success') expect(values.size).toBe(0);
    if(scenario==='malformed'||scenario==='auth-unknown') expect(values.size).toBe(1);
    if(scenario==='locale') { language='id'; tree=render(); expect(all(tree).some(n=>n.props?.role==='status' && String(n.props.children).includes('Pembuatan pool belum terkonfirmasi'))).toBe(true); }
  });
}
