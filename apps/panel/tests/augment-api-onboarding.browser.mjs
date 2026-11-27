import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const origin=process.env.PANEL_TEST_URL || 'http://127.0.0.1:5197';const evidence=process.env.PANEL_TEST_EVIDENCE_DIR || process.env.TMPDIR;if(!evidence)throw new Error('PANEL_TEST_EVIDENCE_DIR or TMPDIR required');await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{for(const width of [320,1440])for(const theme of ['light','dark']){
 const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});const page=await context.newPage();const errors=[],writes=[],external=[];
 page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(theme=>localStorage.setItem('styx-panel-preferences',JSON.stringify({theme,language:'en'})),theme);
 const html=(await(await fetch(origin+'/panel/tests/provider-workspace.fixture.html')).text()).replace('./provider-workspace.fixture.tsx','/panel/tests/provider-workspace.fixture.tsx');
 await page.route('**/*',async r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==origin){external.push(u.origin);return r.abort();}if(q.isNavigationRequest())return r.fulfill({contentType:'text/html',body:html});if(u.pathname.startsWith('/api/')){
 if(q.method()==='POST'){assert.equal(u.pathname,'/api/connections');const b=q.postDataJSON();assert.equal(b.provider,'augment-api');assert.equal(b.apiUrl,'https://fixture.api.augmentcode.com');assert.equal(b.apiKey,'FAKE-browser-only-credential');writes.push({provider:b.provider,tenant:true,privateCredential:true});return r.fulfill({status:201,json:{connection:{id:'fixture',provider:'augment-api'}}});}
 const fixtures={'/api/providers':{providers:[{id:'augment-api',name:'Augment API',authModes:['apikey']}]},'/api/connections':{connections:[]},'/api/provider-nodes':{nodes:[]},'/api/oauth/providers':{providers:[]}};return r.fulfill({json:fixtures[u.pathname]??{models:[],providers:[]}});
 }return r.continue();});
 await page.goto(origin+'/providers/augment-api?auth=apikey');await page.getByRole('button',{name:'Add API key',exact:true}).click();await page.getByLabel('Tenant API URL',{exact:false}).fill('https://fixture.api.augmentcode.com');
 const key=page.getByLabel('API key / token',{exact:false});await key.fill('FAKE-browser-only-credential');assert.equal(await key.getAttribute('type'),'password');
 assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}).includes('FAKE-browser-only-credential')),false);
 await page.screenshot({path:`${evidence}/onboarding-${width}-${theme}.png`,fullPage:true});
 await page.getByRole('button',{name:/Add key|Connect|Save key|Add API key/i}).last().click();await page.waitForTimeout(250);assert.equal(writes.length,1);assert.equal(await key.count(),0);assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}).includes('FAKE-browser-only-credential')),false);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log(JSON.stringify({width,theme,posts:writes.length,errors,external}));await context.close();
}}finally{await browser.close();}
