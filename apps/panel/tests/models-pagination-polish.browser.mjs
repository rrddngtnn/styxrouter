import assert from 'node:assert/strict';
import { test } from 'node:test';
import { known } from './redesign-api.fixture.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.PANEL_TEST_URL || 'http://127.0.0.1:5198';
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname));
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const rows = n => Array.from({length:n},(_,i)=>({id:`openai/model-${i}`,owned_by:'openai',type:'chat'}));
async function fixture({width=320,touch=true,theme='light',density='comfortable',language='en',data=rows(180)}={}) {
 const context=await browser.newContext({viewport:{width,height:900},hasTouch:touch,reducedMotion:'reduce',serviceWorkers:'block'});
 await context.addInitScript(p=>localStorage.setItem('styx-panel-preferences',JSON.stringify(p)),{theme,density,language});
 const page=await context.newPage(), writes=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',route=>{const req=route.request(),u=new URL(req.url());if(u.origin!==new URL(origin).origin)return route.abort();if(/^\/(api|v1)\//.test(u.pathname)){if(req.method()!=='GET'){writes.push(req.method()+' '+u.pathname);return route.abort();}return route.fulfill({json:u.pathname==='/v1/models'?{data}:known[u.pathname]??{}});}return route.continue();});
 await page.goto(`${origin}/panel/models`,{waitUntil:'networkidle'});
 await page.locator('.r6-models .toolbar').waitFor();
 return {context,page,writes,errors};
}
try {
 await test('shared numeric targets and wrapping across pointer, density, theme and mobile widths',async()=>{
  for(const width of [320,390,600])for(const touch of [false,true])for(const density of ['compact','comfortable'])for(const theme of ['light','dark']){
   const f=await fixture({width,touch,density,theme});try{
    const nav=f.page.locator('.pagination');await nav.waitFor();
    for(const position of ['first','middle','last']){
     if(position==='middle'){await nav.getByLabel('Go to page',{exact:true}).fill('5');await nav.getByRole('button',{name:'Go',exact:true}).click();await nav.locator('[aria-current="page"]').filter({hasText:'5'}).waitFor();}
     if(position==='last'){await nav.getByRole('button',{name:'Go to page 9',exact:true}).click();await nav.locator('[aria-current="page"]').filter({hasText:'9'}).waitFor();}
     const geometry=await nav.evaluate(el=>({overflow:document.documentElement.scrollWidth-innerWidth,local:el.scrollWidth-el.clientWidth,buttons:[...el.querySelectorAll('.pagination-number')].map(b=>({text:b.textContent,width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height}))}));
     for(const b of geometry.buttons)assert.ok(b.width>=44&&b.height>=44,JSON.stringify({width,touch,density,theme,position,b}));
     assert.ok(geometry.overflow<=0&&geometry.local<=0,JSON.stringify({width,touch,density,theme,position,geometry}));
     assert.equal(await nav.getByRole('button',{name:'Previous',exact:true}).isDisabled(),position==='first');assert.equal(await nav.getByRole('button',{name:'Next',exact:true}).isDisabled(),position==='last');
    }
    assert.deepEqual(f.writes,[]);assert.deepEqual(f.errors,[]);
   }finally{await f.context.close();}
  }
 });
 await test('real flat and grouped counts retain their units in EN/ID on desktop and mobile',async()=>{
  for(const width of [320,390,1280])for(const language of ['en','id'])for(const n of [0,1,2])for(const grouped of [false,true]){
   if(grouped&&n!==2)continue;
   const data=rows(n);if(grouped)data[1].parent='model-0';
   const f=await fixture({width,language,data});try{
    const unit=language==='id'?'model':n===1?'model':'models';
    await f.page.locator('.r6-models .toolbar').getByText(`${n} ${unit}`,{exact:true}).waitFor();
    if(!n)assert.equal(await f.page.locator('.pagination').count(),0);
    else {const count=grouped?1:n;const entity=grouped?(language==='id'?'keluarga model':'model family'):unit;await f.page.locator('.pagination-summary').getByText(`1–${count} ${language==='id'?'dari':'of'} ${count} ${entity}`,{exact:true}).waitFor();}
    assert.deepEqual(f.writes,[]);assert.deepEqual(f.errors,[]);
   }finally{await f.context.close();}
  }
 });
}finally{await browser.close();}
