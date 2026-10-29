import { test, expect } from 'bun:test';
import { startTestServer } from './helpers/start-test-server';
import { stopTestProcess } from './helpers/stop-test-process';

test('authenticated pins survive a real server restart', async () => {
  const env = { ...process.env, JWT_SECRET:'synthetic-jwt-secret-0123456789abcdef0123456789', API_KEY_SECRET:'synthetic-api-secret-0123456789abcdef', INITIAL_PASSWORD:'synthetic-password-1234', STYX_TEST_MODE:'1' };
  let server = await startTestServer(process.execPath, {cwd:process.cwd(),env});
  try {
    const login = async () => {
      const r = await fetch(`${server.base}/api/auth/login`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'synthetic-password-1234'})});
      expect(r.status).toBe(200);
      return (r.headers.get('set-cookie') || '').split(';')[0];
    };
    let cookie = await login();
    for (const [product,version] of [['ide','3.2.1'],['cli','4.3.2']]) {
      const path = `${server.base}/api/versions/antigravity/${product}/pin`;
      expect((await fetch(path)).status).toBe(401);
      const r = await fetch(path,{method:'PUT',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({version})});
      expect(r.status).toBe(200);
    }
    await stopTestProcess(server.proc);
    server = await startTestServer(process.execPath,{cwd:process.cwd(),env});
    cookie = await login();
    for (const [product,version] of [['ide','3.2.1'],['cli','4.3.2']]) {
      const r = await fetch(`${server.base}/api/versions/antigravity/${product}/pin`,{headers:{cookie}});
      expect(await r.json()).toEqual({version});
    }
  } finally { await stopTestProcess(server.proc); }
}, 60000);
