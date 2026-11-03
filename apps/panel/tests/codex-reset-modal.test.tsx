import { afterAll, expect, mock, test } from "bun:test";

// Bun's module mocks survive between test files, even after mock.restore(). Keep
// this hook-level harness in a child process rather than replacing React in the
// process that may also run react-dom rendering tests.
const inHarness = process.env.STYX_CODEX_RESET_MODAL_HARNESS === "1";
function isolatedTest(name: string, run: () => Promise<void>) {
  test(name, inHarness ? run : async () => {
    const child = Bun.spawn([
      process.execPath, "test", "--no-env-file", import.meta.path,
      "--test-name-pattern", `^${name}$`,
    ], {
      env: { ...process.env, STYX_CODEX_RESET_MODAL_HARNESS: "1" },
      stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect(exitCode, stdout + stderr).toBe(0);
    expect(stderr, stdout + stderr).toContain("1 pass");
  });
}

const slots: unknown[] = []; let cursor = 0;
let Quota: typeof import("../src/pages/Quota.tsx").Quota;
const row = (id: string) => ({ connectionId:id,name:id,provider:"codex",bankedResetCredits:5 });
let get: (url:string)=>Promise<unknown>; const posts: unknown[]=[]; let confirmResult=false; let confirmations=0;
if (inHarness) {
// Preserve React's internal exports: the real development JSX runtime needs
// them even though this harness replaces hooks to inspect the returned tree.
const actualReact = { ...await import("react") };
mock.module("react", () => ({ ...actualReact, useState: (initial: unknown) => { const i=cursor++; if (!(i in slots)) slots[i]=initial; return [slots[i], (v: unknown) => { slots[i]=typeof v === "function" ? v(slots[i]) : v; }]; }, useRef: (v: unknown) => { const i=cursor++; return slots[i] ?? (slots[i]={current:v}); }, useMemo: (fn: () => unknown) => fn() }));
mock.module("../src/lib/preferences.tsx", () => ({ usePreferences: () => ({ t: (s: string) => s, language:"en" }) }));
mock.module("../src/lib/useFetch.ts", () => ({useFetch: () => ({status:"ok",data:{providers:[row("a"),row("b")]},reload:()=>{}})}));
mock.module("../src/lib/api.ts",()=>({api:{get:(url:string)=>get(url),post:async (_:string,body:unknown)=>{posts.push(body);return {ok:true,outcome:"reset",quotaRefreshed:false};}}}));
mock.module("../src/lib/actions.tsx",()=>({Modal:()=>null}));
mock.module("sonner",()=>({toast:{success:()=>{},error:()=>{}}}));
afterAll(() => { mock.restore(); });
({ Quota } = await import("../src/pages/Quota.tsx"));
}
function render(){cursor=0;return Quota();}
function elements(node:any):any[]{if(!node||typeof node!=="object")return [];return [node,...[node.props?.children].flat(Infinity).flatMap(elements)];}
function button(tree:any,text:string){return elements(tree).find(e=>e.type==='button' && e.props.children===text);}
function open(tree:any,id:string){return elements(tree).find(e=>e.props?.onOpenResetCredits).props.onOpenResetCredits(row(id));}
function reset(){slots.length=0;posts.length=0;confirmations=0;(globalThis as any).window={confirm:()=>{confirmations++;return confirmResult;}};}
isolatedTest("failed inventory never enables spending cached positive inventory",async()=>{
 reset();get=async()=>{throw new Error('inventory unavailable');};await open(render(),'a');
 expect(button(render(),'Redeem earliest expiring credit').props.disabled).toBe(true);
});
isolatedTest("late account A inventory cannot overwrite account B modal",async()=>{
 reset();let resolveA!: (v:unknown)=>void;get=url=>url.includes('connectionId=a')?new Promise(r=>resolveA=r):Promise.resolve({ok:true,availableCount:1,credits:[{selectionToken:'b',title:'Credit B'}]});
 const a=open(render(),'a');await open(render(),'b');resolveA({ok:true,availableCount:1,credits:[{selectionToken:'a',title:'Credit A'}]});await a;
 expect(elements(render()).some(e=>e.type==='strong'&&e.props.children==='Credit B')).toBe(true);
});
isolatedTest("redemption asks explicit confirmation before any POST",async()=>{
 reset();confirmResult=false;get=async()=>({ok:true,availableCount:1,credits:[{selectionToken:'a'}]});await open(render(),'a');
 await button(render(),'Redeem this credit').props.onClick();await Promise.resolve();
 expect(confirmations).toBe(1);expect(posts).toHaveLength(0);
});
isolatedTest("two clicks before rerender send only one redemption",async()=>{
 reset();confirmResult=true;get=async()=>({ok:true,availableCount:1,credits:[{selectionToken:'a'}]});await open(render(),'a');
 const redeem=button(render(),'Redeem this credit').props.onClick;
 redeem();redeem();await Promise.resolve();await Promise.resolve();
 expect(posts).toHaveLength(1);expect(confirmations).toBe(1);
});
