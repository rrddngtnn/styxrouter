import { test } from 'node:test';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.PANEL_TEST_URL || 'http://127.0.0.1:5199/panel/');
if (!['127.0.0.1','localhost','[::1]'].includes(base.hostname)) throw new Error('Local fixture only');
test('selected account actions confirm, scope requests and report partial failures', async () => {
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage(), writes=[];
 try {
 await page.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());
  if(u.pathname.startsWith('/api/')) {const fixtures={'/api/providers':{providers:[{id:'alpha',name:'Alpha',authModes:['apikey']}]},'/api/provider-nodes':{nodes:[]},'/api/connections':{connections:['a','b'].map(id=>({id,name:id,provider:'alpha',isActive:true,testStatus:'active',authType:'apikey',lastError:null,backoffLevel:0}))},'/api/oauth/providers':{providers:[]}};
   if(req.method()==='GET' && u.pathname in fixtures) return route.fulfill({json:fixtures[u.pathname]});
   if(req.method()==='POST' && u.pathname.startsWith('/api/connections/bulk-')) {writes.push({path:u.pathname,body:req.postDataJSON()});return route.fulfill({json:{results:[{id:'a',success:true},{id:'b',success:false,error:'Fixture failure'}]}});}
   return route.fulfill({status:501,json:{error:'Unexpected request'}});
  } if(u.origin!==base.origin || !['GET','HEAD'].includes(req.method())) return route.abort(); return route.continue(); });
 await page.goto(new URL('tests/provider-account-search.fixture.html',base).href); await page.getByRole('tab',{name:/API Keys/}).click(); await page.getByRole('link',{name:/Alpha/}).first().click();
 await page.getByRole('checkbox',{name:/Select all/}).check();
 await page.getByRole('button',{name:'Rename selected'}).click();
 let dialog=page.getByRole('dialog'); await dialog.getByLabel('Rename pattern').fill('Team {name} {index}');
 assert.equal(writes.length,0); await dialog.getByRole('button',{name:'Confirm'}).click();
 await page.getByText(/1 succeeded/).first().waitFor(); assert.deepEqual(writes[0],{path:'/api/connections/bulk-rename',body:{ids:['a','b'],pattern:'Team {name} {index}'}});
 assert.match(await page.locator('body').innerText(),/Fixture failure/);
 await page.getByRole('button',{name:'Add tag'}).click(); dialog=page.getByRole('dialog'); await dialog.getByLabel('Tag').fill('@team'); await dialog.getByRole('button',{name:'Confirm'}).click(); await page.waitForFunction(()=>document.querySelector('[role=status]')!==null); await page.waitForTimeout(100); assert.deepEqual(writes[1],{path:'/api/connections/bulk-tags',body:{ids:['a','b'],operation:'add',tags:['@team']}});
 await page.getByRole('button',{name:'Remove tag'}).click(); dialog=page.getByRole('dialog'); await dialog.getByLabel('Tag').fill('@team'); await dialog.getByRole('button',{name:'Confirm'}).click(); await page.waitForTimeout(100); assert.deepEqual(writes[2],{path:'/api/connections/bulk-tags',body:{ids:['a','b'],operation:'remove',tags:['@team']}});
 await page.getByRole('button',{name:'Remove tag'}).click(); dialog=page.getByRole('dialog'); await page.keyboard.press('Escape'); await dialog.waitFor({state:'hidden'}); assert.equal(writes.length,3);
 await page.getByRole('button',{name:'Clear cooldown'}).click(); dialog=page.getByRole('dialog'); assert.match(await dialog.innerText(),/2 selected/); await dialog.getByRole('button',{name:'Confirm'}).click(); await page.waitForTimeout(100); assert.deepEqual(writes[3],{path:'/api/connections/bulk-release-cooldown',body:{ids:['a','b']}});
 } finally {await browser.close();}
});
