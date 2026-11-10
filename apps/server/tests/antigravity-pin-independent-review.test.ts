import { test, expect } from 'bun:test';
import { createAntigravityOAuthProvider } from '../src/lib/oauth/providers/antigravity.ts';
import { ANTIGRAVITY_CONFIG } from '../src/lib/oauth/constants/oauth';
import { AntigravityExecutor } from '../open-sse/executors/antigravity.ts';
import { getAntigravityVersionPin, setAntigravityVersionPin } from '../src/lib/db/antigravityVersionPin.ts';
import { createAdminApi } from '../server/admin.ts';
import { clearAntigravityVersionCaches, seedAntigravityIdeVersionCache, seedAntigravityCliVersionCache } from '../open-sse/services/antigravityVersion.ts';

test('pins bind OAuth exchange and executor token refresh headers; malformed input cannot change either pin', async () => {
  const old = globalThis.fetch;
  const oldProfile = process.env.STYX_ANTIGRAVITY_CLIENT_PROFILE;
  delete process.env.STYX_ANTIGRAVITY_CLIENT_PROFILE;
  const seen: Headers[] = [];
  setAntigravityVersionPin('ide','3.4.5'); setAntigravityVersionPin('cli','6.7.8');
  globalThis.fetch = (async (_url, init) => { seen.push(new Headers(init?.headers)); return Response.json({access_token:'fixture',expires_in:3600}); }) as typeof fetch;
  try {
    const api = createAdminApi();
    for (const product of ['ide','cli']) {
      for (const version of ['1.2.3\r\nX-Injected: yes','1.2.3\n','1.2.3 ',{},123]) {
        expect((await api.request(`/versions/antigravity/${product}/pin`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({version})})).status).toBe(400);
      }
      const provider = createAntigravityOAuthProvider(ANTIGRAVITY_CONFIG, product as 'ide'|'cli');
      await provider.exchangeToken(ANTIGRAVITY_CONFIG,'fixture-code','http://localhost/callback');
      const exchange = seen.at(-1)!;
      const expected = product === 'ide' ? 'antigravity/hub/2.24.0 ' : 'antigravity/cli/6.7.8 ';
      expect(exchange.get('user-agent')).toContain(expected);
      await new AntigravityExecutor().refreshCredentials({refreshToken:'fixture-refresh',projectId:'fixture-project',providerSpecificData:{clientProfile:product}} as any);
      expect(seen.at(-1)!.get('user-agent')).toContain(expected);
      expect(getAntigravityVersionPin(product as 'ide'|'cli')).toBe(product === 'ide' ? '3.4.5' : '6.7.8');
    }
  } finally { globalThis.fetch = old; if (oldProfile === undefined) delete process.env.STYX_ANTIGRAVITY_CLIENT_PROFILE; else process.env.STYX_ANTIGRAVITY_CLIENT_PROFILE = oldProfile; setAntigravityVersionPin('ide',null); setAntigravityVersionPin('cli',null); }
});

test('failed release refresh retains pins during real mocked executor dispatch', async () => {
  const old = globalThis.fetch; const profile = process.env.STYX_ANTIGRAVITY_CLIENT_PROFILE;
  delete process.env.STYX_ANTIGRAVITY_CLIENT_PROFILE;
  setAntigravityVersionPin('ide','9.1.1'); setAntigravityVersionPin('cli','9.2.2');
  seedAntigravityIdeVersionCache('2.1.1'); seedAntigravityCliVersionCache('1.1.5');
  const seen: string[] = [];
  globalThis.fetch = (async (url, init) => {
    if (String(url).includes('auto-updater')) return new Response('failure',{status:503});
    seen.push(new Headers(init?.headers).get('user-agent') || '');
    return new Response('data: {"response":{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}}\n\n',{status:200,headers:{'content-type':'text/event-stream'}});
  }) as typeof fetch;
  try {
    expect((await createAdminApi().request('/versions/antigravity/refresh',{method:'POST'})).status).toBe(502);
    for (const p of ['ide','cli']) {
      const result = await new AntigravityExecutor().execute({model:'gemini-3-flash',body:{contents:[{role:'user',parts:[{text:'hi'}]}]},stream:true,credentials:{accessToken:'fixture',projectId:'fixture-project',providerSpecificData:{clientProfile:p}}} as any);
      expect(result.response.status).toBe(200);
    }
    expect(seen[0]).toContain('antigravity/hub/2.24.0'); expect(seen[1]).toContain('antigravity/cli/9.2.2');
  } finally { globalThis.fetch = old; if (profile === undefined) delete process.env.STYX_ANTIGRAVITY_CLIENT_PROFILE; else process.env.STYX_ANTIGRAVITY_CLIENT_PROFILE = profile; clearAntigravityVersionCaches(); setAntigravityVersionPin('ide',null); setAntigravityVersionPin('cli',null); }
});

test('simultaneous independent processes share committed IDE and CLI pins', async () => {
  setAntigravityVersionPin('ide','1.2.3'); setAntigravityVersionPin('cli','4.5.6');
  const modulePath = new URL('../src/lib/db/antigravityVersionPin.ts', import.meta.url).pathname;
  const run = (code:string) => Bun.spawn([process.execPath,'-e',`import {getAntigravityVersionPin,setAntigravityVersionPin} from ${JSON.stringify(modulePath)}; ${code}`],{cwd:process.cwd(),env:process.env,stdout:'pipe',stderr:'pipe'});
  const workers = ['ide','cli'].map((product,i) => run(`for(let n=0;n<50;n++) setAntigravityVersionPin('${product}', '${i+7}.8.9'); console.log('RESULT='+getAntigravityVersionPin('${product}'));`));
  const outputs = await Promise.all(workers.map(async p => ({code:await p.exited,out:await new Response(p.stdout).text(),err:await new Response(p.stderr).text()})));
  expect(outputs.map(x=>x.code)).toEqual([0,0]);
  expect(outputs[0].out).toContain('RESULT=7.8.9'); expect(outputs[1].out).toContain('RESULT=8.8.9');
  expect(getAntigravityVersionPin('ide')).toBe('7.8.9'); expect(getAntigravityVersionPin('cli')).toBe('8.8.9');
  setAntigravityVersionPin('ide',null); setAntigravityVersionPin('cli',null);
},30000);
