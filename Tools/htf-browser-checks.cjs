const assert=require('node:assert/strict'),path=require('node:path'),{spawn}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const target=process.argv[2],remote=/^https?:/.test(target);let server,browser;
(async()=>{try{
    if(!remote){server=spawn(process.execPath,[path.join(__dirname,'serve-static.cjs'),path.resolve(target),'54159'],{windowsHide:true});await new Promise((resolve,reject)=>{server.stdout.on('data',b=>{if(b.toString().includes('Static site ready'))resolve();});server.once('error',reject);});}
    browser=await chromium.launch({headless:true,channel:'msedge'});const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(remote?target:'http://127.0.0.1:54159');const previous=await page.evaluate(async()=>JSON.stringify(await window.StaticMarketData.opportunities()));await page.locator('#market-tab-htf').click();
    await page.waitForFunction(()=>document.getElementById('htf-status').textContent.includes('cenových zdrojů'));
    assert.equal(await page.locator('#market-seasonality-view').isVisible(),false);assert.equal(await page.locator('#market-screener-view').isVisible(),false);
    await page.locator('#htf-mode').selectOption('all');const buttons=page.locator('#htf-results button');assert.ok(await buttons.count()>0,'Real export has watchlist confluence');await buttons.first().click();
    await page.locator('#htf-price-chart').waitFor({state:'visible'});assert.ok(await page.locator('#htf-price-chart').evaluate(e=>e.width>600&&e.height>200));assert.match(await page.locator('#htf-chart-caption').textContent(),/Cenová reference.*předpověď/);
    const rendered=await page.locator('#htf-price-chart').evaluate(e=>{const data=e.getContext('2d').getImageData(0,0,e.width,e.height).data;return data.some(v=>v!==0);});assert.equal(rendered,true,'Actual chart pixels drawn');
    // The UI scrolls the selected chart smoothly; wait for the scroll to settle before pointer coordinates.
    await page.waitForTimeout(700);const box=await page.locator('#htf-price-chart').boundingBox();await page.mouse.move(box.x+box.width*.4,box.y+box.height*.4);await page.locator('#htf-tooltip').waitFor({state:'visible'});assert.match(await page.locator('#htf-tooltip').textContent(),/O .*H .*L .*C /s);
    await page.locator('#htf-timeframe').selectOption('W1');await page.locator('#htf-timeframe').selectOption('all');await page.locator('#htf-direction').selectOption('down');await page.locator('#htf-direction').selectOption('all');
    await page.locator('#htf-mode').selectOption('confirmed');const states=await page.locator('#htf-results tr').allTextContents();for(const state of states.filter(s=>s.includes('Ukázat graf')))assert.ok(state.includes('Potvrzuje')&&!state.includes('Bez dostatku dat'));
    await page.locator('#htf-mode').selectOption('all');await page.setViewportSize({width:700,height:950});assert.ok(await page.locator('#market-htf-view').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'HTF container fits narrow screen');
    await page.locator('#market-tab-seasonality').click();assert.equal(await page.locator('#market-htf-view').isVisible(),false);assert.equal(await page.locator('#market-seasonality-view').isVisible(),true);
    await page.locator('#market-tab-screener').click();await page.locator('#opportunity-results button').first().waitFor({state:'visible'});await page.locator('#market-tab-htf').click();assert.equal(await page.locator('#market-htf-view').isVisible(),true);
    assert.equal(await page.evaluate(async()=>JSON.stringify(await window.StaticMarketData.opportunities())),previous,'HTF interactions cannot mutate scoring');assert.deepEqual(errors,[]);
    if(!remote){await page.setViewportSize({width:1600,height:1000});await page.screenshot({path:path.join(path.resolve(target),'htf-browser.png'),fullPage:false});}
    console.log('HTF browser passed: real startup, tab switching, OHLC canvas, tooltip, filters, missing-data gate, mobile, inherited scores unchanged.');
}finally{await browser?.close();server?.kill();}})().catch(e=>{console.error(e);process.exitCode=1;});
