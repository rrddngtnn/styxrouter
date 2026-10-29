import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.PANEL_TEST_URL || 'http://127.0.0.1:5299';
if (!['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname)) throw Error('Local fixture only');
const out = `${process.env.TMPDIR}/models-visual`;
const providers = ['alpha','beta','gamma','delta','epsilon','zeta'];
const rows = providers.map(id => ({id:`${id}/sample-model`,owned_by:id,type:'chat',context_length:8192,capabilities:{vision:true}}));
let browser;
test.before(async()=>{await mkdir(out,{recursive:true});browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});});
test.after(async()=>browser?.close());
for(const width of [320,390,768,1024,1440]) for(const theme of ['light','dark']) for(const language of ['en','id']) test(`${width} ${theme} ${language}: rail, badges, keyboard and table`,async()=>{
 const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}); const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try {
 await page.addInitScript(({theme,language})=>{localStorage.setItem('styx-panel-preferences',JSON.stringify({theme,language,providerView:'cards'}));document.addEventListener('DOMContentLoaded',()=>document.getElementById('root').classList.add('shell-responsive'));},{theme,language});
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.pathname.startsWith('/api/')||u.pathname.startsWith('/v1/')){const fixtures={'/v1/models':{data:rows},'/api/providers':{providers:providers.map(id=>({id,name:`${id.toUpperCase()} Example Provider`}))},'/api/provider-nodes':{nodes:[]}};return route.fulfill({status:fixtures[u.pathname]?200:501,json:fixtures[u.pathname]||{error:'unexpected'}});}return u.origin===new URL(origin).origin?route.continue():route.abort();});
 await page.goto(`${origin}/panel/tests/global-models.fixture.html`);await page.getByText('alpha/sample-model',{exact:true}).waitFor();
 const search=page.getByRole('searchbox',{name:language==='id'?'Cari model':'Search models'}); const fit=await search.evaluate(e=>{const s=getComputedStyle(e),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font=s.font;return {text:ctx.measureText(e.placeholder).width,available:e.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight)};});assert.ok(fit.text<=fit.available,JSON.stringify(fit));
 await page.screenshot({path:`${out}/${width}-${theme}-${language}-initial.png`,fullPage:true});
 const rail=page.locator('.model-category-rail');const buttons=rail.locator('button');
 const geom=await rail.evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth,buttons:[...e.querySelectorAll('button')].map(b=>({width:b.getBoundingClientRect().width,scroll:b.scrollWidth}))}));
 assert.ok(geom.buttons.every(b=>b.width+1>=b.scroll),JSON.stringify(geom));
 if(width<=700){assert.ok(await page.locator('.model-rail-hint').isVisible(),'scrollable provider rail needs a visible hint');assert.ok(geom.scroll>geom.width);const firstTwo=await buttons.nth(1).evaluate(b=>({right:b.getBoundingClientRect().right,railRight:b.parentElement.getBoundingClientRect().right}));assert.ok(firstTwo.right<=firstTwo.railRight+1,JSON.stringify(firstTwo));}
 const selected=await buttons.first().evaluate(b=>({color:getComputedStyle(b).color,background:getComputedStyle(b).backgroundColor,border:getComputedStyle(b).borderColor}));const unselected=await buttons.nth(1).evaluate(b=>({color:getComputedStyle(b).color,background:getComputedStyle(b).backgroundColor,border:getComputedStyle(b).borderColor}));assert.notDeepEqual(selected,unselected,'selected provider must have visible styling');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth),0);
 const last=buttons.last();await last.focus();await page.keyboard.press('Enter');assert.equal(await last.getAttribute('aria-pressed'),'true');const visible=await last.evaluate(b=>{const a=b.getBoundingClientRect(),r=b.parentElement.getBoundingClientRect();return {left:a.left,right:a.right,railLeft:r.left,railRight:r.right,width:a.width}});assert.ok(visible.left>=visible.railLeft-2&&visible.right<=visible.railRight+2,JSON.stringify(visible));
 await buttons.first().focus();await page.keyboard.press('Enter');
 const region=page.getByRole('region',{name:language==='en'?'Models table':/Models table|Tabel model/i});
 const badge=page.locator('.vendor-badge').first();const colors=await badge.evaluate(el=>{const parse=s=>s.match(/[\d.]+/g).map(Number);const blend=(a,b)=>a[3]===undefined?a:[0,1,2].map(i=>a[i]*a[3]+b[i]*(1-a[3]));let bg=[255,255,255];const chain=[];for(let n=el;n;n=n.parentElement)chain.unshift(parse(getComputedStyle(n).backgroundColor));for(const c of chain)bg=blend(c,bg);const fg=parse(getComputedStyle(el).color);const lum=c=>{const v=c.map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});return .2126*v[0]+.7152*v[1]+.0722*v[2]};const a=lum(fg),b=lum(bg);return {fg,bg,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});assert.ok(colors.ratio>=4.5,JSON.stringify(colors));
 if(await region.evaluate(e=>e.scrollWidth>e.clientWidth)){const first=region.locator('tbody td:first-child').first();const x=await first.evaluate(e=>e.getBoundingClientRect().left);await region.focus();await page.keyboard.press('ArrowRight');await page.waitForTimeout(150);assert.ok(await region.evaluate(e=>e.scrollLeft)>0);assert.ok(Math.abs((await first.evaluate(e=>e.getBoundingClientRect().left))-x)<2);await page.screenshot({path:`${out}/${width}-${theme}-${language}-scrolled.png`,fullPage:true});}
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth),0);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
