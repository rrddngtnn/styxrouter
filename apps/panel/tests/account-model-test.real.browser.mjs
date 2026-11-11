import assert from 'node:assert/strict';
import { createServer } from 'vite';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const vite=await createServer({root:new URL('..',import.meta.url).pathname,configFile:false,esbuild:{jsx:'automatic'},base:'/panel/',server:{host:'127.0.0.1',port:0},appType:'mpa'});
await vite.listen(0);
console.log(`VITE_READY:${vite.resolvedUrls.local[0]}`);
const line=await new Promise(resolve=>{process.stdin.once('data',x=>resolve(String(x).trim()));});
process.stdin.destroy();
console.log('BROWSER_CONFIG_RECEIVED');
const browser=await chromium.launch({timeout:15000,headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try {
 const {base,account,provider}=JSON.parse(line);
 const page=await browser.newPage();
 page.setDefaultTimeout(10000);
 page.on('pageerror',error=>console.error('PAGE_ERROR',error.message));
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 const login=await page.request.post(base+'/api/auth/login',{data:{password:'fixture-password'}});
 assert.equal(login.status(),200);
 await page.goto(`${base}/panel/tests/account-model-test.fixture.html?account=${account}&provider=${provider}`);
 await page.getByRole('button',{name:'Test Model',exact:true}).click();
 const dialog=page.getByRole('dialog');
 await dialog.getByLabel('Model',{exact:true}).selectOption('vendor/model');
 await dialog.getByText('Selected: accountprobe/vendor/model',{exact:true}).waitFor();
 await dialog.getByText(/Inventory unknown/).waitFor();
 const responsePromise=page.waitForResponse(r=>r.url()===base+'/api/model-test');
 await dialog.getByRole('button',{name:'Run inference'}).click();
 const response=await responsePromise;const result=await response.json();
 assert.equal(response.status(),200,JSON.stringify(result));
 assert.equal(result.connectionId,account);assert.equal(result.model,'accountprobe/vendor/model');
 assert.equal(result.output,'PROBE_SUCCESS_SENTINEL_9467');assert.equal(result.usage.total_tokens,2);
 await dialog.getByText('PROBE_SUCCESS_SENTINEL_9467',{exact:true}).waitFor();
 await dialog.getByText('Model: accountprobe/vendor/model',{exact:true}).waitFor();
 await dialog.getByText('HTTP: 200',{exact:true}).waitFor();
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]) {
  await page.setViewportSize(viewport);
  const box=await dialog.boundingBox();assert.ok(box.x>=0 && box.x+box.width<=viewport.width);
  await dialog.getByText(/^Observed:/).scrollIntoViewIfNeeded();
  await page.screenshot({path:`${process.env.STYX_BROWSER_TMPDIR || process.env.TMPDIR}/account-model-${viewport.width}.png`,fullPage:true});
 }
 await page.keyboard.press('Escape');
 assert.equal(await page.getByRole('button',{name:'Test Model',exact:true}).evaluate(el=>el===document.activeElement),true);
 console.log('PASS browser -> real session-authenticated Hono -> fenced synthetic upstream');
} finally {await browser.close();await vite.close();}
