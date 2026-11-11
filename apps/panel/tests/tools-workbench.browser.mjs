import {browserEvidencePath} from './browser-paths.mjs';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {known} from './redesign-api.fixture.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
const out=browserEvidencePath('r7-tools');await mkdir(out,{recursive:true});
const results=[];
try {
 for(const width of [320,360,390,1440])for(const theme of ['light','dark'])for(const language of ['en','id']) {
  const p=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});let writes=0;const errors=[];
  p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(({theme,language})=>{localStorage.setItem('styx-panel-preferences',JSON.stringify({theme,language}));window.__copies=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.__copies.push(text)}});},{theme,language});
  await p.route('**/*',async r=>{const u=new URL(r.request().url());if(u.hostname!=='127.0.0.1')return r.abort();if(!/^\/(api|v1)\//.test(u.pathname))return r.continue();if(r.request().method()!=='GET'){writes++;assert.equal(u.pathname,'/v1/chat/completions');assert.equal(r.request().postDataJSON().model,'openai/fixture-model');return r.fulfill({json:{choices:[{message:{content:'ok'}}]}});}return r.fulfill({json:known[u.pathname]??{}});});
  await p.goto('http://127.0.0.1:5198/panel/tools?foreign=keep');await p.locator('.tools-client-choice').waitFor();
  const pick=p.locator('.tools-client-choice select');assert.equal(await pick.locator('option').count(),10);
  await p.locator('.tools-client-choice input').fill('Hermes');await pick.selectOption('hermes-agent');await p.locator('.tools-client-choice input').fill('');await pick.selectOption('claude-code');
  const url=p.locator('.tools-settings input').first();await url.fill('');assert.equal(await url.getAttribute('aria-invalid'),'true');await url.fill('http://127.0.0.1:5198/v1');
  const key=p.locator('input[type=password]');await key.fill('synthetic-secret-sentinel');assert.equal(await key.getAttribute('type'),'password');
  assert.equal((await p.locator('pre.tools-snippet-body').innerText()).includes('synthetic-secret-sentinel'),false);
  await p.locator('.tools-snippet-head button').first().click();assert.equal(await p.evaluate(()=>window.__copies[0].includes('synthetic-secret-sentinel')),false);
  const secret=p.locator('.tools-snippet-head button').nth(1);await secret.click();await p.locator('.styx-confirmation').getByRole('button').first().click();assert.equal(await p.evaluate(()=>window.__copies.length),1);
  await secret.click();await p.locator('.styx-confirmation').getByRole('button').last().click();assert.equal(await p.evaluate(()=>window.__copies[1].includes('synthetic-secret-sentinel')),true);
  await p.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('rejected');}}}));await p.locator('.tools-snippet-head button').first().click();await p.locator('.tools-copy-status').filter({hasText:language==='en'?'Clipboard unavailable':'Papan klip tidak tersedia'}).waitFor();
  const request=p.locator('.tools-request-test > button').first();await request.click();await p.locator('.styx-confirmation').getByRole('button').first().click();assert.equal(writes,0);
  await request.click();assert.match(await p.locator('.styx-confirmation').innerText(),/openai\/fixture-model/);assert.match(await p.locator('.styx-confirmation').innerText(),language==='en'?/real charges/:/biaya nyata/);await p.locator('.styx-confirmation').getByRole('button').last().click();await p.locator('.tools-probe-reply').waitFor();assert.equal(writes,1);
  assert.equal(new URL(p.url()).searchParams.get('foreign'),'keep');assert.equal(p.url().includes('sentinel'),false);assert.equal(await p.evaluate(()=>JSON.stringify(localStorage).includes('sentinel')),false);
  await key.fill('');await p.evaluate(()=>{window.__copies=[];});
  async function bounds(){const bad=await p.locator('.tools-page input,.tools-page select').evaluateAll(nodes=>nodes.filter(n=>{const r=n.getBoundingClientRect();return r.width&& (r.right>innerWidth+1||r.left<0);}).map(n=>n.outerHTML));assert.deepEqual(bad,[]);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);}
  await bounds();const codeScroll=await p.locator('.tools-snippet-body').evaluate(n=>{n.scrollLeft=80;const moved=n.scrollLeft>0;n.scrollLeft=0;return {needed:n.scrollWidth>n.clientWidth,moved};});if(codeScroll.needed)assert.equal(codeScroll.moved,true);await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:`${out}/connect-${width}-${theme}-${language}.png`,fullPage:true});
  await p.getByRole('tab',{name:language==='en'?'Network access':'Akses jaringan',exact:true}).click();await p.locator('.tools-network select').nth(1).selectOption('ssh');
  const ssh=p.locator('.tools-network-grid input');await ssh.nth(0).fill('30200');await ssh.nth(1).fill('alice');await ssh.nth(2).fill('host.example');await ssh.nth(3).fill('2222');await ssh.nth(4).fill('20128');assert.match(await p.locator('.tools-snippet-body').innerText(),/-p 2222.*-L 127.0.0.1:30200:127.0.0.1:20128 alice@host.example/);
  for(const mode of ['local','ssh','cloudflared','tailscale','caddy']){await p.locator('.tools-network select').nth(1).selectOption(mode);await bounds();}
  await p.locator('.tools-network select').nth(1).selectOption('ssh');await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:`${out}/network-${width}-${theme}-${language}.png`,fullPage:true});
  await p.getByRole('tab',{name:language==='en'?'API reference':'Referensi API',exact:true}).click();await p.locator('.tools-reference input').fill('messages');assert.equal(await p.locator('.tools-reference details').count(),1);await p.locator('summary').click();assert.match(await p.locator('.tools-snippet-body').innerText(),/anthropic-version/);await bounds();await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:`${out}/reference-${width}-${theme}-${language}.png`,fullPage:true});assert.equal(writes,1);assert.deepEqual(errors,[]);
  results.push({width,theme,language,pass:true,explicitSyntheticRequests:writes});await p.close();
 }
 await writeFile(`${out}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
} finally {await browser.close();}
