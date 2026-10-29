import { test } from 'node:test';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.PANEL_TEST_URL || 'http://127.0.0.1:5199/panel/');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('Local fixture only');
for (const width of [320, 1280]) test(`bulk dialog keyboard and focus restoration at ${width}px`, async () => {
 const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page = await browser.newPage({viewport:{width,height:800}, reducedMotion:'reduce'});
 let release; const pending = new Promise(resolve => { release = resolve; });
 let releaseDelete; const pendingDelete = new Promise(resolve => { releaseDelete = resolve; });
 try {
  await page.route('**/*', async route => {
   const req=route.request(), u=new URL(req.url());
   if (u.pathname.startsWith('/api/')) {
    const fixtures={'/api/providers':{providers:[{id:'alpha',name:'Alpha',authModes:['apikey']}]},'/api/provider-nodes':{nodes:[]},'/api/connections':{connections:['a','b'].map(id=>({id,name:id,provider:'alpha',isActive:true,testStatus:'active',authType:'apikey',lastError:null,backoffLevel:0}))},'/api/oauth/providers':{providers:[]}};
    if(req.method()==='GET' && u.pathname in fixtures) return route.fulfill({json:fixtures[u.pathname]});
    if(req.method()==='DELETE' && /^\/api\/connections\/[ab]$/.test(u.pathname)) { await pendingDelete; return route.fulfill({json:{ok:true}}); }
    if(req.method()==='POST' && u.pathname==='/api/connections/bulk-rename') { await pending; return route.fulfill({json:{results:[{id:'a',success:true},{id:'b',success:true}]}}); }
    return route.fulfill({status:501,json:{error:'Unexpected request'}});
   }
   if(u.origin!==base.origin || !['GET','HEAD'].includes(req.method())) return route.abort();
   return route.continue();
  });
  await page.goto(new URL('tests/provider-account-search.fixture.html',base).href);
  await page.getByRole('tab',{name:/API Keys/}).click(); await page.getByRole('link',{name:/Alpha/}).first().click();
  await page.getByRole('checkbox',{name:/Select all/}).check();
  const trigger=page.getByRole('button',{name:'Rename selected'}); await trigger.focus(); await page.keyboard.press('Enter');
  const dialog=page.getByRole('dialog'); await dialog.waitFor();
  for(let i=0;i<6;i++){await page.keyboard.press('Tab'); assert.equal(await dialog.evaluate(el=>el.contains(document.activeElement)),true);}
  for(let i=0;i<6;i++){await page.keyboard.press('Shift+Tab'); assert.equal(await dialog.evaluate(el=>el.contains(document.activeElement)),true);}
  await page.keyboard.press('Escape'); await dialog.waitFor({state:'hidden'});
  assert.equal(await trigger.evaluate(el=>el===document.activeElement),true,'Escape returns focus to initiating button');
  await page.keyboard.press('Enter'); await dialog.getByLabel('Rename pattern').fill('Team {name}');
  await dialog.getByRole('button',{name:'Confirm'}).click(); await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Rename selected' && b.disabled));
  release(); await dialog.waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.activeElement?.textContent==='Rename selected');
  const deleteButton=page.getByRole('button',{name:'Delete selected'}); await deleteButton.focus(); await page.keyboard.press('Enter');
  await dialog.getByRole('button',{name:'Confirm'}).click(); await dialog.waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.activeElement?.id==='provider-connected-accounts-heading');
  assert.equal(await deleteButton.isDisabled(),true);
  releaseDelete();
  await page.getByText(/2 succeeded/).first().waitFor();
  assert.equal(await deleteButton.isDisabled(),true);
  assert.equal(await page.locator('#provider-connected-accounts-heading').evaluate(el=>el===document.activeElement),true);
 } finally { release(); releaseDelete(); await browser.close(); }
});
