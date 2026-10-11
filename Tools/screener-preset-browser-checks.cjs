// UI-only preset regression; identical tests can target a local static export or the public site.
const assert=require('node:assert/strict'),path=require('node:path'),{spawn}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const target=process.argv[2],remote=/^https?:/.test(target);let server,browser;
(async()=>{try{
    if(!remote){server=spawn(process.execPath,[path.join(__dirname,'serve-static.cjs'),path.resolve(target),'54148'],{windowsHide:true});
        await new Promise((resolve,reject)=>{server.stdout.on('data',b=>{if(b.toString().includes('Static site ready'))resolve();});server.once('error',reject);});}
    browser=await chromium.launch({headless:true,channel:'msedge'});
    const page=await browser.newPage({viewport:{width:2200,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(remote?target:'http://127.0.0.1:54148');await page.locator('#market-tab-screener').click();
    await page.waitForFunction(()=>document.querySelector('#opportunity-status').textContent.includes('Core Market Screener'));
    assert.equal(await page.locator('#opportunity-advanced').evaluate(e=>e.open),false);
    assert.equal(await page.locator('[data-opportunity-preset="current"]').getAttribute('aria-pressed'),'true');
    const original=await page.evaluate(async()=>JSON.stringify(await window.StaticMarketData.opportunities()));
    const counts={};
    for(const preset of ['current','upcoming','research']){
        await page.locator(`[data-opportunity-preset="${preset}"]`).click();
        assert.equal(await page.locator('#opportunity-history').inputValue(),'20');
        assert.equal(await page.locator('#opportunity-horizon').inputValue(),preset==='current'?'30':'60');
        assert.equal(await page.locator('#opportunity-min-score').inputValue(),preset==='research'?'0':'6');
        assert.equal(await page.locator('#opportunity-research').isChecked(),preset==='research');
        const expected=await page.evaluate(async preset=>{const s=await window.StaticMarketData.opportunities();return s.assets.filter(a=>window.CoreMarkets.visible(a,preset==='research')).flatMap(a=>a.candidates.filter(c=>c.histories?.[20]&&(preset==='research'||c.scoringV3)&&c.startsIn<=(preset==='current'?30:60)&&(preset==='research'?c.scoringV2?.value:c.scoringV2?.value)>= (preset==='research'?0:6))).length;},preset);
        counts[preset]=await page.locator('#opportunity-results tr').count();assert.equal(counts[preset],expected,'Preset must only filter the existing snapshot');
        const names=await page.locator('#opportunity-results td:first-child strong').allTextContents();
        if(preset==='research')assert.ok(names.includes('LEANHOGS'));else assert.ok(!names.includes('LEANHOGS')&&!names.includes('XAUUSD'));
    }
    await page.locator('[data-opportunity-preset="upcoming"]').click();
    await page.locator('#opportunity-advanced > summary').click();
    await page.locator('#opportunity-min-score').selectOption('0');
    assert.match(await page.locator('#opportunity-preset-summary').textContent(),/^Vlastní/);
    const cotCounts={};
    for(const state of ['confirms','neutral','against','insufficient']){
        await page.locator('#opportunity-cot-filter').selectOption(state);
        const expected=await page.evaluate(async state=>{const s=await window.StaticMarketData.opportunities();return s.assets.flatMap(a=>a.candidates.filter(c=>c.scoringV3&&c.startsIn<=60).map(c=>({c,v:c.scoringV2}))).filter(({c,v})=>{
            const actual=!c.cotReference||v.samples.similar<8||v.samples.other<8?'insufficient':v.components.C>.5?'confirms':v.components.C<.5?'against':'neutral';return actual===state;}).length;},state);
        cotCounts[state]=await page.locator('#opportunity-results td:first-child strong').count();assert.equal(cotCounts[state],expected,'COT filter must use existing C and sample counts');
    }
    await page.locator('#opportunity-cot-filter').selectOption('all');
    await page.locator('#opportunity-search').fill('EURUSD');assert.ok((await page.locator('#opportunity-results td:first-child strong').allTextContents()).every(k=>k==='EURUSD'));
    await page.locator('[data-opportunity-preset="current"]').click();assert.equal(await page.locator('#opportunity-search').inputValue(),'');
    assert.equal(await page.evaluate(async()=>JSON.stringify(await window.StaticMarketData.opportunities())),original,'Presets must not mutate data, scores or calibration');
    await page.locator('#screener-mode-manual').click();assert.equal(await page.locator('#screener-asset-class').isVisible(),true,'Shared manual market filter must stay accessible');
    await page.locator('#screener-mode-auto').click();assert.equal(await page.locator('#opportunity-advanced #screener-asset-class').count(),1);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({presets:counts,cotFilters:cotCounts,dataAndScoresUnchanged:true,manualFilters:true},null,2));
}finally{await browser?.close();server?.kill();}})().catch(e=>{console.error(e);process.exitCode=1;});
