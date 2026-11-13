import './helpers/test-secrets';
import { test, expect } from 'bun:test';
import { join } from 'node:path';

test('session identity survives independent workers, scopes principal/provider and rotates with approved secret', async () => {
 const script = `import { OpencodeExecutor } from ${JSON.stringify(join(import.meta.dir,'../open-sse/executors/opencode.ts'))};
 const e=new OpencodeExecutor(process.env.FIXTURE_PROVIDER!);
 globalThis.fetch=async(_u,i)=>{console.log('SESSION:'+new Headers(i?.headers).get('x-opencode-session'));return Response.json({error:{}},{status:403})};
 await e.execute({model:'fixture',body:{messages:[]},stream:false,credentials:{apiKey:'fixture-upstream'},sessionPrincipalId:process.env.FIXTURE_PRINCIPAL,clientHeaders:{authorization:'Bearer '+process.env.FIXTURE_CALLER,'x-opencode-session':'conversation'},skipUpstreamRetry:true});`;
 const run=(principal='principal-a',provider='opencode-go',secret=process.env.API_KEY_SECRET!,caller='caller-a')=>{
  const p=Bun.spawnSync([process.execPath,'--no-env-file','-e',script],{cwd:import.meta.dir,env:{...process.env,FIXTURE_PRINCIPAL:principal,FIXTURE_PROVIDER:provider,FIXTURE_CALLER:caller,API_KEY_SECRET:secret},stdout:'pipe',stderr:'pipe'});
  expect(p.exitCode).toBe(0); const value=p.stdout.toString().match(/SESSION:([a-f0-9]{64})/);expect(value).not.toBeNull();return value![1];
 };
 const a=run();expect(run()).toBe(a);expect(run('principal-a','opencode-go',process.env.API_KEY_SECRET!,'rotated-caller')).toBe(a);
 expect(run('principal-b')).not.toBe(a);expect(run('principal-a','opencode-zen')).not.toBe(a);expect(run('principal-a','opencode-go','rotated-synthetic-secret')).not.toBe(a);
});
