import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {known} from './redesign-api.fixture.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);const out=process.env.REDESIGN_EVIDENCE;await mkdir(out,{recursive:true});
const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try{for(const width of [320,390])for(const theme of ['light','dark']){
const p=await b.newPage({viewport:{width,height:844},reducedMotion:'reduce'});await p.addInitScript(theme=>localStorage.setItem('styx-panel-preferences',JSON.stringify({theme,language:'en'})),theme);
const checks=[];const window=(key,n)=>({key,label:key,used:n,total:100,remaining:100-n,percentRemaining:100-n,resetAt:null,unlimited:false,models:['synthetic/model-'+key]});
await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.hostname!=='127.0.0.1')return r.abort();if(u.pathname==='/api/usage/quota')return r.fulfill({json:{providers:[{connectionId:'quota-r4',provider:'anthropic',name:'Synthetic quota account',isActive:true,quotaSupported:true,tokenStatus:'unknown',windows:[window('Session',20),window('Weekly',40),{...window('Unknown',0),used:null,total:null,remaining:null,percentRemaining:null}]}]}});if(u.pathname==='/api/usage/quota-r4'){checks.push(u.pathname);return r.fulfill({status:503,json:{error:'Synthetic refresh unavailable'}});}if(Object.hasOwn(known,u.pathname))return r.fulfill({json:known[u.pathname]});return r.continue();});
await p.goto('http://127.0.0.1:5198/panel/quota');await p.locator('.quota-account').waitFor();assert.ok(await p.locator('.quota-account header .provider-icon svg').isVisible());
const selector=p.getByRole('combobox',{name:'Quota window',exact:true});await selector.selectOption('Weekly');assert.equal(checks.length,0);await p.locator('.quota-account').screenshot({path:`${out}/quota-compact-${width}-${theme}.png`});await p.getByRole('button',{name:'Window details',exact:true}).click();await p.locator('.quota-exact-values').waitFor();assert.ok(await p.locator('.quota-exact-values').textContent().then(x=>x.includes('60')));await p.keyboard.press('Tab');assert.equal(checks.length,0);
await selector.selectOption('Unknown');assert.equal(await p.locator('.quota-window progress').count(),0);await p.screenshot({path:`${out}/quota-${width}-${theme}.png`,fullPage:true});
await p.getByRole('button',{name:'Check now',exact:true}).click();await p.getByText('Synthetic refresh unavailable',{exact:false}).first().waitFor();assert.equal(checks.length,1);assert.ok(await selector.isVisible());assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);await p.close();console.log(`PASS quota window detail unknown stale check ${width} ${theme}`);
}}finally{await b.close();}
