import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {known,account} from './redesign-api.fixture.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const origin=new URL(process.env.PANEL_TEST_URL??'http://127.0.0.1:5198').origin;
assert.equal(new URL(origin).hostname,'127.0.0.1');
const output=process.env.REDESIGN_EVIDENCE;
await mkdir(output,{recursive:true});
for(const width of [320,390]) for(const theme of ['light','dark']) test(`provider account real pointer actions ${width} ${theme}`,async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try {
 const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce',serviceWorkers:'block'});page.setDefaultTimeout(2500);
 const writes=[],unexpected=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(p=>localStorage.setItem('styx-panel-preferences',JSON.stringify(p)),{theme,language:'en'});
 await page.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url());
  if(u.origin!==origin)return route.abort();
  if(/^\/(api|v1)\//.test(u.pathname)){
   if(req.method()!=='GET'){
    assert.equal(req.headers().authorization,undefined);
    writes.push({path:u.pathname,body:req.postDataJSON()});
    if(u.pathname==='/api/model-test'){
     assert.deepEqual(req.postDataJSON(),{model:'openai/fixture-model',connectionId:account.id});
     return route.fulfill({json:{ok:true,status:'success',output:'Synthetic pointer completion',model:'openai/fixture-model'}});
    }
    if(u.pathname===`/api/connections/${account.id}/test`)return route.fulfill({json:{ok:true,error:null}});
   }else if(Object.hasOwn(known,u.pathname))return route.fulfill({json:known[u.pathname]});
   unexpected.push(`${req.method()} ${u.pathname}`);return route.fulfill({status:501,json:{error:'Unexpected fixture request'}});
  }
  return route.continue();
 });
 await page.goto(`${origin}/panel/providers/openai?auth=apikey`);
 await page.getByRole('button',{name:account.name,exact:true}).click();
 const row=page.locator('.account-inspect');await row.waitFor();
 assert.equal(await row.locator('.row-actions button').count(),6,'retain every API-key account action');
 assert.equal(writes.length,0);
 try {await row.getByRole('button',{name:'Test Model',exact:true}).click();}
 catch(error){
  const geometry=await row.evaluate(e=>({cells:[...e.children].map(c=>({text:c.textContent,rect:c.getBoundingClientRect().toJSON(),display:getComputedStyle(c).display,z:getComputedStyle(c).zIndex})),buttons:[...e.querySelectorAll('button')].map(b=>{const r=b.getBoundingClientRect();return {text:b.textContent,rect:r.toJSON(),hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML};}),region:e.closest('[role=region]').getBoundingClientRect().toJSON()}));
  await writeFile(`${output}/hit-test-${width}-${theme}.json`,JSON.stringify(geometry,null,2));
  await page.screenshot({path:`${output}/failure-${width}-${theme}.png`,fullPage:true});throw error;
 }
 const dialog=page.getByRole('dialog');await dialog.getByLabel('Model',{exact:true}).selectOption('fixture-model');assert.equal(writes.length,0,'opening model dialog must not infer');
 await dialog.getByRole('button',{name:'Run inference',exact:true}).click();await dialog.getByText('Synthetic pointer completion',{exact:true}).waitFor();
 assert.equal(writes.length,1);await page.keyboard.press('Escape');
 await row.getByRole('button',{name:'Test',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.account-inspect')?.textContent.includes('key works ✓'));
 assert.equal(writes.length,2);assert.equal(writes[1].path,`/api/connections/${account.id}/test`);
 await row.getByRole('button',{name:'Model rules',exact:true}).click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');
 await row.getByRole('button',{name:'Rotate key',exact:true}).click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');
 assert.equal(writes.length,2,'cancel-only forms must not mutate');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth),0);
 for(const button of await row.getByRole('button').all()) {
  await button.scrollIntoViewIfNeeded();
  assert.ok(await button.evaluate(b=>{const r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),`${await button.textContent()} pointer target exposed`);
 }
 await row.screenshot({path:`${output}/actions-${width}-${theme}.png`});
 assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);
 } finally {await browser.close();}
});
