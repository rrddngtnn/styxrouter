import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try {
 const context=await browser.newContext({viewport:{width:320,height:900},hasTouch:true,serviceWorkers:'block'});
 await context.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:5198'?r.continue():r.abort());
 const page=await context.newPage();await page.goto('http://127.0.0.1:5198/panel/routing?tab=policies');
 await page.getByLabel('Routing workspace',{exact:true}).selectOption('policies');
 const input=page.getByLabel('Request retries (0–10)',{exact:true});await input.waitFor();
 const measured=await input.evaluate(e=>({columns:getComputedStyle(e.parentElement.parentElement).gridTemplateColumns.split(' ').length,height:e.getBoundingClientRect().height}));
 assert.equal(measured.columns,1,'mounted policy numeric group has one computed column at 320px');
 assert.ok(measured.height>=44,'coarse numeric control at least 44px');
 console.log('PASS mounted policy numeric group: one computed column at 320px, coarse control >=44px');await context.close();
}finally{await browser.close();}
