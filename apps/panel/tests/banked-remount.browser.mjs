import assert from 'node:assert/strict';
const baseURL = process.env.STYX_TEST_BASE_URL || 'http://127.0.0.1:5207';
assert.match(baseURL, /^http:\/\/127\.0\.0\.1:\d+$/);
const fixtureURL = `${baseURL}/panel/tests/confirmations-credits.fixture.html`;
// Every API request is fulfilled/aborted below; no live API writes are allowed.
// PLAYWRIGHT_MODULE and CHROMIUM_PATH are caller-provided local tooling, not repository paths.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{
 const p=await browser.newPage();let posts=[],mode='unknown';
 await p.addInitScript(()=>localStorage.setItem('styx-panel-preferences',JSON.stringify({language:'en',theme:'light'})));
 p.on('pageerror',e=>console.log('PAGEERROR',e.message));
 await p.route('**/*',async r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==baseURL)return r.abort();if(!/^\/(api|v1)\//.test(u.pathname))return r.continue();
 if(u.pathname==='/api/usage/quota')return r.fulfill({json:{providers:['A','B'].map(id=>({connectionId:'private-account-'+id,provider:'codex',name:'Account '+id,tokenStatus:'valid',isActive:true,bankedResetCredits:1,windows:[]}))}});
 if(u.pathname==='/api/usage/codex-reset-credit') {if(q.method()==='GET')return r.fulfill({json:{ok:true,availableCount:1,credits:[{selectionToken:'private-selection',title:'Test credit'}]}});posts.push(q.postDataJSON());assert.ok((await p.evaluate(()=>JSON.stringify({...sessionStorage}))).includes(posts.at(-1).idempotencyKey),'attempt persisted before POST');return mode==='unknown'?r.abort('timedout'):mode==='auth'?r.fulfill({status:401,json:{error:'Unauthorized'}}):mode==='rejected'?r.fulfill({status:409,json:{ok:false,code:'nothing_to_reset',error:'Not exhausted'}}):r.fulfill({json:{ok:true,outcome:'reset',quotaRefreshed:false}});}
 return r.fulfill({json:{providers:[],nodes:[],pools:[]}});});
 const open=async(i=0)=>{await p.getByRole('button',{name:'Reset credits',exact:true}).nth(i).click();await p.getByRole('button',{name:'Refresh inventory'}).waitFor();};
 const spend=async()=>{await p.getByRole('button',{name:'Redeem this credit',exact:true}).click();await p.locator('.styx-confirmation').getByRole('button',{name:'Redeem this credit',exact:true}).click();};
 await p.goto(fixtureURL);await open();await spend();await p.getByText('Outcome unknown.',{exact:false}).last().waitFor();assert.equal(posts.length,1);
 await p.getByRole('button',{name:'Close',exact:true}).click();
 await p.getByRole('button',{name:'Toggle quota mount'}).click();await p.getByRole('button',{name:'Toggle quota mount'}).click();
 await open();assert.ok(await p.getByRole('button',{name:'Redeem earliest expiring credit'}).isDisabled());assert.match(await p.getByRole('dialog').textContent(),/Outcome unknown/);await p.getByRole('button',{name:'Refresh inventory'}).click();assert.ok(await p.getByRole('button',{name:'Redeem earliest expiring credit'}).isDisabled());await p.getByRole('button',{name:'Close',exact:true}).click();
 await p.reload();await open();assert.ok(await p.getByRole('button',{name:'Redeem earliest expiring credit'}).isDisabled());assert.equal(posts.length,1);await p.getByRole('button',{name:'Close',exact:true}).click();
 mode='rejected';await open(1);await spend();await p.getByText('Redemption rejected.',{exact:false}).waitFor();assert.equal(posts.length,2);await p.getByRole('button',{name:'Refresh inventory'}).click();await p.getByRole('button',{name:'Redeem this credit',exact:true}).waitFor();mode='partial';await spend();await p.getByRole('dialog').waitFor({state:'hidden'});assert.equal(posts.length,3);assert.equal(posts[1].idempotencyKey,posts[2].idempotencyKey);assert.equal(posts[0].creditId,'private-selection');assert.equal(posts[1].connectionId,'private-account-B');
 const stored=await p.evaluate(()=>JSON.stringify({...sessionStorage}));assert.ok(!stored.includes('private-'));assert.ok(stored.includes(posts[0].idempotencyKey));
 await open(1);assert.ok(await p.getByRole('button',{name:'Redeem earliest expiring credit'}).isDisabled());assert.equal(posts.length,3);
 await p.getByRole('button',{name:'Close',exact:true}).click();
 await p.evaluate(()=>sessionStorage.clear());mode='auth';await open();await spend();await p.waitForURL('**/panel/login');
 await p.goto(fixtureURL);await open();assert.match(await p.getByRole('dialog').textContent(),/Outcome unknown/);assert.ok(await p.getByRole('button',{name:'Redeem earliest expiring credit'}).isDisabled());assert.equal(posts.length,4);assert.ok(!(await p.evaluate(()=>JSON.stringify({...sessionStorage}))).includes('private-selection'));
 await p.getByRole('button',{name:'Close',exact:true}).click();await p.evaluate(()=>{sessionStorage.clear();const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('styx:banked-reset:'))throw Error('denied');return original.call(this,k,v);};});
 mode='partial';await open();await spend();await p.getByText('Safety storage unavailable. No credit was sent.',{exact:false}).last().waitFor();assert.equal(posts.length,4);assert.ok(await p.getByRole('button',{name:'Redeem earliest expiring credit'}).isDisabled());
 console.log('PASS auth redirect retains uncertainty without raw selection; denied storage sends zero POSTs');
 console.log('PASS timeout → unmount/remount → reload → inventory refresh: one POST; independent account rejected → new review → partial: two POSTs, same attempt; committed credit blocked; storage contains no raw identity');
}finally{await browser.close();}
