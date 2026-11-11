import {browserEvidencePath} from './browser-paths.mjs';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
const out=browserEvidencePath('login-gateway');await mkdir(out,{recursive:true});
const results=[];const before=process.env.LOGIN_BEFORE==='1';
try{
 for(const width of (before?[390,1280]:[320,360,390,1280]))for(const theme of ['light','dark'])for(const language of (before?['en']:['en','id'])){
  const p=await browser.newPage({viewport:{width,height:800},reducedMotion:'reduce'});let posts=0,mode='reject',authenticated=false;const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(({theme,language})=>localStorage.setItem('styx-panel-preferences',JSON.stringify({theme,language})),{theme,language});
  await p.route('**/*',async r=>{const u=new URL(r.request().url());if(u.hostname!=='127.0.0.1')return r.abort();if(!/^\/(api|v1)\//.test(u.pathname))return r.continue();
   if(u.pathname==='/api/auth/status')return r.fulfill({json:{authenticated}});
   if(u.pathname==='/api/auth/login'){posts++;assert.equal(r.request().method(),'POST');assert.deepEqual(r.request().postDataJSON(),{password:'synthetic-login-fixture-only'});if(mode==='network')return r.abort('failed');await new Promise(resolve=>setTimeout(resolve,80));if(mode==='success'){authenticated=true;return r.fulfill({json:{authenticated:true,success:true}});}return r.fulfill({status:mode==='rate'?429:401,json:{error:mode==='rate'?'Too many failed attempts. Try again later.':'Invalid password'}});}
   return r.fulfill({json:{}});
  });
  await p.goto('http://127.0.0.1:5198/panel/keys');await p.locator('input[type=password]').waitFor();assert.equal(posts,0);
  if(before){await p.screenshot({path:`${out}/before-${width}-${theme}.png`,fullPage:true});await p.close();continue;}
  const input=p.getByLabel(language==='en'?'Management password':'Kata sandi pengelolaan',{exact:true});
  assert.equal(await p.locator('h1').innerText(),language==='en'?'Sign in':'Masuk');assert.equal(await p.locator('input').getAttribute('autocomplete'),'current-password');assert.equal(await p.evaluate(()=>document.activeElement.tagName),'BODY');
  assert.equal(await p.locator('.login-ribbon').getAttribute('aria-hidden'),'true');assert.equal(await p.locator('.login-ribbon').evaluate(n=>getComputedStyle(n).pointerEvents),'none');
  assert.equal(await input.evaluate(n=>getComputedStyle(n).fontSize),'16px');
  await p.keyboard.press('Tab');assert.equal(await input.evaluate(n=>n===document.activeElement),true);await p.keyboard.press('Tab');assert.equal(await p.locator('.login-reveal').evaluate(n=>n===document.activeElement),true);await p.keyboard.press('Space');assert.equal(await input.getAttribute('type'),'text');await p.keyboard.press('Space');assert.equal(await input.getAttribute('type'),'password');
  async function bounds(){assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);for(const node of await p.locator('.login-gateway input,.login-gateway button').all()){const b=await node.boundingBox();assert.ok(b.height>=44);assert.ok(b.x>=0&&b.x+b.width<=width+1);}}
  await bounds();
  const contrast=await p.evaluate(()=>{
   const lum=s=>{const v=s.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});return v[0]*.2126+v[1]*.7152+v[2]*.0722;};
   const ratio=(a,b)=>{a=lum(a);b=lum(b);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
   const input=getComputedStyle(document.querySelector('.login-gateway input'));const panel=getComputedStyle(document.querySelector('.login-form-panel'));const submit=getComputedStyle(document.querySelector('.login-submit'));const help=getComputedStyle(document.querySelector('#login-help'));
   const motif=document.querySelector('.login-ribbon').getBoundingClientRect(),field=document.querySelector('.login-password-row').getBoundingClientRect();
   return {inputText:ratio(input.color,input.backgroundColor),controlBoundary:ratio(input.borderTopColor,input.backgroundColor),helpText:ratio(help.color,panel.backgroundColor),actionText:ratio(submit.color,submit.backgroundColor),motifOverlapsField:motif.left<field.right&&motif.right>field.left&&motif.top<field.bottom&&motif.bottom>field.top};
  });
  assert.ok(contrast.inputText>=4.5&&contrast.helpText>=4.5&&contrast.actionText>=4.5&&contrast.controlBoundary>=3);assert.equal(contrast.motifOverlapsField,false);
  await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:`${out}/login-${width}-${theme}-${language}-on.png`,fullPage:true});await p.addStyleTag({content:'.login-ribbon{visibility:hidden}'});await p.screenshot({path:`${out}/login-${width}-${theme}-${language}-off.png`,fullPage:true});
  await input.fill('synthetic-login-fixture-only');await p.locator('form').evaluate(n=>{n.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));n.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});await p.locator('#login-error').waitFor();assert.equal(posts,1);assert.equal(await input.getAttribute('aria-invalid'),'true');assert.equal(await input.getAttribute('aria-describedby'),'login-help login-error');assert.equal(await p.locator('#login-error').getAttribute('role'),'alert');assert.equal(await input.evaluate(n=>n===document.activeElement),true);
  mode='network';await p.locator('.login-submit').click();await p.locator('#login-error').filter({hasText:language==='en'?'Unable to connect':'Tidak dapat terhubung'}).waitFor();assert.equal(await input.getAttribute('aria-invalid'),null);
  mode='rate';await p.locator('.login-submit').click();await p.locator('#login-error').filter({hasText:language==='en'?'Too many failed attempts':'Terlalu banyak percobaan'}).waitFor();assert.equal((await p.locator('#login-error').innerText()).includes('60'),false);
  assert.equal(p.url().includes('synthetic-login'),false);assert.equal(await p.evaluate(()=>JSON.stringify(localStorage).includes('synthetic-login')),false);
  await p.setViewportSize({width,height:260});await bounds();await p.locator('.login-submit').scrollIntoViewIfNeeded();assert.equal(await p.locator('.login-submit').isVisible(),true);await p.screenshot({path:`${out}/short-${width}-${theme}-${language}.png`,fullPage:true});
  mode='success';await p.goto('http://127.0.0.1:5198/panel/login?returnTo=https%3A%2F%2Fevil.example%2F&expired=1');await input.fill('synthetic-login-fixture-only');await p.locator('.login-submit').click();await p.waitForURL(url=>url.origin==='http://127.0.0.1:5198'&&/^\/panel\/?$/.test(url.pathname));assert.equal(posts,4);assert.deepEqual(errors,[]);
  results.push({width,theme,language,pass:true,posts,contrast});await p.close();
 }
 await writeFile(`${out}/${before?'before-':' '}results.json`.replace('/ results','/results'),JSON.stringify(results,null,2));console.log(JSON.stringify({before,results}));
}finally{await browser.close();}
