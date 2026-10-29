import { test, expect } from "bun:test";
import { Hono } from "hono";
import { createAdminApi } from "../server/admin.ts";
import { GlmExecutor } from "../open-sse/executors/glm.ts";
import { initTranslators } from "../open-sse/translator";
import { getCachedZcodeVersion } from "../open-sse/services/zcodeVersion.ts";
import { getZcodeVersionPin, setZcodeVersionPin } from "../src/lib/db/zcodeVersionPin.ts";

const app = new Hono().route('/api', createAdminApi());
const put = (body: unknown) => app.request('/api/versions/zcode/pin', {method:'PUT', headers:{'content-type':'application/json'}, body:JSON.stringify(body)});

test('rejects malformed input without changing the pin', async () => {
  setZcodeVersionPin('1.2.3');
  for (const body of [{version:'1.2.3\r\nInjected: yes'}, {version:'1.2.3\n'}, {version:'1234567.1.1'}, {version:'1.2.3 '}, {version:1}, {version:{}}, {}, {version:null, extra:true}]) {
    expect((await put(body)).status).toBe(400);
    expect(getZcodeVersionPin()).toBe('1.2.3');
  }
});

test('executor sends pinned and cleared versions through real fetch path for coding and start', async () => {
  initTranslators();
  const original = globalThis.fetch;
  const seen: Array<{url:string, headers:Headers}> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({url:String(url), headers:new Headers(init?.headers)});
    return new Response('{}', {status:200, headers:{'content-type':'text/plain'}});
  }) as typeof fetch;
  try {
    const executor = new GlmExecutor('glm');
    for (const version of ['7.8.9', null] as const) {
      expect((await put({version})).status).toBe(200);
      const expected = version ?? getCachedZcodeVersion();
      for (const providerSpecificData of [{}, {planFamily:'start', zcodeJwtToken:'fixture-jwt'}]) {
        const result = await executor.execute({model:'glm-5.3', body:{model:'glm-5.3', messages:[{role:'user',content:'hello'}]}, stream:false, credentials:{apiKey:'fixture-key', providerSpecificData}} as any);
        expect(result.response.status).toBe(200);
        const request = seen.at(-1)!;
        expect(request.headers.get('x-zcode-app-version')).toBe(expected);
        expect(request.headers.get('user-agent')).toContain(expected);
        expect(request.url).toContain(providerSpecificData.planFamily === 'start' ? '/zcode-plan/' : '/coding/');
      }
    }
  } finally { globalThis.fetch = original; setZcodeVersionPin(null); }
});

test('pin survives process restart and competing processes observe committed changes', async () => {
  setZcodeVersionPin('3.4.5');
  const modulePath = new URL('../src/lib/db/zcodeVersionPin.ts', import.meta.url).pathname;
  const run = (code: string) => Bun.spawnSync([process.execPath, '-e', `import {getZcodeVersionPin,setZcodeVersionPin} from ${JSON.stringify(modulePath)}; ${code}`], {cwd:process.cwd(), env:process.env, stdout:'pipe', stderr:'pipe'});
  const read = run('console.log("PIN="+getZcodeVersionPin())');
  expect(read.exitCode).toBe(0);
  expect(read.stdout.toString()).toContain('PIN=3.4.5');
  const workers = await Promise.all(Array.from({length: 4}, (_, i) => {
    const child = Bun.spawn([process.execPath, '-e', `import {setZcodeVersionPin} from ${JSON.stringify(modulePath)}; for(let i=0;i<30;i++) setZcodeVersionPin('${i + 4}.5.6');`], {cwd:process.cwd(), env:process.env, stdout:'pipe', stderr:'pipe'});
    return child.exited;
  }));
  expect(workers).toEqual([0,0,0,0]);
  expect(['4.5.6','5.5.6','6.5.6','7.5.6']).toContain(getZcodeVersionPin());
  const clear = run('setZcodeVersionPin(null); console.log("PIN="+getZcodeVersionPin())');
  expect(clear.exitCode).toBe(0);
  expect(clear.stdout.toString()).toContain('PIN=null');
  expect(getZcodeVersionPin()).toBeNull();
});
