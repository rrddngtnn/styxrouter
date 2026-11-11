import {browserEvidencePath} from './browser-paths.mjs';
import assert from 'node:assert/strict';
const baseURL = process.env.STYX_TEST_BASE_URL || 'http://127.0.0.1:5207';
assert.match(baseURL, /^http:\/\/127\.0\.0\.1:\d+$/);
const fixtureURL = `${baseURL}/panel/tests/confirmations-credits.fixture.html`;
// Every API request is fulfilled/aborted below; no live API writes are allowed.
// PLAYWRIGHT_MODULE and CHROMIUM_PATH are caller-provided local tooling, not repository paths.
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const out=browserEvidencePath('confirmations-and-credits');await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try {for(const width of [320,390,1280])for(const theme of ['light','dark']){
const p=await browser.newPage({viewport:{width,height:844},reducedMotion:'reduce'});let posts=[],reads=[],mode='ready';
await p.addInitScript(theme=>localStorage.setItem('styx-panel-preferences',JSON.stringify({theme,language:'en'})),theme);
await p.route('**/*',route=>{const request=route.request(),u=new URL(request.url());if(u.origin!==baseURL)return route.abort();if(!/^\/(api|v1)\//.test(u.pathname))return route.continue();
if(u.pathname==='/api/usage/quota')return route.fulfill({json:{providers:[{connectionId:'synthetic-exact-account-A',provider:'codex',name:'Synthetic Codex A',isActive:true,tokenStatus:'valid',bankedResetCredits:2,windows:[]},{connectionId:'synthetic-claude',provider:'claude',name:'Synthetic Claude unsupported',isActive:true,tokenStatus:'unknown',windows:[]}]}});
if(u.pathname==='/api/usage/codex-reset-credit') {if(request.method()==='GET'){reads.push(u.searchParams.get('connectionId'));return route.fulfill({json:{ok:true,availableCount:mode==='zero'?0:1,credits:mode==='zero'?[]:[{selectionToken:mode==='unknown'?'synthetic-credit-next':'synthetic-credit-exact',title:'Synthetic selected credit',expiresAt:null}]}});}posts.push(request.postDataJSON());return mode==='unknown'?route.abort():route.fulfill({json:{ok:true,outcome:'reset',usage:null,quotaRefreshed:false}});}
return route.fulfill({json:{providers:[],nodes:[],pools:[]}});});
await p.goto(fixtureURL);await p.getByRole('button',{name:'Reset credits',exact:true}).waitFor();assert.equal(reads.length,0);assert.equal(posts.length,0);
await p.screenshot({path:`${out}/card-${width}-${theme}.png`,fullPage:true});
await p.getByRole('button',{name:'Reset credits',exact:true}).click();await p.getByRole('button',{name:'Redeem this credit',exact:true}).click();const dialog=p.locator('.styx-confirmation');await dialog.waitFor();assert.ok((await dialog.textContent()).includes('synthetic-exact-account-A'));assert.equal(await p.evaluate(()=>document.activeElement.textContent),'Cancel');await p.keyboard.press('Enter');await dialog.waitFor({state:'hidden'});assert.equal(posts.length,0);
await p.getByRole('button',{name:'Redeem this credit',exact:true}).click();await dialog.waitFor();await p.screenshot({path:`${out}/confirmation-${width}-${theme}.png`,fullPage:true});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
await p.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(posts.length,0);
await p.getByRole('button',{name:'Redeem this credit',exact:true}).click();await dialog.getByRole('button',{name:'Redeem this credit',exact:true}).click();await p.getByRole('dialog').waitFor({state:'hidden'});assert.equal(posts.length,1);assert.equal(posts[0].connectionId,'synthetic-exact-account-A');assert.equal(posts[0].creditId,'synthetic-credit-exact');assert.ok(posts[0].idempotencyKey);assert.ok(reads.every(id=>id==='synthetic-exact-account-A'));
mode='zero';await p.getByRole('button',{name:'Reset credits',exact:true}).click();await p.getByText('Available banked resets',{exact:false}).waitFor();assert.ok(await p.getByRole('button',{name:'Redeem earliest expiring credit'}).isDisabled());await p.getByRole('button',{name:'Close',exact:true}).click();
mode='unknown';await p.getByRole('button',{name:'Reset credits',exact:true}).click();await p.getByRole('button',{name:'Redeem this credit',exact:true}).click();await dialog.getByRole('button',{name:'Redeem this credit',exact:true}).click();await p.getByText('Outcome unknown.',{exact:false}).last().waitFor();assert.equal(posts.length,2);await p.screenshot({path:`${out}/unknown-${width}-${theme}.png`,fullPage:true});await p.close();console.log(`PASS synthetic exact-account credit cancel Enter Escape partial unknown zero ${width} ${theme}`);
}}finally{await browser.close();}
