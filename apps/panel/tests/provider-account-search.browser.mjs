// Isolated component fixture: all APIs and external requests are intercepted; never use production.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.PANEL_TEST_URL || 'http://127.0.0.1:5199/panel/');
if (!['127.0.0.1','localhost','[::1]'].includes(base.hostname)) throw new Error('Local fixture only');
const accounts = [
  {id:'a',name:'Alice Sample',provider:'alpha',authType:'oauth'}, {id:'b',name:'Bob Fixture',provider:'alpha',authType:'oauth'},
  {id:'c',name:'Carol Custom',provider:'custom1',authType:'apikey'}, {id:'d',name:'Derek Custom',provider:'custom1',authType:'apikey'},
].map(a=>({...a,isActive:true,testStatus:'active',lastError:null,backoffLevel:0}));
let browser;
test.before(async()=>{browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});});
test.after(async()=>browser?.close());
async function setup(width=1440,theme='light') {
  const context=await browser.newContext({viewport:{width,height:900}}), page=await context.newPage(), requests=[], unexpected=[], errors=[];
  page.setDefaultTimeout(5000); page.setDefaultNavigationTimeout(30000); page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(theme=>localStorage.setItem('styx-panel-preferences',JSON.stringify({theme,language:'en',providerView:'cards'})),theme);
  await page.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url());
    if(u.pathname.startsWith('/api/') || u.pathname.startsWith('/v1/')) {
      requests.push({method:req.method(),path:u.pathname});
      const fixtures={'/api/providers':{providers:[{id:'alpha',name:'Alpha',authModes:['oauth','apikey']}]},'/api/provider-nodes':{nodes:[{id:'custom1',name:'Custom Provider',prefix:'custom',type:'openai-compatible',apiType:'chat',baseUrl:'https://example.test'}]},'/api/connections':{connections:accounts},'/api/oauth/providers':{providers:[]}};
      if(req.method()==='GET' && u.pathname in fixtures) return route.fulfill({json:fixtures[u.pathname]});
      if(req.method()==='DELETE' && u.pathname==='/api/connections/a') return route.fulfill({json:{ok:true}});
      unexpected.push(`${req.method()} ${u.pathname}`); return route.fulfill({status:501,json:{error:'Unexpected request'}});
    }
    if(u.origin!==base.origin || !['GET','HEAD'].includes(req.method())) { if(!u.origin.includes('fonts.google')) unexpected.push(`${req.method()} ${u.href}`); return route.abort(); }
    return route.continue();
  });
  await page.goto(new URL('tests/provider-account-search.fixture.html',base).href);
  return {context,page,requests,unexpected,errors};
}
function clean(s){assert.deepEqual(s.unexpected,[]);assert.deepEqual(s.errors,[]);}
async function enter(s,custom=false){
  if(custom) await s.page.getByRole('tab',{name:/Custom/}).click();
  await s.page.getByRole('link',{name:custom?/Custom Provider/:/Alpha/}).first().click();
  await s.page.getByText(custom?'Carol Custom':'Alice Sample',{exact:true}).waitFor();
}
for(const width of [320,390,768,1024,1440]) for(const theme of ['light','dark']) test(`provider search placeholder fits ${width} ${theme}`,async()=>{const s=await setup(width,theme);try{const box=s.page.getByRole('searchbox',{name:'Search providers'});await box.waitFor();const fit=await box.evaluate(e=>{const css=getComputedStyle(e),ctx=document.createElement('canvas').getContext('2d');ctx.font=css.font;return {text:ctx.measureText(e.placeholder).width,available:e.clientWidth-parseFloat(css.paddingLeft)-parseFloat(css.paddingRight)};});assert.ok(fit.text<=fit.available,JSON.stringify(fit));clean(s);}finally{await s.context.close();}});
for(const width of [1440,320]) test(`account filtering and safe visible bulk scope at ${width}px`,async()=>{
 const s=await setup(width); try {
  await enter(s); const p=s.page, search=p.getByRole('searchbox',{name:'Search accounts'});
  await search.focus(); assert.equal(await search.evaluate(e=>e===document.activeElement),true);
  await p.keyboard.type('aLiCe');
  assert.equal(await p.getByText('Alice Sample',{exact:true}).count(),1); assert.equal(await p.getByText('Bob Fixture',{exact:true}).count(),0);
  assert.equal(await p.locator('tbody tr').count(),1);
  await p.getByRole('checkbox',{name:/Select all/}).check();
  await search.fill('bob');
  assert.equal(await p.getByRole('button',{name:'Delete selected'}).isDisabled(),true,'hidden selections cannot be deleted');
  await search.fill('alice');
  await p.getByRole('checkbox',{name:/Select all/}).check();
  await p.getByRole('button',{name:'Delete selected'}).click();
  const confirmation=p.getByRole('dialog'); assert.match(await confirmation.innerText(),/1 selected account/);
  await confirmation.getByRole('button',{name:'Confirm'}).click();
  await p.getByText(/Bulk result:/).waitFor();
  assert.deepEqual(s.requests.filter(r=>r.method==='DELETE').map(r=>r.path),['/api/connections/a']);
  await search.fill('nobody'); assert.equal(await p.getByText('No matching accounts',{exact:true}).isVisible(),true);
  assert.equal(await p.locator('tbody tr').count(),0);
  await search.fill(''); assert.equal(await p.getByText('Bob Fixture',{exact:true}).isVisible(),true);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth),0);
  clean(s);
 } finally {await s.context.close();}
});
test('custom provider uses the same account search',async()=>{
 const s=await setup(); try {await enter(s,true);const search=s.page.getByRole('searchbox',{name:'Search accounts'});await search.fill('cArOl');assert.equal(await s.page.getByText('Carol Custom',{exact:true}).count(),1);assert.equal(await s.page.getByText('Derek Custom',{exact:true}).count(),0);await search.fill('');assert.equal(await s.page.getByText('Derek Custom',{exact:true}).count(),1);clean(s);}finally{await s.context.close();}
});
for(const width of [1440,320]) for(const theme of ['light','dark']) test(`account search layout ${width} ${theme}`,async()=>{
 const s=await setup(width,theme);try{await enter(s);const p=s.page,search=p.getByRole('searchbox',{name:'Search accounts'});await search.fill('Alice');
 const hint=await p.locator('.provider-account-search-hint').evaluate(el=>({size:getComputedStyle(el).fontSize,weight:getComputedStyle(el).fontWeight}));assert.deepEqual(hint,{size:'14px',weight:'400'});
 const box=await search.boundingBox();assert.ok(box && box.x>=0 && box.x+box.width<=width);if(width===320)assert.ok(box.height>=44);
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth),0);
 if(width===320){const table=p.getByRole('region',{name:'Connected accounts'});await p.locator('.table-scroll-hint').getByText('Scroll table horizontally ↔').waitFor({state:'visible'});const before=await table.evaluate(el=>({left:el.scrollLeft,max:el.scrollWidth-el.clientWidth}));assert.ok(before.max>0,JSON.stringify(before));await table.focus();await p.keyboard.press('ArrowRight');await p.waitForFunction(el=>el.scrollLeft>0,await table.elementHandle());const metrics=await table.evaluate(el=>({left:el.scrollLeft,max:el.scrollWidth-el.clientWidth}));assert.ok(metrics.max>0 && metrics.left>0,JSON.stringify(metrics));}
 const dir=process.env.PROVIDER_SEARCH_SCREENSHOTS;if(dir){await mkdir(dir,{recursive:true});await p.screenshot({path:`${dir}/provider-search-${width}-${theme}.png`,fullPage:true,animations:'disabled'});}
 clean(s);}finally{await s.context.close();}
});
