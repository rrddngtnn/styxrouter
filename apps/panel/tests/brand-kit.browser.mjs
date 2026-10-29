import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.PANEL_TEST_URL || 'http://127.0.0.1:5197/panel/');
if (!['127.0.0.1','localhost','[::1]'].includes(base.hostname)) throw Error('Local fixtures only');
const dir = process.env.BRAND_SCREENSHOTS || resolve(process.env.TMPDIR || process.cwd(), 'styxrouter-browser-tests', 'brand-kit');
let browser;
test.before(async () => { await mkdir(dir,{recursive:true}); browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']}); });
test.after(async () => browser?.close());
for (const width of [1440,390,320]) for (const theme of ['light','dark']) for (const screen of ['login','shell']) {
 test(`${screen} ${width} ${theme}: lockup visible, accessible and not clipped`, async () => {
  const context=await browser.newContext({viewport:{width,height:900},colorScheme:theme,reducedMotion:'reduce'});
  try {
   const page=await context.newPage(); const errors=[], unexpected=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(theme=>localStorage.setItem('styx-panel-preferences',JSON.stringify({theme,language:'en',providerView:'cards'})),theme);
   await page.route('**/*',async route=>{const req=route.request(),u=new URL(req.url()); if (u.origin!==base.origin || !['GET','HEAD'].includes(req.method()) || u.pathname.startsWith('/api/') || u.pathname.startsWith('/v1/')) { if(!u.hostname.endsWith('googleapis.com')&&!u.hostname.endsWith('gstatic.com')) unexpected.push(`${req.method()} ${u.origin}${u.pathname}`); return route.abort(); } return route.continue();});
   await page.goto(new URL(`tests/brand-kit.fixture.html${screen==='login'?'?login':''}`,base).href);
   if(screen==='shell') await page.getByRole('button',{name:'Open navigation'}).click();
   const brand=screen==='login'?page.locator('.login-head .brand'):page.locator('.shell-dialog-head .brand');
   await brand.waitFor({state:'visible'});
   const image=brand.locator('img:visible'); assert.equal(await image.count(),1);
   assert.equal(await brand.getAttribute('aria-label'),'StyxRouter');
   const m=await image.evaluate(el=>{const r=el.getBoundingClientRect(),p=el.parentElement.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,parentLeft:p.left,parentRight:p.right,complete:el.complete,naturalWidth:el.naturalWidth,src:el.currentSrc,filter:getComputedStyle(el).filter,topElement:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===el,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth};});
   assert.ok(m.complete&&m.naturalWidth>0&&m.width>100&&m.height>20,JSON.stringify(m));
   assert.ok(m.left>=0&&m.right<=width&&m.left>=m.parentLeft&&m.right<=m.parentRight&&m.top>=0&&m.bottom<=900,JSON.stringify(m));
   assert.ok(m.topElement,JSON.stringify(m)); assert.equal(m.filter,'none'); assert.equal(m.overflow,0);
   assert.ok(m.src.endsWith(theme==='light'?'styx-lockup.svg':'styx-lockup-dark.svg'));
   await page.screenshot({path:resolve(dir,`${screen}-${width}-${theme}.png`),animations:'disabled'});
   await image.screenshot({path:resolve(dir,`${screen}-${width}-${theme}-mark.png`),animations:'disabled'});
   assert.deepEqual(errors,[]); assert.deepEqual(unexpected,[]);
  } finally {await context.close();}
 });
}
for (const screen of ['login','shell']) test(`system theme changes ${screen} without reload`,async()=>{
 const context=await browser.newContext({viewport:{width:390,height:900},colorScheme:'light',reducedMotion:'reduce'});
 try {const page=await context.newPage();
  await page.addInitScript(()=>localStorage.setItem('styx-panel-preferences',JSON.stringify({theme:'system',language:'en',providerView:'cards'})));
  await page.route('**/*',async route=>{const r=route.request(),u=new URL(r.url()); if(u.origin!==base.origin||!['GET','HEAD'].includes(r.method())||u.pathname.startsWith('/api/')||u.pathname.startsWith('/v1/')) return route.abort();return route.continue();});
  await page.goto(new URL(`tests/brand-kit.fixture.html${screen==='login'?'?login':''}`,base).href);
  if(screen==='shell') await page.getByRole('button',{name:'Open navigation'}).click();
  const image=page.locator(screen==='login'?'.login-head .brand img:visible':'.shell-dialog-head .brand img:visible');
  await image.waitFor(); assert.ok((await image.getAttribute('src')).endsWith('styx-lockup.svg'));
  await page.screenshot({path:resolve(dir,`${screen}-system-before.png`),animations:'disabled'});
  await page.emulateMedia({colorScheme:'dark'});
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  assert.ok((await image.getAttribute('src')).endsWith('styx-lockup-dark.svg'));
  await page.screenshot({path:resolve(dir,`${screen}-system-after.png`),animations:'disabled'});
 } finally {await context.close();}
});
