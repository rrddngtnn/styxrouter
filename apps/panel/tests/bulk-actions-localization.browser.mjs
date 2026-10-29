import { test } from 'node:test';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base=new URL(process.env.PANEL_TEST_URL || 'http://127.0.0.1:5199/panel/');
if(!['127.0.0.1','localhost','[::1]'].includes(base.hostname)) throw Error('Local fixture only');
test('Indonesian bulk controls and dialog are localized',async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage();
 try {
 await page.addInitScript(()=>localStorage.setItem('styx-panel-preferences',JSON.stringify({theme:'light',language:'id',providerView:'cards'})));
 await page.route('**/*',route=>{const req=route.request(),u=new URL(req.url()); if(u.pathname.startsWith('/api/')) {const f={'/api/providers':{providers:[{id:'alpha',name:'Alpha',authModes:['apikey']}]},'/api/provider-nodes':{nodes:[]},'/api/connections':{connections:[{id:'a',name:'Alice',provider:'alpha',isActive:true,testStatus:'active',authType:'apikey'}]},'/api/oauth/providers':{providers:[]}}; return route.fulfill({json:f[u.pathname]||{}});} if(u.origin!==base.origin || req.method()!=='GET') return route.abort(); return route.continue();});
 await page.goto(new URL('tests/provider-account-search.fixture.html',base).href); await page.getByRole('tab',{name:/Kunci API/}).click(); await page.getByRole('link',{name:/Alpha/}).first().click(); await page.getByRole('checkbox',{name:/Pilih semua/}).check();
 const rename=page.getByRole('button',{name:'Ubah nama yang dipilih'}); await rename.focus(); await page.keyboard.press('Enter'); const dialog=page.getByRole('dialog'); await dialog.getByRole('button',{name:'Konfirmasi'}).click(); assert.equal(await dialog.getByRole('alert').innerText(),'Masukkan nilai.'); await dialog.getByLabel('Pola nama').fill('Team {name}'); await page.keyboard.press('Tab'); assert.equal(await page.evaluate(()=>document.querySelector('[role=dialog]').contains(document.activeElement)),true); await page.keyboard.press('Escape'); await dialog.waitFor({state:'hidden'});
 } finally {await browser.close();}
});
