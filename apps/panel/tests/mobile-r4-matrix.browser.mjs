import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {known,account} from './redesign-api.fixture.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);const out=process.env.REDESIGN_EVIDENCE;await mkdir(out,{recursive:true});
const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});const metrics=[];
try{for(const width of [320,360,390,600,860,861,1280])for(const theme of ['light','dark'])for(const language of ['en','id'])for(const density of ['comfortable','compact']){
const p=await b.newPage({viewport:{width,height:844},reducedMotion:'reduce'});await p.addInitScript(p=>localStorage.setItem('styx-panel-preferences',JSON.stringify(p)),{theme,language,density});
const writes=[];await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.hostname!=='127.0.0.1')return r.abort();if(/^\/(api|v1)\//.test(u.pathname)){if(r.request().method()!=='GET'){writes.push(u.pathname);return r.fulfill({status:501,json:{error:'unexpected write'}});}if(Object.hasOwn(known,u.pathname))return r.fulfill({json:known[u.pathname]});}return r.continue();});
await p.goto('http://127.0.0.1:5198/panel/providers/openai?auth=apikey');await p.locator(width<=860?'.account-resource-list':'tbody tr').waitFor();
assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0,`overflow ${width} ${theme} ${language} ${density}`);
if(width<=860){assert.equal(await p.locator('.shell-topbar').evaluate(e=>e.getBoundingClientRect().height),56);const row=p.locator('.account-resource-list li').first();metrics.push({width,theme,language,density,rowTop:await row.evaluate(e=>e.getBoundingClientRect().top)});if(width===390&&language==='en')assert.ok(await row.evaluate(e=>e.getBoundingClientRect().top)<844,'first account above fold');}
else{assert.ok(await p.getByRole('link',{name:language==='en'?'Overview':'Ringkasan',exact:true}).isVisible());assert.equal(await p.locator('.is-desktop').evaluate(e=>e.getBoundingClientRect().width),248);}
if(language==='en'&&density==='comfortable')await p.screenshot({path:`${out}/providers-${width}-${theme}.png`,fullPage:true});
assert.deepEqual(writes,[]);await p.close();console.log(`PASS ${width} ${theme} ${language} ${density}`);
}}finally{await writeFile(`${out}/metrics.json`,JSON.stringify(metrics,null,2));await b.close();}
