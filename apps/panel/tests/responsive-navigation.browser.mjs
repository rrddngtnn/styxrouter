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
   if(width>860){
    assert.equal(await trigger.getAttribute('aria-expanded'),'true');
    assert.equal(await page.locator('[role=dialog]').count(),0);
    const expanded=await page.locator('.shell-nav-scroller').boundingBox(); assert.ok(expanded.width>200);
    await trigger.click(); await page.waitForTimeout(220);
    const collapsed=await page.locator('.shell-nav-scroller').boundingBox(); assert.ok(collapsed.width<100 && collapsed.width>=50,JSON.stringify({expanded,collapsed}));
    assert.equal(await nav.locator('a').first().getAttribute('aria-label') !== null,true);
    if(process.env.NAV_SCREENSHOTS){await mkdir(process.env.NAV_SCREENSHOTS,{recursive:true}); await page.screenshot({path:resolve(process.env.NAV_SCREENSHOTS,`${width}-${theme}-rail.png`),animations:'disabled'});}
    await trigger.click(); await page.waitForTimeout(220); assert.ok((await nav.boundingBox()).width>200);
    await nav.locator('a').first().click(); assert.equal(await trigger.getAttribute('aria-expanded'),'true');
    await trigger.click(); await page.waitForTimeout(220);
    // A viewport resize updates CSS/media matching before React handles the
    // matchMedia change event. Wait for the *mobile* semantics before clicking;
    // aria-expanded=false alone also describes the collapsed desktop rail.
    await page.setViewportSize({width:390,height:900});
    await page.waitForFunction(() => !matchMedia('(min-width: 861px)').matches && document.querySelector('.shell-nav-trigger')?.getAttribute('aria-label') === 'Open navigation' && document.querySelector('.shell-nav-trigger')?.getAttribute('aria-expanded') === 'false');
    await trigger.click();
    const dialog=page.getByRole('dialog',{name:'Main navigation'}); await dialog.waitFor();
    await page.waitForFunction(() => document.body.style.overflow === 'hidden' && document.querySelector('.shell-workspace')?.inert && document.querySelector('[role=dialog]')?.contains(document.activeElement));
    await page.setViewportSize({width,height:900});
    // Require the desktop-specific label, not merely a possibly stale expanded
    // value, and verify that the transient modal is actually cleaned up.
    await page.waitForFunction(() => matchMedia('(min-width: 861px)').matches && document.querySelector('.shell-nav-trigger')?.getAttribute('aria-label') === 'Expand sidebar' && document.querySelector('.shell-nav-trigger')?.getAttribute('aria-expanded') === 'false' && !document.querySelector('[role=dialog]') && !document.querySelector('.shell-workspace')?.inert && document.body.style.overflow !== 'hidden' && document.activeElement === document.querySelector('.shell-nav-trigger'));
    await page.setViewportSize({width:390,height:900});
    await page.waitForFunction(() => document.querySelector('.shell-nav-trigger')?.getAttribute('aria-label') === 'Open navigation' && document.querySelector('.shell-nav-trigger')?.getAttribute('aria-expanded') === 'false' && !document.querySelector('[role=dialog]') && document.body.style.overflow !== 'hidden');
    await page.setViewportSize({width,height:900});
    await page.waitForFunction(() => document.querySelector('.shell-nav-trigger')?.getAttribute('aria-label') === 'Expand sidebar' && document.querySelector('.shell-nav-trigger')?.getAttribute('aria-expanded') === 'false');
    await trigger.click(); await page.waitForTimeout(220);
   } else {
    assert.equal(await trigger.getAttribute('aria-expanded'),'false');
    await trigger.click(); const dialog=page.getByRole('dialog',{name:'Main navigation'}); await dialog.waitFor();
    if(process.env.NAV_SCREENSHOTS){await mkdir(process.env.NAV_SCREENSHOTS,{recursive:true}); await page.screenshot({path:resolve(process.env.NAV_SCREENSHOTS,`${width}-${theme}-drawer.png`),animations:'disabled'});}
    assert.equal(await page.locator('.shell-workspace').evaluate(e=>e.inert),true);
    await page.keyboard.press('Shift+Tab'); assert.equal(await dialog.evaluate(e=>e.contains(document.activeElement)),true);
    for(let i=0;i<20;i++){await page.keyboard.press('Tab'); assert.equal(await dialog.evaluate(e=>e.contains(document.activeElement)),true);}
    await page.keyboard.press('Escape'); assert.equal(await trigger.evaluate(e=>e===document.activeElement),true);
    await trigger.click(); await page.locator('.shell-nav-scroller').click({position:{x:width-2,y:500}}); assert.equal(await trigger.evaluate(e=>e===document.activeElement),true);
    await trigger.click(); await dialog.locator('a').first().click(); assert.equal(await trigger.getAttribute('aria-expanded'),'false');
   }
   const animated=await page.locator(width>860?'.shell-nav-scroller':'.shell-drawer').evaluate(e=>({duration:getComputedStyle(e).transitionDuration,timing:getComputedStyle(e).transitionTimingFunction}));
   assert.ok(animated.duration.includes('0.18s'),JSON.stringify(animated)); assert.ok(animated.timing.includes('cubic-bezier(0.2, 0.7, 0.2, 1)'),JSON.stringify(animated));
   await page.emulateMedia({reducedMotion:'reduce'});
   const reduced=await page.locator(width>860?'.shell-nav-scroller':'.shell-drawer').evaluate(e=>getComputedStyle(e).transitionDuration);
   assert.ok(reduced.split(',').every(s=>parseFloat(s)===0),reduced);
   if(width>860) assert.equal(await nav.isVisible(),true);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth),0);
   assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),theme);
   if(process.env.NAV_SCREENSHOTS){await mkdir(process.env.NAV_SCREENSHOTS,{recursive:true}); await page.screenshot({path:resolve(process.env.NAV_SCREENSHOTS,`${width}-${theme}.png`),animations:'disabled'});}
   assert.deepEqual(errors,[]); assert.deepEqual(unexpected,[]);
  } finally { await context.close(); }
 });
}
