const assert=require('node:assert/strict'),path=require('node:path'),{spawn}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const target=process.argv[2],remote=/^https?:/.test(target);let server,browser;
(async()=>{try{
 if(!remote){server=spawn(process.execPath,[path.join(__dirname,'serve-static.cjs'),path.resolve(target),'54163'],{windowsHide:true});await new Promise((resolve,reject)=>{server.stdout.on('data',b=>{if(b.toString().includes('Static site ready'))resolve();});server.once('error',reject);});}
 browser=await chromium.launch({headless:true,channel:'msedge'});const page=await browser.newPage({viewport:{width:1500,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(remote?target:'http://127.0.0.1:54163');
 for(const [key,symbol]of [['WHEAT','CBOT:ZW1!'],['LIVECATTLE','CME:LE1!'],['SOYBEANS','CBOT:ZS1!']]){
  await page.locator('#seasonality-asset-search').fill(key);await page.locator(`button.seasonality-asset-suggestion[data-asset-key="${key}"]`).click();
  await page.waitForFunction(expected=>document.querySelector('#seasonality-source-note')?.textContent.includes(expected)&&!document.querySelector('.seasonality-page').classList.contains('is-loading'),symbol);
  assert.equal(await page.locator('#seasonality-source-note').isVisible(),true);assert.match(await page.locator('#seasonality-source-note').textContent(),/Research only.*denní aktualizace zatím není zapojená/s);
  const result=await page.evaluate(k=>window.StaticMarketData.prices(k),key),rows=result.prices;assert.ok(rows.length>10000);assert.ok(rows.every(b=>Number.isFinite(b.close)));
  await page.locator('#seasonality-years').selectOption('all');await page.waitForTimeout(100);
  assert.ok(await page.locator('#seasonality-canvas').evaluate(c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data.some(v=>v!==0)),'Commodity seasonal curve is drawn');
  assert.ok(await page.locator('#seasonality-year-list input[type="checkbox"]').count()>40,'Long history selectable');
 }
 await page.setViewportSize({width:700,height:950});assert.ok(await page.locator('.seasonality-chart-panel').evaluate(e=>e.scrollWidth<=e.clientWidth+1));assert.deepEqual(errors,[]);
 console.log('PASS: real wheat/live-cattle/soybeans TradingView seasonal curves, long history, source/research/daily-refresh notice and mobile.');
}finally{await browser?.close();server?.kill();}})().catch(e=>{console.error(e);process.exitCode=1;});
