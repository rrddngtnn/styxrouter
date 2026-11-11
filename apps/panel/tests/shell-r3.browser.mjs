import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const out=process.env.REDESIGN_EVIDENCE;await mkdir(out,{recursive:true});
const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try {for(const width of [320,360,390,1280])for(const theme of ['light','dark']){
const p=await b.newPage({viewport:{width,height:844},reducedMotion:'reduce'});
await p.addInitScript(v=>localStorage.setItem('styx-panel-preferences',JSON.stringify(v)),{theme,language:'en'});
await p.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
await p.goto('http://127.0.0.1:5198/panel/providers/openai?auth=apikey');await p.locator(width<=860?'ul.account-resource-list li':'tbody tr').waitFor();
const trigger=p.locator('.shell-nav-trigger');
assert.equal(await p.getByRole('button',{name:'Enable',exact:true}).count(),0,'bulk actions absent with zero selection');
if(width>860){assert.equal(await p.getByRole('link',{name:'Overview',exact:true}).isVisible(),true,'persistent links actually painted');assert.equal(await p.locator('.is-desktop').evaluate(e=>e.getBoundingClientRect().width),248);assert.equal(await p.getByRole('dialog').count(),0);await trigger.click();assert.equal(await p.locator('.is-desktop').evaluate(e=>e.getBoundingClientRect().width),64);await trigger.click();assert.equal(await p.locator('main').evaluate(e=>e.inert),false);}
else {assert.equal(await p.locator('.shell-topbar').evaluate(e=>e.getBoundingClientRect().height),56);await trigger.click();await p.getByRole('dialog',{name:'Main navigation',exact:true}).waitFor();await p.keyboard.press('Escape');await p.waitForFunction(()=>document.activeElement?.classList.contains('shell-nav-trigger'));}
await p.screenshot({path:`${out}/shell-${width}-${theme}.png`,fullPage:true});
await p.keyboard.press('Control+k');const input=p.getByRole('combobox');await input.waitFor();await input.fill('quota');await p.keyboard.press('ArrowDown');
assert.ok(await input.getAttribute('aria-activedescendant'));assert.equal(await input.evaluate(e=>getComputedStyle(e).fontSize),'16px');
assert.ok(await p.locator('.shell-palette-option').first().evaluate(e=>e.getBoundingClientRect().height)>=48);
await p.screenshot({path:`${out}/palette-${width}-${theme}.png`});
if(width<861){await p.setViewportSize({width,height:420});await p.waitForFunction(()=>document.querySelector('.shell-palette')?.getBoundingClientRect().bottom<=420);assert.ok(await p.locator('.shell-palette').evaluate(e=>e.getBoundingClientRect().bottom)<=420,'palette inside short viewport');await p.setViewportSize({width,height:844});}
await p.keyboard.press('Escape');await p.waitForFunction(()=>document.activeElement?.classList.contains('shell-search-trigger'));
await p.keyboard.press('Control+k');await input.fill('quota');await p.keyboard.press('Enter');await p.waitForURL('**/panel/quota');
assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);
await p.close();console.log(`PASS shell palette ${width} ${theme}`);
}}finally{await b.close();}
