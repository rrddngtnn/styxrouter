import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try {
 for(const width of [390,1440]) {
  const page=await browser.newPage({viewport:{width,height:900}});let calls=0;
  await page.route('**/api/providers/openai/models',r=>r.fulfill({json:{prefix:'openai',models:[{id:'fixture-model',type:'chat'}]}}));
  await page.route('**/api/model-test',r=>{
   assert.deepEqual(r.request().postDataJSON(),{model:'openai/fixture-model',connectionId:'fixture-account'});
   assert.equal(r.request().headers().authorization,undefined);calls++;
   return r.fulfill({json:{ok:true,status:'success',model:'openai/fixture-model',output:'Fixture completion',finishReason:'stop',usage:{total_tokens:2},observedAt:'2026-01-01T00:00:00Z'}});
  });
  await page.goto(`${process.env.PANEL_TEST_URL}/panel/tests/account-model-test.fixture.html`);
  await page.getByRole('button',{name:'Test Model',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByLabel('Model',{exact:true}).selectOption('fixture-model');
  assert.equal(calls,0);await dialog.getByRole('button',{name:'Run inference'}).click();
  await dialog.getByText('Fixture completion',{exact:true}).waitFor();assert.equal(calls,1);
  await page.screenshot({path:`${process.env.TMPDIR}/account-model-test-${width}.png`});
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Test Model',exact:true}).waitFor();
  await page.close();console.log(`PASS account inference dialog ${width}`);
 }
} finally {await browser.close();}
