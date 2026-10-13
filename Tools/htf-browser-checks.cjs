const assert=require('node:assert/strict'),path=require('node:path'),{spawn}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const target=process.argv[2],remote=/^https?:/.test(target);let server,browser;
(async()=>{try{
    if(!remote){server=spawn(process.execPath,[path.join(__dirname,'serve-static.cjs'),path.resolve(target),'54159'],{windowsHide:true});await new Promise((resolve,reject)=>{server.stdout.on('data',b=>{if(b.toString().includes('Static site ready'))resolve();});server.once('error',reject);});}
    browser=await chromium.launch({headless:true,channel:'msedge'});const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{window.candleDraws=[];window.seasonalDraws=[];const probe=document.createElement('canvas').getContext('2d'),colors=new Map();for(const color of ['#22c55e22','#ef444422']){probe.fillStyle=color;colors.set(probe.fillStyle,color);}const fill=CanvasRenderingContext2D.prototype.fillRect;CanvasRenderingContext2D.prototype.fillRect=function(x,y,w,h){if(this.canvas.closest('#htf-price-chart')){if(w>=2&&w<30&&h>0&&['#26a69a','#ef5350'].includes(this.fillStyle))window.candleDraws.push({x:x+w/2,w,h,color:this.fillStyle});if(colors.has(this.fillStyle)&&w>0&&h>0)window.seasonalDraws.push(colors.get(this.fillStyle));}return fill.call(this,x,y,w,h);};});
    await page.goto(remote?target:'http://127.0.0.1:54159');const previous=await page.evaluate(async()=>JSON.stringify(await window.StaticMarketData.opportunities()));await page.locator('#market-tab-htf').click();
    await page.waitForFunction(()=>document.getElementById('htf-status').textContent.includes('cenových zdrojů'));
    assert.equal(await page.locator('#market-seasonality-view').isVisible(),false);assert.equal(await page.locator('#market-screener-view').isVisible(),false);
    await page.locator('#htf-mode').selectOption('all');const buttons=page.locator('#htf-results button');assert.ok(await buttons.count()>0,'Real export has watchlist confluence');await buttons.first().click();
    await page.locator('#htf-price-chart').waitFor({state:'visible'});assert.ok(await page.locator('#htf-price-chart').evaluate(e=>e.clientWidth>600&&e.clientHeight>200));assert.match(await page.locator('#htf-chart-caption').textContent(),/Cenová reference.*předpověď/);
    const rendered=await page.locator('#htf-price-chart canvas').first().evaluate(e=>{const data=e.getContext('2d').getImageData(0,0,e.width,e.height).data;return data.some(v=>v!==0);});assert.equal(rendered,true,'Actual chart pixels drawn');
    const candles=await page.evaluate(()=>window.candleDraws);assert.ok(candles.length>=50,'OHLC rendered as filled candlestick bodies');assert.ok(candles.every(b=>b.w>=2&&b.h>0),'Desktop bodies are legible');assert.ok(candles.some(b=>b.color==='#26a69a')&&candles.some(b=>b.color==='#ef5350'),'Teal rising and red falling candles');
    const last= candles.slice(-90),gaps=last.slice(1).map((b,i)=>b.x-last[i].x).filter(v=>v>0);assert.ok(Math.max(...gaps)-Math.min(...gaps)<=1.01,'Trading candles have uniform spacing, including weekends');assert.ok(last[0].w/Math.max(...gaps)>.7,'Bodies occupy most of their candle slot');
    // The UI scrolls the selected chart smoothly; wait for the scroll to settle before pointer coordinates.
    await page.waitForTimeout(700);const box=await page.locator('#htf-price-chart').boundingBox();await page.mouse.move(box.x+box.width*.4,box.y+box.height*.4);await page.locator('#htf-tooltip').waitFor({state:'visible'});assert.match(await page.locator('#htf-tooltip').textContent(),/O .*H .*L .*C /s);
    assert.match(await page.locator('#htf-tooltip').textContent(),/cena/);
    const range=()=>page.locator('#htf-price-chart').evaluate(e=>({from:+e.dataset.visibleFrom,to:+e.dataset.visibleTo}));
    const initial=await range();await page.mouse.wheel(0,-400);await page.waitForTimeout(200);const zoomed=await range();assert.ok(zoomed.to-zoomed.from<initial.to-initial.from,'Wheel zoom changes visible candle range');
    await page.mouse.move(box.x+box.width*.45,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.65,box.y+box.height*.5,{steps:12});await page.mouse.up();assert.ok(Math.abs((await range()).from-zoomed.from)>1,'Drag pans trading bars');
    await page.locator('#htf-chart-reset').click();await page.waitForTimeout(150);assert.ok(Math.abs((await range()).from-initial.from)<.01,'Reset restores initial view');
    const annotation=await page.locator('#htf-price-chart').evaluate(e=>({start:e.dataset.seasonalStart,end:e.dataset.seasonalEnd,width:e.clientWidth}));
    assert.ok(annotation.start!=='null'&&Number(annotation.start)>=0&&Number(annotation.start)<annotation.width&&Number(annotation.end)>Number(annotation.start),'Seasonal annotation has ordered coordinates within reset viewport: '+JSON.stringify(annotation));
    await page.locator('#htf-chart-zoom-in').click();await page.waitForTimeout(150);assert.ok((await range()).to-(await range()).from<initial.to-initial.from);
    await page.locator('#htf-chart-resolution').selectOption('D1');assert.equal(await page.locator('#htf-chart-resolution').inputValue(),'D1');
    await page.locator('#htf-chart-resolution').selectOption('W1');assert.equal(await page.locator('#htf-chart-resolution').inputValue(),'W1');
    await page.setViewportSize({width:2400,height:1000});assert.ok((await page.locator('#market-htf-view').boundingBox()).width<=1441,'HTF layout is bounded on wide monitors');await page.setViewportSize({width:1600,height:1000});
    await page.locator('#htf-timeframe').selectOption('W1');await page.locator('#htf-timeframe').selectOption('all');await page.locator('#htf-direction').selectOption('down');await page.locator('#htf-direction').selectOption('all');
    for(const [direction,color]of [['up','#22c55e22'],['down','#ef444422']]){
        await page.evaluate(()=>{window.seasonalDraws=[];});await page.locator('#htf-direction').selectOption(direction);await page.locator('#htf-results button').first().click();
        await page.waitForFunction(expected=>window.seasonalDraws.at(-1)===expected,color);
        assert.match(await page.locator('#htf-chart-caption').textContent(),/zelený pro růst, červený pro pokles/);
    }
    await page.locator('#htf-direction').selectOption('all');
    await page.locator('#htf-mode').selectOption('confirmed');const states=await page.locator('#htf-results tr').allTextContents();for(const state of states.filter(s=>s.includes('Ukázat graf')))assert.ok(state.includes('Potvrzuje')&&!state.includes('Bez dostatku dat'));
    await page.locator('#htf-mode').selectOption('all');await page.setViewportSize({width:700,height:950});assert.ok(await page.locator('#market-htf-view').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'HTF container fits narrow screen');
    await page.locator('#market-tab-seasonality').click();assert.equal(await page.locator('#market-htf-view').isVisible(),false);assert.equal(await page.locator('#market-seasonality-view').isVisible(),true);
    await page.locator('#market-tab-screener').click();await page.locator('#opportunity-results button').first().waitFor({state:'visible'});await page.locator('#market-tab-htf').click();assert.equal(await page.locator('#market-htf-view').isVisible(),true);
    assert.equal(await page.evaluate(async()=>JSON.stringify(await window.StaticMarketData.opportunities())),previous,'HTF interactions cannot mutate scoring');assert.deepEqual(errors,[]);
    if(!remote){await page.setViewportSize({width:1600,height:1000});await page.screenshot({path:path.join(path.resolve(target),'htf-browser.png'),fullPage:false});}
    console.log('HTF browser passed: real startup, tab switching, OHLC canvas, tooltip, filters, missing-data gate, mobile, inherited scores unchanged.');
}finally{await browser?.close();server?.kill();}})().catch(e=>{console.error(e);process.exitCode=1;});
