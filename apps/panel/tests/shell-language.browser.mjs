// Isolated fixture-only shell regression. Start an isolated local Vite server first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.PANEL_TEST_URL || 'http://127.0.0.1:5198/panel/');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('Only a local fixture server is permitted');
let browser;
test.before(async () => { browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']}); });
test.after(async () => { await browser?.close(); });
for (const width of [320,390]) for (const theme of ['light','dark']) for (const language of ['en','id']) {
  test(`header language fits and remains operable: ${width} ${theme} ${language}`, async () => {
    const context = await browser.newContext({viewport:{width,height:844},reducedMotion:'reduce'});
    try {
      const page = await context.newPage();
      const unexpected = [], errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(({theme,language}) => localStorage.setItem('styx-panel-preferences',JSON.stringify({theme,language,providerView:'cards'})), {theme,language});
      await page.route('**/*', async route => {
        const req=route.request(), u=new URL(req.url());
        if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/v1/')) {
          const fixtures={'/api/auth/status':{authenticated:true},'/api/providers':{providers:[]},'/api/provider-nodes':{nodes:[]},'/api/connections':{connections:[]},'/api/oauth/providers':{providers:[]},'/api/usage/quota':{providers:[]}};
          if (req.method() !== 'GET' || !(u.pathname in fixtures)) { unexpected.push(`${req.method()} ${u.pathname}`); return route.fulfill({status:501,json:{error:'Unexpected fixture request'}}); }
          return route.fulfill({json:fixtures[u.pathname]});
        }
        if (['https://fonts.googleapis.com','https://fonts.gstatic.com'].includes(u.origin)) return route.abort();
        if (u.origin !== base.origin || !['GET','HEAD'].includes(req.method())) { unexpected.push(`${req.method()} ${u.origin}${u.pathname}`); return route.abort(); }
        return route.continue();
      });
      await page.goto(new URL('quota',base).href);
      const select=page.locator('.shell-language'); await select.waitFor();
      assert.equal(await select.getAttribute('aria-label'),language === 'en' ? 'Language' : 'Bahasa');
      assert.equal(await select.inputValue(),language);
      if (process.env.HEADER_SCREENSHOTS) {
        await mkdir(process.env.HEADER_SCREENSHOTS,{recursive:true});
        await page.locator('.shell-topbar').screenshot({path:resolve(process.env.HEADER_SCREENSHOTS,`${width}-${theme}-${language}.png`),animations:'disabled'});
      }
      const metrics=await page.evaluate(() => {
        const select=document.querySelector('.shell-language'), c=getComputedStyle(select), r=select.getBoundingClientRect();
        const canvas=document.createElement('canvas'), ctx=canvas.getContext('2d'); ctx.font=`${c.fontStyle} ${c.fontWeight} ${c.fontSize} ${c.fontFamily}`;
        const longest=Math.max(...Array.from(select.options,o=>ctx.measureText(o.textContent).width));
        const controls=[...document.querySelectorAll('.shell-topbar button, .shell-topbar select')].filter(e=>e.getBoundingClientRect().width).map(e=>{const r=e.getBoundingClientRect(); return {label:e.getAttribute('aria-label'),width:r.width,height:r.height,left:r.left,right:r.right};});
        return {width:r.width,available:r.width-parseFloat(c.paddingLeft)-parseFloat(c.paddingRight)-parseFloat(c.borderLeftWidth)-parseFloat(c.borderRightWidth)-20,longest,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,controls,theme:document.documentElement.dataset.theme,lang:document.documentElement.lang};
      });
      assert.equal(metrics.theme,theme); assert.equal(metrics.lang,language);
      assert.ok(metrics.available >= metrics.longest,`language text truncated: ${JSON.stringify(metrics)}`);
      assert.equal(metrics.overflow,0,`document overflow: ${JSON.stringify(metrics)}`);
      assert.deepEqual(metrics.controls.filter(c=>c.width<44||c.height<44||c.left<0||c.right>width),[],`header targets: ${JSON.stringify(metrics)}`);
      await select.focus(); assert.equal(await select.evaluate(el=>el===document.activeElement),true);
      await select.selectOption(language === 'en' ? 'id' : 'en');
      assert.equal(await select.inputValue(),language === 'en' ? 'id' : 'en');
      assert.deepEqual(errors,[]); assert.deepEqual(unexpected,[]);
    } finally { await context.close(); }
  });
}
