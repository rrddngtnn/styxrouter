import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.PANEL_TEST_URL || 'http://127.0.0.1:5198/panel/');
if (!['127.0.0.1','localhost','[::1]'].includes(base.hostname)) throw Error('local fixtures only');
let browser;
test.before(async () => { browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']}); });
test.after(async () => browser?.close());
for (const width of [1440,1024,768,390,320]) for (const theme of ['light','dark']) {
 test(`navigation ${width} ${theme}`, async () => {
  const context=await browser.newContext({viewport:{width,height:900}});
  try {
   const page=await context.newPage(), errors=[], unexpected=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(theme=>localStorage.setItem('styx-panel-preferences',JSON.stringify({theme,language:'en',providerView:'cards'})),theme);
   await page.route('**/*',async route=>{const u=new URL(route.request().url()); if(u.origin!==base.origin){if(u.hostname.includes('google'))return route.abort();unexpected.push(u.href);return route.abort();} if(u.pathname.startsWith('/api/')){unexpected.push(u.href);return route.fulfill({json:{}});} return route.continue();});
   await page.goto(new URL('tests/brand-kit.fixture.html',base).href);
   const trigger=page.locator('.shell-nav-trigger'); await trigger.waitFor();
   assert.equal(await trigger.count(),1);
   const nav=page.locator('#styx-nav');
   if(width>860) {
    assert.equal(await nav.isVisible(),true);
    assert.equal(await page.getByRole('dialog').count(),0);
    assert.equal(await page.locator('.shell-workspace').evaluate(e=>e.inert),false);
    assert.ok(await nav.locator('a').first().isVisible());
    assert.equal(await page.locator('.shell-nav-scroller').evaluate(e=>e.getBoundingClientRect().width),248);
    await trigger.click();assert.equal(await page.locator('.shell-nav-scroller').evaluate(e=>e.getBoundingClientRect().width),64);
    await trigger.click();assert.equal(await page.locator('.shell-nav-scroller').evaluate(e=>e.getBoundingClientRect().width),248);
    await page.emulateMedia({reducedMotion:'reduce'});assert.ok(await nav.locator('a').first().isVisible());
    await page.setViewportSize({width:390,height:900});assert.equal(await nav.isVisible(),false);
    await trigger.click();await page.getByRole('dialog',{name:'Main navigation'}).waitFor();
    assert.equal(await page.locator('.shell-workspace').evaluate(e=>e.inert),true);
    await page.setViewportSize({width,height:900});
    await page.waitForFunction(()=>!document.querySelector('.shell-workspace')?.inert && document.body.style.overflow!=='hidden');
    assert.ok(await nav.locator('a').first().isVisible());
   } else {
   assert.equal(await trigger.getAttribute('aria-expanded'),'false');
   assert.equal(await nav.isVisible(),false);
   await trigger.click(); const dialog=page.getByRole('dialog',{name:'Main navigation'}); await dialog.waitFor();
   assert.equal(await page.locator('.shell-workspace').evaluate(e=>e.inert),true);
   await page.keyboard.press('Shift+Tab'); assert.equal(await dialog.evaluate(e=>e.contains(document.activeElement)),true);
   for(let i=0;i<20;i++){await page.keyboard.press('Tab'); assert.equal(await dialog.evaluate(e=>e.contains(document.activeElement)),true);}
   await page.keyboard.press('Escape'); assert.equal(await trigger.evaluate(e=>e===document.activeElement),true);
   await trigger.click(); await page.locator('.shell-nav-scroller').click({position:{x:width-2,y:500}}); assert.equal(await trigger.evaluate(e=>e===document.activeElement),true);
   await trigger.click(); await dialog.locator('a').first().click(); assert.equal(await trigger.getAttribute('aria-expanded'),'false');
   await trigger.click(); await dialog.waitFor();
   await page.setViewportSize({width:width>860?390:1280,height:900});
   await page.waitForFunction(()=>!document.querySelector('.shell-workspace')?.inert && document.body.style.overflow!=='hidden' && document.querySelector('.shell-nav-scroller.is-desktop') && document.querySelector('.shell-nav-trigger')?.getAttribute('aria-expanded')==='true');
   await page.setViewportSize({width,height:900});
   const animated=await page.locator('.shell-drawer').evaluate(e=>({duration:getComputedStyle(e).transitionDuration,timing:getComputedStyle(e).transitionTimingFunction}));
   assert.ok(animated.duration.includes('0.18s'),JSON.stringify(animated)); assert.ok(animated.timing.includes('cubic-bezier(0.2, 0.7, 0.2, 1)'),JSON.stringify(animated));
   await page.emulateMedia({reducedMotion:'reduce'});
   const reduced=await page.locator('.shell-drawer').evaluate(e=>getComputedStyle(e).transitionDuration);
   assert.ok(reduced.split(',').every(s=>parseFloat(s)===0),reduced);
   assert.equal(await nav.isVisible(),false);
   }
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth),0);
   assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),theme);
   if(process.env.NAV_SCREENSHOTS){await mkdir(process.env.NAV_SCREENSHOTS,{recursive:true}); await page.screenshot({path:resolve(process.env.NAV_SCREENSHOTS,`${width}-${theme}.png`),animations:'disabled'});}
   assert.deepEqual(errors,[]); assert.deepEqual(unexpected,[]);
  } finally { await context.close(); }
 });
}
