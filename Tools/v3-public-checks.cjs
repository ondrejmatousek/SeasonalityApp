// Read-only public deployment verification; browser filters do not mutate the dataset.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
    const browser=await chromium.launch({headless:true,channel:'msedge'});
    try{
        const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[];
        page.on('pageerror',e=>errors.push(e.message));
        await page.goto(process.argv[2],{waitUntil:'domcontentloaded'});await page.locator('#market-tab-screener').click();
        await page.waitForFunction(()=>document.querySelector('#opportunity-status').textContent.includes('Core Market Screener'));
        assert.equal(await page.locator('#opportunity-model').inputValue(),'v3');
        await page.locator('#opportunity-min-score').selectOption('0');
        const summary=await page.evaluate(async()=>{
            const s=await window.StaticMarketData.opportunities(),rows=s.assets.flatMap(a=>a.candidates.filter(c=>c.scoringV3).map(c=>({a,c})));
            const sorted=rows.sort(window.OpportunityScoringV3.compare),copy=JSON.parse(JSON.stringify(s.assets));
            const recalibration=window.OpportunityScoringV3.calibrate(copy);
            if(JSON.stringify(recalibration)!==JSON.stringify(s.calibrationV3))throw Error('Calibration parity failed');
            const ledger=await (await fetch('/data/screener/v3-live-ledger.json',{cache:'no-store'})).json();
            return {asOf:s.asOf,reference:s.calibrationV3.referenceCount,rows:rows.length,
                min:Math.min(...rows.map(r=>r.c.scoringV3.displayScore)),max:Math.max(...rows.map(r=>r.c.scoringV3.displayScore)),
                top:sorted.slice(0,10).map(({a,c})=>({instrument:a.key,direction:c.direction,entry:c.startDate,exit:c.endDate,
                    V3:c.scoringV3.displayScore,raw:c.scoringV3.rawScore,percentile:c.scoringV3.percentile,confidence:c.scoringV3.confidence.level,family:a.mapping.exposureFamily})),
                concentration:window.OpportunityExposures.warnings(sorted),ledgerRuns:ledger.runs.length,
                ledgerForecasts:ledger.runs.reduce((n,r)=>n+r.records.length,0)};
        });
        assert.ok(summary.reference>1&&summary.rows>=summary.reference&&summary.ledgerForecasts>0);
        const keys=await page.locator('#opportunity-results tr td:first-child strong').allTextContents();
        assert.ok(!keys.includes('LEANHOGS')&&!keys.includes('XAUUSD')&&keys.includes('NQ')&&keys.includes('MNQ'));
        const first=await page.locator('#opportunity-results tr').first().textContent();
        assert.match(first,/Skóre podkladů · V2 raw/);assert.match(first,/Relativní pořadí: #1 z 51 · TOP 2 %/);assert.match(first,/Spolehlivost: nízká/);
        assert.doesNotMatch(first,/V3:|10 \/ 10|0 z 0|0 z těchto 0/);
        assert.match(first,/COT: historické srovnání není k dispozici/);
        await page.locator('#opportunity-search').fill(summary.top[0].instrument);
        assert.equal(await page.locator('#opportunity-results tr').first().textContent(),first,'Search recalibrated scores');
        await page.locator('#opportunity-results button').filter({hasText:'Detail'}).first().click();
        const detailText=await page.locator('#opportunity-detail').textContent();
        assert.match(detailText,/Skóre podkladů: 7,1 \/ 10/);assert.match(detailText,/Relativní pořadí: #1 z 51 · TOP 2 %/);
        assert.match(detailText,/Spolehlivost: nízká/);assert.match(detailText,/USD je neutrální reference u=0, nikoli DXY/);
        assert.doesNotMatch(detailText,/V3 Experimental:|0 \/ 0|0 z 0|USD zastupuje DXY/);
        await page.locator('.opportunity-dialog-close').click();await page.locator('#opportunity-search').fill('');
        await page.locator('#opportunity-model').selectOption('v1');assert.match(await page.locator('#opportunity-results').textContent(),/bližšímu průzkumu|podklady|Omezené/i);
        await page.locator('#opportunity-model').selectOption('v2');assert.match(await page.locator('#opportunity-results').textContent(),/V2 raw/);
        await page.locator('#opportunity-model').selectOption('v3');
        await page.locator('#opportunity-exposure-order').selectOption('diverse');assert.match(await page.locator('#opportunity-results').textContent(),/Relativní pořadí:/);
        await page.locator('#opportunity-exposure-order').selectOption('raw');assert.deepEqual(errors,[]);
        fs.mkdirSync('artifacts',{recursive:true});await page.screenshot({path:path.resolve('artifacts/v3-public.png')});
        console.log(JSON.stringify(summary,null,2));console.log('Public Edge verification passed: V1/V2/V3 switch, details, filter invariance, core scope, live ledger, no JS errors.');
    }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
