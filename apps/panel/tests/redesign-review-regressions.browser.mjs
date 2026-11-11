import {browserEvidencePath} from './browser-paths.mjs';
import {mkdir} from 'node:fs/promises';
await mkdir(browserEvidencePath('review-regressions'),{recursive:true});
import assert from 'node:assert/strict';
import {known} from './redesign-api.fixture.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const origin='http://127.0.0.1:5198';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try {
for(const width of [320,1280])for(const theme of ['light','dark']) {
 const c=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});let fail=false,delay=false;
 await c.addInitScript(theme=>localStorage.setItem('styx-panel-preferences',JSON.stringify({theme,language:'en'})),theme);
 await c.route('**/*',async r=>{const u=new URL(r.request().url());if(u.origin!==origin)return r.abort();if(!/^\/(api|v1)\//.test(u.pathname))return r.continue();if(delay&&['/api/providers','/api/connections','/api/provider-nodes'].includes(u.pathname))await new Promise(x=>setTimeout(x,500));if(fail&&['/api/providers','/api/connections','/api/provider-nodes','/api/process-health/dispatch'].includes(u.pathname))return r.fulfill({status:503,json:{error:'fixture unavailable'}});return r.fulfill({json:known[u.pathname]??{}});});
 const p=await c.newPage();await p.goto(origin+'/panel/keys');await p.locator('h1').waitFor();delay=true;
 await p.evaluate(()=>{history.pushState({},'', '/panel/providers/openai?auth=apikey');window.dispatchEvent(new PopStateEvent('popstate'));});
 await p.locator('h1').filter({hasText:'OpenAI'}).waitFor();await p.waitForTimeout(100);
 assert.match(await p.title(),/OpenAI/,'delayed heading must own document title');
 assert.equal(await p.locator('h1').evaluate(el=>el===document.activeElement),true,'delayed heading receives navigation focus');
 await p.getByRole('searchbox',{name:'Search accounts'}).fill('Synthetic');fail=true;
 if(width<=860){await p.getByRole('button',{name:'Provider actions',exact:true}).click();await p.getByRole('menuitem',{name:'Reload',exact:true}).click();}else await p.getByRole('button',{name:'Reload',exact:true}).click();await p.waitForTimeout(800);
 assert.ok(await p.getByRole('alert').filter({hasText:'Cached data'}).count()>=3,'each failed reader must expose retained stale state');
 assert.ok(await p.getByText('Synthetic QA account',{exact:true}).count());
 assert.equal(await p.getByRole('button',{name:width<=860?'Provider actions':'Reload',exact:true}).evaluate(el=>el===document.activeElement),true,'refetch must not steal focus');
 await p.screenshot({path:browserEvidencePath('review-regressions',`review-regression-${width}-${theme}.png`),fullPage:true});
 fail=false;await p.goto(origin+'/panel/settings');await p.getByRole('button',{name:'Refresh metrics',exact:true}).waitFor();fail=true;await p.getByRole('button',{name:'Refresh metrics',exact:true}).click();await p.waitForTimeout(800);
 assert.ok(await p.getByRole('alert').filter({hasText:'Dispatch health'}).count(),'health resource failure must remain visible');
 console.log(`PASS delayed navigation + provider retained 503 + health stale ${width} ${theme}`);
 fail=false;await p.goto(origin+'/panel/keys');await p.locator('h1').waitFor();
 await p.evaluate(()=>{history.pushState({},'', '/panel/providers/openai?auth=apikey');window.dispatchEvent(new PopStateEvent('popstate'));});
 await p.locator(width<=860?'.shell-mobile-utilities':'.shell-language').focus(); // Existing focus owner, without pointer/key events.
 await p.locator('h1').filter({hasText:'OpenAI'}).waitFor();
 assert.match(await p.title(),/OpenAI/);assert.equal(await p.locator(width<=860?'.shell-mobile-utilities':'.shell-language').evaluate(el=>el===document.activeElement),true,'readiness must not steal user interaction');
 fail=false;await p.goto(origin+'/panel/providers/openai?auth=apikey');await p.getByRole('button',{name:'Add API key',exact:true}).click();
 await p.locator('input[type="password"]').fill('synthetic-credential-only');
 await c.route('**/api/connections',r=>{if(r.request().method()==='POST'){fail=true;return r.fulfill({json:{id:'synthetic-write'}});}return r.fallback();});
 await p.getByRole('button',{name:'Save key',exact:true}).click();
 await p.getByText('Write acknowledged; inventory refresh failed. Reload before another action.',{exact:true}).first().waitFor();
 assert.equal(await p.getByText(/Added API key to/).count(),0,'failed post-write read cannot claim confirmed success');
 console.log(`PASS interaction focus preservation + post-write read failure ${width} ${theme}`);await c.close();
}
}finally{await browser.close();}
