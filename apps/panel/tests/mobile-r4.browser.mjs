import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {known,account} from './redesign-api.fixture.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const out=process.env.REDESIGN_EVIDENCE; await mkdir(out,{recursive:true});
const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try {
const p=await b.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
const writes=[];const errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.hostname!=='127.0.0.1')return r.abort();if(/^\/(api|v1)\//.test(u.pathname)){if(r.request().method()!=='GET'){writes.push(u.pathname);if(u.pathname==='/api/model-test'){assert.deepEqual(r.request().postDataJSON(),{model:'openai/fixture-model',connectionId:account.id});return r.fulfill({json:{ok:true,status:'success',output:'Synthetic r4 completion'}});}return r.fulfill({json:{ok:true}});}if(Object.hasOwn(known,u.pathname))return r.fulfill({json:known[u.pathname]});}return r.continue();});
await p.goto('http://127.0.0.1:5198/panel/providers/openai?auth=apikey');
await p.getByRole('list',{name:'Connected accounts'}).waitFor({timeout:3500});
assert.equal(await p.locator('tbody tr').count(),0,'mobile resource renderer, not hidden duplicated table');
await p.getByRole('button',{name:'Tags',exact:true}).click();await p.getByRole('dialog',{name:'Filter by tag',exact:true}).waitFor();
await p.getByRole('searchbox',{name:'Filter by tag'}).fill('draft-only');await p.keyboard.press('Escape');
await p.getByRole('button',{name:'Tags',exact:true}).click();assert.equal(await p.getByRole('searchbox',{name:'Filter by tag'}).inputValue(),'');await p.getByRole('button',{name:'Cancel',exact:true}).click();
await p.getByRole('button',{name:'Tags',exact:true}).click();await p.getByRole('searchbox',{name:'Filter by tag'}).fill('synthetic-tag');await p.getByRole('button',{name:'Apply tag filter',exact:true}).click();await p.getByRole('button',{name:'Tags (1)',exact:true}).waitFor();await p.getByRole('list',{name:'Connected accounts'}).waitFor();await p.getByRole('button',{name:'Tags (1)',exact:true}).click();await p.getByRole('button',{name:'Clear tag filter',exact:true}).click();
await p.getByRole('button',{name:'Select',exact:true}).click();await p.getByRole('checkbox',{name:`Select ${account.name}`,exact:true}).check();await p.getByRole('button',{name:'Actions (1)',exact:true}).click();await p.getByRole('menuitem',{name:'Delete selected',exact:true}).click();await p.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(writes.length,0,'bulk cancel must not mutate');
await p.getByRole('button',{name:'Cancel selection',exact:true}).click();
await p.getByRole('button',{name:account.name,exact:true}).click();await p.getByRole('heading',{name:account.name,exact:true}).waitFor();assert.ok(new URL(p.url()).searchParams.has('inspect'));
assert.ok(await p.getByText(account.id,{exact:true}).isVisible());assert.equal(writes.length,0);
await p.getByRole('button',{name:'Test Model',exact:true}).click();let d=p.getByRole('dialog');await d.getByLabel('Model',{exact:true}).selectOption('fixture-model');assert.equal(writes.length,0);await d.getByRole('button',{name:'Run inference',exact:true}).click();await d.getByText('Synthetic r4 completion',{exact:true}).waitFor();assert.equal(writes.length,1);await p.keyboard.press('Escape');
await p.locator("[data-sonner-toast]").waitFor({state:"hidden",timeout:10000});await p.evaluate(()=>window.scrollTo(0,0));
await p.screenshot({path:`${out}/account-detail.png`,fullPage:true});
await p.goBack();await p.getByRole('list',{name:'Connected accounts'}).waitFor();assert.equal(new URL(p.url()).searchParams.has('inspect'),false);
await p.keyboard.press('Control+k');await p.getByRole('group',{name:'Pages',exact:true}).waitFor();await p.getByRole('group',{name:'Providers',exact:true}).waitFor();await p.screenshot({path:`${out}/palette.png`});await p.keyboard.press('Escape');
assert.deepEqual(errors,[]);console.log('PASS resource rows, filter draft cancel, detail history, exact-account inference, grouped palette');
}finally{await b.close();}
