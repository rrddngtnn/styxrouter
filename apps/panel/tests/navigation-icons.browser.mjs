import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.PANEL_TEST_URL || 'http://127.0.0.1:5198/panel/');
if (!['127.0.0.1','localhost','[::1]'].includes(base.hostname)) throw Error('local fixtures only');
let browser;
test.before(async()=>{browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});});
test.after(async()=>browser?.close());
for (const width of [1440,1024,768,390,320,860,861]) for (const theme of ['light','dark']) test(`navigation action ${width} ${theme}`,async()=>{
 const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
 try {
  const page=await context.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(theme=>localStorage.setItem('styx-panel-preferences',JSON.stringify({theme,language:'en'})),theme);
  await page.route('**/*',route=>{const r=route.request(),u=new URL(r.url()); return u.origin!==base.origin||!['GET','HEAD'].includes(r.method())||u.pathname.startsWith('/api/')||u.pathname.startsWith('/v1/')?route.abort():route.continue();});
  await page.goto(new URL('tests/brand-kit.fixture.html',base).href);
  const trigger=page.locator('.shell-nav-trigger'); await trigger.waitFor();
  const measure=async()=>trigger.evaluate(e=>{let r=e.getBoundingClientRect(),s=document.querySelector('.shell-nav-scroller').getBoundingClientRect(),i=e.querySelector('svg').getBoundingClientRect();return {label:e.getAttribute('aria-label'),expanded:e.getAttribute('aria-expanded'),icon:e.querySelector('svg')?.getAttribute('class'),iconBox:[i.x-r.x,i.y-r.y,i.width,i.height],button:[r.x,r.y,r.width,r.height],nav:[s.x,s.y,s.width,s.height],hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};});
  const desktop=width>=861, first=await measure(); console.log(JSON.stringify({width,theme,phase:'initial',...first}));
  assert.equal(first.label,desktop?'Collapse sidebar':'Open navigation'); assert.equal(first.expanded,desktop?'true':'false'); assert.match(first.icon,desktop?/lucide-panel-left-close/:/lucide-panel-left-open/); assert.deepEqual(first.iconBox.slice(2),[20,20]); assert.equal(first.hit,true);
  await trigger.focus(); await page.keyboard.press('Enter');
  if(desktop){const second=await measure();console.log(JSON.stringify({width,theme,phase:'toggled',...second}));assert.equal(second.label,'Expand sidebar');assert.equal(second.expanded,'false');assert.match(second.icon,/lucide-panel-left-open/);assert.deepEqual(second.iconBox,first.iconBox);assert.ok(first.nav[2]>200&&second.nav[2]>=50&&second.nav[2]<100); await page.keyboard.press('Space');assert.equal(await trigger.getAttribute('aria-expanded'),'true');}
  else {const dialog=page.getByRole('dialog',{name:'Main navigation'}); await dialog.waitFor(); const close=dialog.getByRole('button',{name:'Close navigation'}); assert.match(await close.locator('svg').getAttribute('class'),/lucide-x/);const second=await measure();assert.equal(second.expanded,'true');assert.match(second.icon,/lucide-panel-left-close/);assert.deepEqual(second.iconBox,first.iconBox);const box=await dialog.boundingBox();assert.ok(box.width>200);console.log(JSON.stringify({width,theme,phase:'open',drawer:box,close:await close.boundingBox()}));await close.click();assert.equal(await trigger.getAttribute('aria-expanded'),'false');await trigger.focus();await page.keyboard.press('Space');await page.keyboard.press('Escape');assert.equal(await trigger.evaluate(e=>e===document.activeElement),true);}
  if(process.env.NAV_SCREENSHOTS){await mkdir(process.env.NAV_SCREENSHOTS,{recursive:true}); await page.screenshot({path:`${process.env.NAV_SCREENSHOTS}/navigation-${width}-${theme}.png`,animations:'disabled'});}
  await page.setViewportSize({width:desktop?860:861,height:900}); await page.waitForFunction(d=>matchMedia('(min-width: 861px)').matches===d,!desktop);await page.waitForTimeout(50);assert.equal(await trigger.getAttribute('aria-expanded'),desktop?'false':'true');
  assert.deepEqual(errors,[]);
 } finally {await context.close();}
});
