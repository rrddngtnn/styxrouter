import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '../../server/node_modules/playwright/index.mjs';
const base = 'http://127.0.0.1:5219/panel/';
const browser = await chromium.launch({ args: ['--no-sandbox'] });
async function fixture(t, inventory) {
 const page = await browser.newPage(); t.after(() => page.close());
 const posts=[];
 await page.route('**/*', async route => {
  const req=route.request(), url=new URL(req.url());
  if(url.pathname.startsWith('/api/')) {
   if(url.pathname==='/api/usage/codex-reset-credit') {
    if(req.method()==='POST') { posts.push(req.postDataJSON()); return route.fulfill({json:{ok:true,outcome:'reset',quotaRefreshed:false,usage:null}}); }
    return inventory(route,url.searchParams.get('connectionId'));
   }
   const fixtures={'/api/usage/quota':{providers:['a','b'].map(id=>({connectionId:id,name:`Account ${id}`,provider:'codex',isActive:true,tokenStatus:'valid',bankedResetCredits:5}))},'/api/providers':{providers:[]},'/api/provider-nodes':{nodes:[]},'/api/quota-pools':{pools:[]}};
   return route.fulfill({status:url.pathname in fixtures?200:501,json:fixtures[url.pathname]??{error:'unexpected fixture request'}});
  }
  if(url.origin!==new URL(base).origin) return route.abort();
  if(url.pathname==='/panel/src/main.tsx') return route.fulfill({contentType:'application/javascript',body:`
    import React from '/panel/node_modules/.vite/deps/react.js';
    import ReactDOM from '/panel/node_modules/.vite/deps/react-dom_client.js';
    import { Theme } from '/panel/node_modules/.vite/deps/@radix-ui_themes.js';
    import { PreferencesProvider } from '/panel/src/lib/preferences.tsx';
    import { Quota } from '/panel/src/pages/Quota.tsx';
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Theme,null,React.createElement(PreferencesProvider,null,React.createElement(Quota))));`});
  return route.continue();
 });
 await page.goto(base); await page.getByRole('heading',{name:'Account a',exact:true}).waitFor();
 return {page,posts};
}
test.after(async()=>browser.close());
test('inventory failure cannot expose a spend action from a cached positive count', async t=>{
 const {page,posts}=await fixture(t,route=>route.fulfill({status:503,json:{error:'Inventory unavailable'}}));
 await page.locator('.quota-account').first().getByRole('button',{name:'Redeem reset',exact:true}).click();
 await page.getByText('Inventory unavailable',{exact:true}).waitFor();
 const redeem=page.getByRole('button',{name:'Redeem earliest expiring credit',exact:true});
 assert.equal(await redeem.isDisabled(),true);
 assert.equal(posts.length,0);
});
test('late inventory from a closed account cannot populate another account modal',async t=>{
 let release; const gate=new Promise(resolve=>release=resolve);
 const {page}=await fixture(t,async(route,id)=>{if(id==='a')await gate; await route.fulfill({json:{ok:true,availableCount:1,credits:[{selectionToken:`credit-${id}`,title:`Credit ${id}`}]}});});
 await page.locator('.quota-account').first().getByRole('button',{name:'Redeem reset',exact:true}).click();
 await page.getByRole('button',{name:'Close',exact:true}).click();
 await page.locator('.quota-account').nth(1).getByRole('button',{name:'Redeem reset',exact:true}).click();
 await page.getByText('Credit b',{exact:true}).waitFor(); release();
 await page.waitForTimeout(200);
 assert.equal(await page.getByText('Credit a',{exact:true}).count(),0);
 assert.equal(await page.getByText('Credit b',{exact:true}).count(),1);
});
test('redemption requires explicit confirmation and cancellation never posts',async t=>{
 const {page,posts}=await fixture(t,route=>route.fulfill({json:{ok:true,availableCount:1,credits:[{selectionToken:'c',title:'Credit c'}]}}));
 await page.locator('.quota-account').first().getByRole('button',{name:'Redeem reset',exact:true}).click();
 await page.getByText('Credit c',{exact:true}).waitFor();
 let confirmed=false; page.on('dialog',async d=>{confirmed=true;await d.dismiss();});
 await page.getByRole('button',{name:'Redeem this credit',exact:true}).click();
 assert.equal(confirmed,true); assert.equal(posts.length,0);
});
