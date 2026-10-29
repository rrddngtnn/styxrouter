import { test } from 'node:test';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.PANEL_TEST_URL || 'http://127.0.0.1:5198/panel/');
if (!['127.0.0.1','localhost','[::1]'].includes(base.hostname)) throw new Error('Local fixture only');
for (const width of [320, 1440]) test(`quota tag filter composes with account search and restores provider selection ${width}`, async () => {
 const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page = await browser.newPage({viewport:{width,height:900}}), requests=[];
 const rows=[['a','Alice','alpha','blue'],['b','Bob','alpha','red'],['c','Carol','beta','blue']].map(([connectionId,name,provider,tag])=>({connectionId,name,provider,tag,isActive:true,quotaSupported:true,tokenStatus:'valid',windows:[]}));
 try {
 await page.route('**/*',async route=>{const req=route.request(),u=new URL(req.url()); if(u.pathname.startsWith('/api/')) {requests.push(u.pathname+u.search); const fixtures={'/api/auth/status':{authenticated:true},'/api/providers':{providers:[{id:'alpha',name:'Alpha'},{id:'beta',name:'Beta'}]},'/api/provider-nodes':{nodes:[]},'/api/usage/quota':{providers:rows.filter(r=>!u.searchParams.has('tag') || r.tag===u.searchParams.get('tag').trim().toLowerCase())}}; return route.fulfill({status:u.pathname in fixtures?200:501,json:fixtures[u.pathname]??{error:'unexpected'}});} if(u.origin!==base.origin || !['GET','HEAD'].includes(req.method())) return route.abort(); return route.continue();});
 await page.goto(new URL('quota',base).href); await page.getByText('Alice',{exact:true}).waitFor();
 const tag=page.getByRole('searchbox',{name:'Filter by tag'}); await tag.fill(' BLUE '); await page.getByRole('button',{name:'Apply tag filter'}).click(); await page.waitForFunction(()=>document.querySelectorAll('.quota-account').length===1); assert.equal(await page.getByText('Alice',{exact:true}).count(),1); assert.equal(await page.getByText('Bob',{exact:true}).count(),0);
 await page.getByRole('searchbox',{name:'Search accounts'}).fill('Bob'); assert.equal(await page.locator('.quota-account').count(),0); await page.getByRole('searchbox',{name:'Search accounts'}).fill('');
 await page.getByRole('button',{name:/Beta/}).click(); await page.getByText('Carol',{exact:true}).waitFor(); await page.getByRole('button',{name:'Clear tag filter'}).click(); await page.getByText('Carol',{exact:true}).waitFor(); assert.ok(requests.some(x=>new URL(x,base).searchParams.get('tag')==='BLUE'));
 } finally { await browser.close(); }
});
