import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const evidence=process.env.CREDENTIAL_EVIDENCE;
mkdirSync(evidence,{recursive:true});
const vite=await createServer({cacheDir:evidence+'/.vite',root:new URL('..',import.meta.url).pathname,configFile:false,esbuild:{jsx:'automatic'},base:'/panel/',server:{host:'127.0.0.1',port:0},appType:'spa'});
await vite.listen();
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
const page=await browser.newPage({reducedMotion:'reduce'});page.setDefaultTimeout(10000);
if(process.env.CREDENTIAL_FONT_FIXTURE){const {installFonts}=await import(process.env.CREDENTIAL_FONT_FIXTURE);await installFonts(page);}
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
let nodes=[],connections=[],creates=0,saves=0,failKey=true,delayCreate=0;
await page.route('**/*',async route=>{
 const r=route.request(),u=new URL(r.url());
 if(u.hostname!=='127.0.0.1') return route.abort();
 if(!u.pathname.startsWith('/api/'))return route.continue();
 let body={};
 if(r.method()==='POST'&&u.pathname==='/api/provider-nodes') {creates++;const data=r.postDataJSON();assert.equal('apiKey' in data,false);const node={...data,id:`custom-fixture-${creates}`,customHeaders:null};nodes.push(node);if(delayCreate)await new Promise(r=>setTimeout(r,delayCreate));body={node};}
 else if(r.method()==='POST'&&u.pathname==='/api/connections'){saves++;assert.equal(r.postDataJSON().provider,nodes.at(-1).id);if(failKey)return route.fulfill({status:422,json:{error:'Fixture save failed'}});connections.push({id:'fixture-account',provider:nodes.at(-1).id,isActive:true,testStatus:null,name:'Fixture account',authType:'apikey'});body={connection:connections.at(-1)};}
 else if(r.method()!=='GET')throw new Error(`Unexpected write ${u.pathname}`);
 else if(u.pathname==='/api/auth/session')body={authenticated:true};
 else if(u.pathname==='/api/providers')body={providers:[]};
 else if(u.pathname==='/api/provider-nodes')body={nodes};
 else if(u.pathname==='/api/connections')body={connections};
 else if(u.pathname==='/api/oauth/providers')body={providers:[]};
 else body={authenticated:true};
 return route.fulfill({json:body});
});
const base=vite.resolvedUrls.local[0];
await page.goto(base+'providers?tab=custom');
await page.getByRole('button',{name:'New custom provider',exact:true}).first().click();
let dialog=page.getByRole('dialog');
await dialog.getByLabel('Name',{exact:true}).fill('Fixture endpoint');
await dialog.getByLabel('Request prefix',{exact:true}).fill('fixture');
await dialog.getByLabel('Base URL',{exact:true}).fill('https://fixture.invalid/v1');
await dialog.getByRole('button',{name:'Create & add API key',exact:true}).click();
await page.getByRole('dialog',{name:'Add API key — Fixture endpoint'}).waitFor();
assert.equal(creates,1);
dialog=page.getByRole('dialog');
assert.equal(await dialog.getByLabel('API key / token').getAttribute('type'),'password');
await dialog.getByLabel('API key / token').fill('synthetic-fixture-key-only');
await dialog.getByRole('button',{name:'Save key',exact:true}).click();
await dialog.getByText('API key could not be saved. The endpoint is retained; retry saving the key only.').waitFor();assert.equal(creates,1);assert.equal(saves,1);
assert.ok(page.url().includes(nodes[0].id));
assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}).includes('synthetic-fixture-key-only')),false);
page.once('dialog',d=>d.dismiss());await page.keyboard.press('Escape');await dialog.waitFor();
page.once('dialog',d=>d.accept());await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
await dialog.waitFor({state:'hidden'});
await page.waitForFunction(()=>document.activeElement?.textContent?.trim()==='Add API key');
await page.getByRole('button',{name:'Add API key',exact:true}).click();
assert.equal(await page.getByLabel('API key / token').inputValue(),'');
await page.getByLabel('API key / token').fill('synthetic-fixture-key-only');failKey=false;
await page.getByRole('button',{name:'Save key',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
assert.equal(creates,1);assert.equal(saves,2);
for(const width of [320,390,600,860,861,1280])for(const theme of ['light','dark']) {
 await page.setViewportSize({width,height:900});await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
 await page.getByRole('button',{name:'Add API key',exact:true}).click();
 const box=await page.getByRole('dialog').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width);
 await page.screenshot({path:`${evidence}/credential-${width}-${theme}.png`,fullPage:true});
 await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
}
// A canceled in-flight creation may finish server-side, but must never reopen a modal.
await page.goto(base+'providers?tab=custom');await page.getByRole('button',{name:'New custom provider',exact:true}).first().click();
dialog=page.getByRole('dialog');await dialog.getByLabel('Name',{exact:true}).fill('Late fixture');await dialog.getByLabel('Request prefix',{exact:true}).fill('late');await dialog.getByLabel('Base URL',{exact:true}).fill('https://fixture.invalid');delayCreate=400;
await dialog.getByRole('button',{name:'Create & add API key',exact:true}).click();page.once('dialog',d=>d.accept());await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await page.waitForTimeout(650);assert.equal(await page.getByRole('dialog').count(),0);assert.ok(page.url().includes('providers?tab=custom'));
// Repeat the responsive modal contract under the actual Indonesian preference and both themes.
for(const width of [320,390,600,860,861,1280])for(const theme of ['light','dark']) {
 await page.setViewportSize({width,height:900});
 await page.evaluate(({theme})=>{localStorage.setItem('styx-panel-preferences',JSON.stringify({language:'id',theme,providerView:'cards'}));},{theme});
 await page.goto(base+'providers/'+nodes[0].id+'?tab=custom');
 await page.getByRole('button',{name:'Tambah kunci API',exact:true}).click();
 const modal=page.getByRole('dialog');const box=await modal.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width);
 assert.equal(await modal.getByLabel('Kunci API / token').getAttribute('type'),'password');
 await page.screenshot({path:`${evidence}/credential-${width}-${theme}-id.png`,fullPage:true});
 await page.keyboard.press('Escape');await modal.waitFor({state:'hidden'});
}
// A lost key-write response is unknown: the same mounted provider cannot submit twice.
await page.evaluate(()=>localStorage.setItem('styx-panel-preferences',JSON.stringify({language:'en',theme:'light'})));
await page.goto(base+'providers/'+nodes[0].id+'?tab=custom');
await page.route('**/api/connections',async route=>{if(route.request().method()==='POST'){saves++;return route.abort('failed');}return route.fallback();});
await page.getByRole('button',{name:'Add API key',exact:true}).click();
await page.getByLabel('API key / token').fill('synthetic-unknown-write');
await page.getByRole('button',{name:'Save key',exact:true}).click();
await page.getByRole('dialog').getByText('Key save was not confirmed. Reload and inspect accounts before adding another key.').waitFor();
assert.equal(await page.getByRole('button',{name:'Save key',exact:true}).isDisabled(),true);
assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,creates,saves,screenshots:24,errors}));
} finally {await browser.close();await vite.close();}
