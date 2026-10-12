const assert=require('node:assert/strict'),path=require('node:path'),{spawn}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');let browser,server;
(async()=>{try{
 const site=path.resolve(process.argv[2]);server=spawn(process.execPath,[path.join(__dirname,'serve-static.cjs'),site,'54161'],{windowsHide:true});
 await new Promise((resolve,reject)=>{server.stdout.on('data',b=>{if(b.toString().includes('Static site ready'))resolve();});server.once('error',reject);});
 browser=await chromium.launch({headless:true,channel:'msedge'});const page=await browser.newPage({viewport:{width:1500,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:54161');await page.waitForFunction(()=>document.querySelector('#daily-health-content')?.textContent.includes('Recent runs'));
 const snapshot=await page.evaluate(async()=>window.StaticMarketData.opportunities());assert.ok(snapshot.assets.filter(a=>a.candidates.length).every(a=>a.candidates.every(c=>c.scoringV1ByHistory&&c.scoringV2)),'Automatic V1/V2 scores are built server-side');
 await page.locator('#daily-health-toggle').click();assert.equal(await page.locator('#daily-health-panel').isVisible(),true);
 assert.match(await page.locator('#daily-health-content').textContent(),/EURUSD.*AAPL/s);assert.ok(await page.locator('#daily-health-panel table tr').count()<=8);
 await page.keyboard.press('Escape');assert.equal(await page.locator('#daily-health-panel').isVisible(),false);
 const actual=await page.evaluate(async()=>{const r=await fetch('/artifacts/daily-health/latest.json');return r.json();});
 for(const status of ['failed','warning','ok']){
  await page.route('**/artifacts/daily-health/latest.json',route=>route.fulfill({json:{...actual,status,staleAfter:new Date(Date.now()+3600000).toISOString(),errors:status==='failed'?['Test critical error']:[]}}));
  await page.reload();await page.waitForFunction(s=>document.querySelector('#daily-health-dot').classList.contains('is-'+s),status);await page.unroute('**/artifacts/daily-health/latest.json');
 }
 await page.route('**/artifacts/daily-health/latest.json',route=>route.fulfill({json:{...actual,status:'ok',staleAfter:'2000-01-01T00:00:00Z'}}));await page.reload();await page.waitForFunction(()=>document.querySelector('#daily-health-content')?.textContent.includes('neaktuální'));
 await page.setViewportSize({width:390,height:844});await page.locator('#daily-health-toggle').click();assert.ok(await page.locator('#daily-health-panel').evaluate(e=>e.getBoundingClientRect().left>=0));
 assert.deepEqual(errors,[]);console.log('PASS: actual static web startup, health loading, popover/Escape, saved status success/warning/failure/stale and mobile.');
}finally{await browser?.close();server?.kill();}})().catch(e=>{console.error(e);process.exitCode=1;});
