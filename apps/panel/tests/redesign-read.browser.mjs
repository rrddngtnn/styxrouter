import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
try {
 const c=await browser.newContext({serviceWorkers:'block'}),p=await c.newPage();let failure=false,blocked=null;
 await c.route('**/*',async r=>{const u=new URL(r.request().url());if(u.origin!=='http://127.0.0.1:5198')return r.abort();if(u.pathname.startsWith('/api/read/')){assert.equal(r.request().method(),'GET');if(blocked)await blocked;return r.fulfill({status:typeof failure==='number'?failure:failure?503:200,json:failure?{error:'temporarily unavailable'}:{value:u.pathname.endsWith('/a')?'A':'B'}});}return r.continue();});
 await p.goto('http://127.0.0.1:5198/panel/tests/redesign-read.fixture.html');
 const state=()=>p.locator('#state').evaluate(e=>JSON.parse(e.textContent));
 await p.waitForFunction(()=>JSON.parse(document.querySelector('#state').textContent).status==='ok');
 failure=true;await p.getByText('Reload',{exact:true}).click();await p.waitForFunction(()=>!JSON.parse(document.querySelector('#state').textContent).pending);
 let s=await state();assert.equal(s.data?.value,'A','failed same-scope refresh retains successful payload');assert.equal(s.status,'ok');assert.equal(s.stale,true);assert.equal(s.error.status,503);assert.ok(s.lastSuccessAt);
 failure=false;let release;blocked=new Promise(r=>release=r);await p.getByText('Scope B',{exact:true}).click();await p.waitForFunction(()=>JSON.parse(document.querySelector('#state').textContent).pending);s=await state();assert.equal(s.data,null,'different scope cannot show prior payload');release();blocked=null;await p.waitForFunction(()=>JSON.parse(document.querySelector('#state').textContent).data?.value==='B');
 failure=false;await p.getByText('Reload',{exact:true}).click();await p.waitForFunction(()=>!JSON.parse(document.querySelector('#state').textContent).pending);s=await state();assert.equal(s.stale,false);assert.equal(s.error,null);
 failure=403;await p.getByText('Reload',{exact:true}).click();await p.waitForFunction(()=>JSON.parse(document.querySelector('#state').textContent).status==='error');s=await state();assert.equal(s.data,null,'permission loss clears cached private data');assert.equal(s.error.status,403);
 await p.getByText('Disable',{exact:true}).click();await p.waitForFunction(()=>JSON.parse(document.querySelector('#state').textContent).data===null);assert.equal((await state()).pending,false);
 console.log('PASS useFetch retained stale payload + original ApiError, scope reset, disabled pending cleanup');await c.close();
}finally{await browser.close();}
