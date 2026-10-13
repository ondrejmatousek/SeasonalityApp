const assert=require('node:assert/strict'),path=require('node:path'),{spawn}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const target=process.argv[2],remote=/^https?:/.test(target);let server,browser;
(async()=>{try{
    if(!remote){server=spawn(process.execPath,[path.join(__dirname,'serve-static.cjs'),path.resolve(target),'54162'],{windowsHide:true});await new Promise((resolve,reject)=>{server.stdout.on('data',b=>{if(b.toString().includes('Static site ready'))resolve();});server.once('error',reject);});}
    browser=await chromium.launch({headless:true,channel:'msedge'});const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(remote?target:'http://127.0.0.1:54162');
    await page.locator('#seasonality-asset-search').fill('EURUSD');await page.locator('button.seasonality-asset-suggestion[data-asset-key="EURUSD"]').click();await page.locator('#market-tab-cot').click();
    await page.locator('.cot-summary-card').first().waitFor({state:'attached'});if(!await page.locator('.cot-position-overview').evaluate(e=>e.open))await page.locator('.cot-position-overview summary').click();
    assert.equal(await page.locator('details.cot-analogs').evaluate(e=>e.open),false,'Historical analog section is collapsed by default');
    assert.equal(await page.locator('#cot-analog-group').isVisible(),false);
    await page.locator('.cot-analogs>summary').click();assert.equal(await page.locator('#cot-analog-group').isVisible(),true);
    await page.locator('.cot-analogs>summary').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#cot-analog-group').isVisible(),false,'Collapse works with keyboard');
    const payload=await page.evaluate(()=>window.StaticMarketData.cot('EURUSD',52)),before=JSON.stringify(payload),market=payload.markets.find(m=>!m.isDollarIndex)||payload.markets[0],latest=market.reports.at(-1);
    const panels=page.locator('.cot-pair-panel');assert.equal(await panels.count(),2);assert.equal(await page.locator('.cot-summary-card').count(),6);
    assert.equal(await panels.first().getAttribute('data-currency'),'EUR');assert.equal(await panels.last().getAttribute('data-currency'),'USD');assert.match(await panels.last().textContent(),/neutrální reference u=0.*DXY/s);
    const firstBox=await panels.first().boundingBox(),secondBox=await panels.last().boundingBox();assert.ok(Math.abs(firstBox.y-secondBox.y)<2,'Pair panels visible side by side on desktop');
    const cards=panels.first().locator('.cot-summary-card'),groups=['nonReportable','commercial','nonCommercial'];assert.equal(await cards.count(),3);
    for(let i=0;i<3;i++){
        const card=cards.nth(i),position=latest[groups[i]],total=position.long+position.short+position.spread,donut=card.locator('.cot-donut');await donut.scrollIntoViewIfNeeded();
        let offset=0;
        for(const [name,value]of [['Long',position.long],['Short',position.short],['Spread',position.spread]]){
            if(!value)continue;
            const box=await donut.boundingBox(),share=value/total,angle=(offset+share/2)*Math.PI*2;offset+=share;
            await page.mouse.move(box.x+box.width*(.5+.4*Math.sin(angle)),box.y+box.height*(.5-.4*Math.cos(angle)));
            const tip=card.locator('.cot-donut-tooltip');await tip.waitFor({state:'visible'});
            const expected=new Intl.NumberFormat('cs-CZ',{maximumFractionDigits:1}).format(100*share)+' %';
            assert.ok((await tip.textContent()).includes(`${name} ${expected}`));assert.ok((await tip.textContent()).includes(new Intl.NumberFormat('cs-CZ').format(value)+' kontraktů'));
            assert.match(await tip.textContent(),/long \+ short \+ spread této skupiny/);
        }
        await card.locator('h3').hover();assert.equal(await card.locator('.cot-donut-tooltip').isVisible(),false,'Tooltip hides outside arc');
        await donut.locator('[data-position="Long"]').focus();assert.equal(await card.locator('.cot-donut-tooltip').isVisible(),true,'Keyboard focus shows share');await page.keyboard.press('Escape');assert.equal(await card.locator('.cot-donut-tooltip').isVisible(),false);
    }
    await page.setViewportSize({width:390,height:850});const donut=cards.first().locator('.cot-donut');await donut.scrollIntoViewIfNeeded();const box=await donut.boundingBox();
    await donut.locator('[data-position="Long"]').dispatchEvent('pointerdown',{pointerType:'touch',clientX:box.x+box.width,clientY:box.y+box.height/2});
    const tip=cards.first().locator('.cot-donut-tooltip');assert.equal(await tip.isVisible(),true);const bounds=await tip.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=390,'Mobile tooltip stays inside viewport');
    assert.equal(JSON.stringify(await page.evaluate(()=>window.StaticMarketData.cot('EURUSD',52))),before,'Tooltip cannot mutate COT data');assert.deepEqual(errors,[]);
    await page.locator('#market-tab-seasonality').click();await page.locator('#seasonality-asset-search').fill('GBPCAD');await page.locator('button.seasonality-asset-suggestion[data-asset-key="GBPCAD"]').click();await page.locator('#market-tab-cot').click();
    await page.locator('.cot-pair-panel[data-currency="CAD"]').waitFor({state:'visible'});assert.equal(await page.locator('.cot-pair-panel[data-currency="GBP"]').count(),1);assert.equal(await page.locator('.cot-summary-card').count(),6);
    const ids=await page.locator('.cot-donut-tooltip').evaluateAll(nodes=>nodes.map(n=>n.id));assert.equal(new Set(ids).size,6,'Tooltip IDs are unique across both currencies');
    const cross=await page.evaluate(()=>window.StaticMarketData.cot('GBPCAD',52));
    for(const key of ['GBP','CAD']){
        const p=cross.markets.find(m=>m.key===key).reports.at(-1).commercial;
        assert.ok((await page.locator(`.cot-pair-panel[data-currency="${key}"] [data-group="commercial"]`).textContent()).includes(new Intl.NumberFormat('cs-CZ').format(p.long)),'Each panel uses its own currency data');
    }
    const mobile=await page.locator('.cot-pair-panel').all();assert.ok((await mobile[1].boundingBox()).y>(await mobile[0].boundingBox()).y,'Pair panels stack on mobile');
    assert.ok(await page.locator('#cot-summary').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'Pair overview has no mobile horizontal overflow');
    if(!remote){await page.setViewportSize({width:1600,height:1200});await page.locator('.cot-position-overview').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(path.resolve(target),'cot-pair-overview.png'),fullPage:false});}
    await page.locator('#market-tab-seasonality').click();await page.locator('#seasonality-asset-search').fill('SPX');await page.locator('button.seasonality-asset-suggestion[data-asset-key="SPX"]').click();await page.locator('#market-tab-cot').click();
    await page.waitForFunction(()=>document.querySelector('#cot-content')?.hidden===false&&document.querySelectorAll('.cot-summary-card').length===3);
    assert.equal(await page.locator('.cot-pair-panel').count(),0,'Non-FX retains one market summary');assert.deepEqual(errors,[]);
    console.log('PASS: real COT long/short/spread segment percentages and counts, consistent denominator, keyboard/Escape, touch, mobile and unchanged dataset.');
}finally{await browser?.close();server?.kill();}})().catch(e=>{console.error(e);process.exitCode=1;});
