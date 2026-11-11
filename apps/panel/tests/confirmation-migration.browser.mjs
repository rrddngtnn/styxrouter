import {known,account} from './redesign-api.fixture.mjs';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try {
 const p=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'}); const writes=[];let native=0;
 p.on('dialog',async d=>{native++;await d.dismiss();});
 await p.addInitScript(()=>localStorage.setItem('styx-panel-preferences',JSON.stringify({language:'en',theme:'light'})));
 await p.route('**/*',route=>{const r=route.request(),u=new URL(r.url());if(u.hostname!=='127.0.0.1')return route.abort();if(!/^\/(api|v1)\//.test(u.pathname))return route.continue();if(r.method()!=='GET'){writes.push({path:u.pathname,body:r.postData()?JSON.parse(r.postData()):null});return route.fulfill({json:{ok:true,key:'synthetic-once'}});}if(u.pathname==='/api/auth/status')return route.fulfill({json:{authenticated:true}});if(u.pathname==='/api/keys')return route.fulfill({json:{keys:[{id:'key-exact-A',name:'Workstation A',isActive:true}]}});if(u.pathname==="/api/routing/combos")return route.fulfill({json:{combos:[{id:"combo-exact-A",name:"Fallback A",enabled:true,models:["openai/fixture-model"]}]}});if(u.pathname==="/api/providers/openai/models")return route.fulfill({json:{prefix:"openai",models:[{id:"manual-exact-A",name:"Manual A",origin:"manual"}]}});return route.fulfill({json:known[u.pathname]??{}});});
 await p.goto('http://127.0.0.1:5198/panel/keys');
 await p.getByRole('button',{name:'Regenerate',exact:true}).waitFor({timeout:5000}).catch(async e=>{console.log(await p.locator('body').innerText());throw e;});await p.getByRole('button',{name:'Regenerate',exact:true}).click();
 const d=p.locator('.styx-confirmation');await d.waitFor({timeout:3000});
 assert.match(await d.textContent(),/key-exact-A/);assert.equal(await p.evaluate(()=>document.activeElement.textContent),'Cancel');
 await p.keyboard.press('Enter');await d.waitFor({state:'hidden'});assert.equal(writes.length,0);
 for(const how of ['Escape','backdrop','Cancel']){await p.getByRole('button',{name:'Regenerate',exact:true}).click();await d.waitFor();if(how==='Escape')await p.keyboard.press('Escape');else if(how==='Cancel')await d.getByRole('button',{name:'Cancel',exact:true}).click();else await p.mouse.click(5,5);await d.waitFor({state:'hidden'});assert.equal(writes.length,0);}
 await p.getByRole('button',{name:'Regenerate',exact:true}).click();await d.getByRole('button',{name:'Regenerate',exact:true}).click();await p.waitForFunction(()=>document.querySelector('.secret-banner'));assert.equal(writes[0].path,'/api/keys/key-exact-A/regenerate');assert.equal(native,0);
 await p.goto('http://127.0.0.1:5198/panel/tools');await p.getByRole('button',{name:'Generate key for Claude Code',exact:true}).click();await d.waitFor({timeout:3000});await p.keyboard.press('Escape');await d.waitFor({state:'hidden'});assert.equal(writes.length,1);assert.equal(native,0);
 // Each destructive category: pointer opens, keyboard cancellation and accepted exact target.
 for(const [button,action,suffix] of [['Revoke','Revoke','/revoke'],['Delete','Delete','']]){
  await p.goto('http://127.0.0.1:5198/panel/keys');const start=writes.length;
  await p.getByRole('button',{name:button,exact:true}).click();await d.waitFor();await p.keyboard.press('Escape');await d.waitFor({state:'hidden'});assert.equal(writes.length,start);
  await p.getByRole('button',{name:button,exact:true}).click();await d.getByRole('button',{name:action,exact:true}).focus();await p.keyboard.press('Enter');await d.waitFor({state:'hidden'});assert.equal(writes.at(-1).path,'/api/keys/key-exact-A'+suffix);
 }
 for(const [path,id,endpoint] of [['routing','combo-exact-A','/api/routing/combos/combo-exact-A'],['providers/openai?auth=apikey',account.id,'/api/connections/'+account.id],['providers/openai?auth=apikey&tab=models','manual-exact-A','/api/providers/openai/models/manual-exact-A']]){
  await p.goto('http://127.0.0.1:5198/panel/'+path);const start=writes.length;
  await p.getByRole('button',{name:'Delete',exact:true}).click();await d.waitFor();assert.match(await d.textContent(),new RegExp(id));await p.keyboard.press('Escape');await d.waitFor({state:'hidden'});assert.equal(writes.length,start);
  await p.getByRole('button',{name:'Delete',exact:true}).click();await d.getByRole('button',{name:'Delete',exact:true}).click();await d.waitFor({state:'hidden'});assert.equal(writes.at(-1).path,endpoint);
 }
 // Bulk scope must show exact IDs and cancel without a write.
 for(const [path,label,endpoint] of [['keys','Workstation A','/api/keys/key-exact-A'],['routing','Fallback A','/api/routing/combos/combo-exact-A']]){
  await p.goto('http://127.0.0.1:5198/panel/'+path);await p.getByRole('checkbox',{name:'Select '+label,exact:true}).check();const start=writes.length;
  await p.getByRole('button',{name:'Delete selected',exact:true}).click();await d.waitFor();assert.match(await d.textContent(),/1 selected/);await p.keyboard.press('Escape');await d.waitFor({state:'hidden'});assert.equal(writes.length,start);
  await p.getByRole('button',{name:'Delete selected',exact:true}).click();await d.getByRole('button',{name:'Delete',exact:true}).click();await d.waitFor({state:'hidden'});assert.equal(writes.at(-1).path,endpoint);
 }
 await p.goto('http://127.0.0.1:5198/panel/providers/openai?auth=apikey');await p.getByRole('checkbox').first().check();const start=writes.length;await p.getByRole('button',{name:'Actions (1)',exact:true}).click();await p.getByRole('menuitem',{name:'Delete selected',exact:true}).click();await d.waitFor();assert.match(await d.textContent(),new RegExp(account.id));await p.keyboard.press('Escape');await d.waitFor({state:'hidden'});assert.equal(writes.length,start);
 // Dirty draft cancellation restores its fields; accepting discard never writes.
 await p.goto('http://127.0.0.1:5198/panel/routing');await p.getByRole('button',{name:'New combo',exact:true}).first().click();await p.getByLabel('Combo name',{exact:true}).fill('Draft fallback');await p.keyboard.press('Escape');await d.waitFor();await d.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await p.getByLabel('Combo name',{exact:true}).inputValue(),'Draft fallback');await p.getByRole('button',{name:'Cancel',exact:true}).click();await d.getByRole('button',{name:'Discard changes',exact:true}).click();await p.getByLabel('Combo name',{exact:true}).waitFor({state:'hidden'});assert.equal(writes.length,start);
 assert.equal(native,0);
 console.log('PASS actual Keys regeneration cancel-first Enter/Escape/backdrop/Cancel and exact accepted payload, no native dialogs');
}finally{await browser.close();}
