import { test } from 'node:test';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.PANEL_TEST_URL || 'http://127.0.0.1:5198/panel/');
if (!['127.0.0.1','localhost','[::1]'].includes(base.hostname)) throw Error('local fixtures only');
let browser;
test.before(async()=>{browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});});
test.after(async()=>browser?.close());
for(const [width,height] of [[1440,900],[1024,768],[768,1024],[390,844],[320,720]]) for(const theme of ['light','dark']) for(const language of ['en','id']) for(const motion of ['reduce','no-preference']) {
 test(`landmark ${width} ${theme} ${language} ${motion}`,async()=>{
  const context=await browser.newContext({viewport:{width,height},reducedMotion:motion});
  try {
   const page=await context.newPage(), errors=[],unexpected=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(p=>localStorage.setItem('styx-panel-preferences',JSON.stringify(p)),{theme,language});
   await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!==base.origin){if(!u.hostname.includes('google'))unexpected.push(u.href);return route.abort();}if(u.pathname.startsWith('/api/')||u.pathname.startsWith('/v1/')){unexpected.push(u.href);return route.fulfill({status:501,json:{}});}return route.continue();});
   await page.goto(new URL('tests/brand-kit.fixture.html',base).href);
   const trigger=page.locator('.shell-nav-trigger');await trigger.waitFor();
   if(width<=860)await trigger.click();
   const name=language==='id'?'Navigasi utama':'Main navigation';
   const nav=page.locator('#styx-nav');
   assert.equal(await nav.getAttribute('aria-label'),name);
   assert.equal(await page.getByRole('navigation',{name,exact:true}).count(),1);
   if(width<=860)assert.equal(await page.getByRole('dialog',{name}).count(),1);
   if(motion==='reduce'){const duration=await page.locator(width>860?'.shell-nav-scroller':'.shell-drawer').evaluate(e=>getComputedStyle(e).transitionDuration);assert.ok(duration.split(',').every(s=>parseFloat(s)===0),duration);}
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth),0);
   assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
  } finally {await context.close();}
 });
}
