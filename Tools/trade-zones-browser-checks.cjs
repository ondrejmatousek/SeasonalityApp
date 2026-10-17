const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.resolve(process.argv[2]||'artifacts/data-runs-preview');let browser;const errors=[];
const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost'),name=path.resolve(root,'.'+(url.pathname.endsWith('/')?url.pathname+'index.html':url.pathname));if(!name.startsWith(root+path.sep)||!fs.existsSync(name)||!fs.statSync(name).isFile()){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.svg':'image/svg+xml'})[path.extname(name)]||'application/octet-stream');res.end(fs.readFileSync(name));});
(async()=>{try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));try{browser=await chromium.launch({headless:true});}catch{browser=await chromium.launch({headless:true,channel:'msedge'});}
 const page=await browser.newPage({viewport:{width:1600,height:1000}});page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port+'/');
 await page.getByRole('tab',{name:'Obchodní zóny',exact:true}).click();await page.locator('#tz-results button').first().waitFor();assert.ok(await page.locator('#tz-results button').count()>0);
 assert.ok(await page.locator('#tz-chart').getAttribute('data-candle-count'));assert.match(await page.locator('#tz-status').textContent(),/Session a makro neověřeny/);
 const wtiDate=await page.evaluate(async()=>{const s=await StaticMarketData.zonePrices(),p=s.prices.WTI;return MarketCandles.dateInfo(p,p.bars.at(-1));});
 if(wtiDate.sessionDate){assert.match(await page.locator('#tz-coverage').textContent(),new RegExp('WTI:.*datum svíčky '+wtiDate.barDate+'.*den session '+wtiDate.sessionDate),'Real snapshot coverage distinguishes UTC start and derived session day');}
 for(const row of await page.locator('#tz-results tr').allTextContents())assert.ok(!row.includes('Research / review'),'Core/research separation');
 const rowKeys=await page.locator('#tz-results tr[data-zone-id]').evaluateAll(rows=>rows.map(r=>r.dataset.symbol+'|'+r.dataset.zoneId));assert.equal(new Set(rowKeys).size,rowKeys.length,'Unique rendered zones');
 const datasets=()=>page.locator('#tz-results tr[data-zone-id]').evaluateAll(rows=>rows.map(r=>({...r.dataset})));
 const unfiltered=await datasets();assert.equal(await page.locator('#tz-results tr[data-zone-id]').first().locator('td').count(),7,'New proximity column');
 const expectedDistances=await page.evaluate(async()=>{const h=await StaticMarketData.zonePrices(),cache=new Map();return [...document.querySelectorAll('#tz-results tr[data-zone-id]')].map(r=>{const key=r.dataset.symbol,tf=r.dataset.timeframe,p=tf==='H4'?h.prices[key].h4:h.prices[key],cacheKey=key+tf;if(!cache.has(cacheKey))cache.set(cacheKey,TradeZones.detect(p,tf,tf==='H4'?p.asOfUtc:h.asOf));const z=cache.get(cacheKey).find(z=>z.id===r.dataset.zoneId);return Math.max(z.lower-p.latestClose,p.latestClose-z.upper,0)/Math.abs(p.latestClose)*100;});});
 unfiltered.forEach((r,i)=>assert.ok(Math.abs(Number(r.distancePct)-expectedDistances[i])<1e-10,'Rendered percentage uses correct source price and boundaries'));
 await page.locator('#tz-sort').selectOption('distance');const nearest=await datasets();assert.ok(nearest.every((r,i)=>!i||Number(nearest[i-1].distancePct)<=Number(r.distancePct)),'Nearest first is numeric, not alphabetical');
 await page.locator('#tz-max-distance').fill('1');assert.equal((await datasets()).length,unfiltered.filter(r=>Number(r.distancePct)<=1).length,'Exact max percentage filter');
 await page.locator('#tz-max-distance').fill('0');assert.equal((await datasets()).length,unfiltered.filter(r=>Number(r.distancePct)===0).length,'Zero limit means inside zone only');
 await page.locator('#tz-clear-filters').click();
 for(const [id,field,value]of [['tz-quality','quality','2'],['tz-volume','volume','high'],['tz-volume','volume','unknown'],['tz-seasonal','seasonal','supports'],['tz-seasonal','seasonal','against'],['tz-seasonal','seasonal','unknown'],['tz-cot','cot','confirms'],['tz-cot','cot','insufficient']]){
  await page.locator('#'+id).selectOption(value);assert.equal((await datasets()).length,unfiltered.filter(r=>field==='quality'?Number(r[field])>=Number(value):r[field]===value).length,`${id} preserves exact matching set, including unknown states`);await page.locator('#tz-clear-filters').click();
 }
 await page.locator('#tz-quality').selectOption('2');await page.locator('#tz-volume').selectOption('high');await page.locator('#tz-seasonal').selectOption('supports');
 assert.equal((await datasets()).length,unfiltered.filter(r=>Number(r.quality)>=2&&r.volume==='high'&&r.seasonal==='supports').length,'Filters intersect, not union');await page.locator('#tz-clear-filters').click();
 await page.locator('#tz-sort').selectOption('newest');const newest=await datasets();assert.ok(newest.every((r,i)=>!i||newest[i-1].confirmedAt>=r.confirmedAt));await page.locator('#tz-clear-filters').click();assert.equal((await datasets()).length,unfiltered.length,'Reset restores all core results');
 await page.locator('#tz-search').fill('CADJPY');
 const cad=page.locator('#tz-results tr').filter({hasText:'2025-12-04'}).filter({hasText:'2025-12-09'});assert.equal(await cad.count(),0,'Mitigated CADJPY screenshot zone is hidden');
 await page.locator('#tz-kind').selectOption('base');assert.equal(await page.locator('#tz-results tr').filter({hasText:'2025-12-04'}).filter({hasText:'2025-12-09'}).count(),0);await page.locator('#tz-search').fill('');
 await page.locator('#tz-kind').selectOption('origin');for(const r of await page.locator('#tz-results tr').allTextContents())assert.match(r,/Původ impulzu/);
 await page.locator('#tz-bos').selectOption('yes');for(const r of await page.locator('#tz-results tr').allTextContents())assert.match(r,/BOS close potvrzen/);
 await page.locator('#tz-bos').selectOption('all');await page.locator('#tz-kind').selectOption('all');await page.locator('#tz-search').fill('');assert.ok(await page.locator('#tz-results button').count()>0);
 // Find a real surviving zone with supported seasonal context, not a hardcoded invalidated instrument.
 const h4Available=await page.evaluate(async()=>!!(await StaticMarketData.zonePrices()).h4);
 if(h4Available){await page.locator('#tz-tf').selectOption('H4');const rows=await datasets();assert.ok(rows.length>0);assert.ok(rows.every(r=>r.timeframe==='H4'));await page.locator('#tz-results button').first().click();assert.equal(await page.locator('#tz-resolution').inputValue(),'H4');assert.equal(await page.locator('#tz-chart').getAttribute('data-resolution'),'H4');assert.match(await page.locator('#tz-caption').textContent(),/H4 z Azure SQL/);assert.match(await page.locator('#tz-title').textContent(),/H4/);await page.locator('#tz-chart').hover({position:{x:160,y:180}});await page.waitForFunction(()=>document.getElementById('tz-tip').textContent.includes('UTC'));assert.match(await page.locator('#tz-tip').textContent(),/UTC/);await page.screenshot({path:path.join(root,'h4-zones-desktop.png'),fullPage:true});await page.locator('#tz-clear-filters').click();}
 const target=await page.evaluate(async()=>{const h=await StaticMarketData.zonePrices(),o=await StaticMarketData.opportunities();for(const a of o.assets){if(a.mapping?.scope!=='core'||!h.prices[a.key])continue;for(const z of TradeZones.detect(h.prices[a.key],'D1',h.asOf)){const c=TradeZones.context(z,a,h.asOf).candidate;if(c&&c.startDate.slice(0,4)===c.endDate.slice(0,4))return {key:a.key,id:z.id};}}});assert.ok(target);
 await page.locator('#tz-search').fill(target.key);await page.locator('tr[data-zone-id]').filter({has:page.locator('button')}).evaluateAll((rows,id)=>rows.find(r=>r.dataset.zoneId===id).querySelector('button').click(),target.id);
 await page.waitForFunction(()=>Number.isFinite(Number(document.getElementById('tz-chart').dataset.seasonalStart))&&document.getElementById('tz-chart').dataset.seasonalStart!=='null');
 assert.match(await page.locator('#tz-caption').textContent(),/Svislé sezonní okno/);
 await page.locator('#tz-resolution').selectOption('W1');await page.waitForFunction(()=>Number.isFinite(Number(document.getElementById('tz-chart').dataset.seasonalEnd))&&document.getElementById('tz-chart').dataset.seasonalEnd!=='null');await page.locator('#tz-resolution').selectOption('D1');
 const interval=await page.locator('#tz-open-seasonality').evaluate(b=>({...b.dataset}));
 await page.locator('#tz-open-seasonality').click();assert.equal(await page.locator('#market-seasonality-view').isVisible(),true);
 assert.equal(await page.locator('#seasonality-start-date').inputValue(),interval.startDate);assert.equal(await page.locator('#seasonality-end-date').inputValue(),interval.endDate);
 await page.waitForFunction(key=>document.querySelector('.seasonality-page').dataset.assetKey===key,target.key);assert.equal(await page.locator('#seasonality-years').inputValue(),'20');
 await page.getByRole('tab',{name:'Obchodní zóny',exact:true}).click();await page.locator('#tz-open-cot').click();assert.equal(await page.locator('#market-cot-view').isVisible(),true);
 await page.waitForFunction(()=>document.getElementById('cot-asset-title').textContent==='COT · '+document.getElementById('seasonality-asset-search').value);
 assert.equal(await page.locator('.seasonality-page').getAttribute('data-asset-key'),target.key);
 await page.getByRole('tab',{name:'Obchodní zóny',exact:true}).click();
 await page.locator('#tz-search').fill('');await page.locator('#tz-volume-window').selectOption('3');await page.locator('#tz-bounds').selectOption('body-wick');assert.ok(await page.locator('#tz-results button').count()>0);
 await page.locator('#tz-search').fill('NO_SUCH_SYMBOL');assert.match(await page.locator('#tz-results').textContent(),/Žádná platná zóna/);assert.equal(await page.locator('#tz-detail').isVisible(),false);
 await page.locator('#tz-search').fill('');await page.screenshot({path:path.join(root,'trade-zones-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Mobile overflow');await page.screenshot({path:path.join(root,'trade-zones-mobile.png'),fullPage:true});
 await page.evaluate(()=>{window.StaticMarketData.opportunities=async()=>{throw Error('Test unavailable context');};});
 await page.locator('#tz-reload').click();await page.waitForFunction(()=>document.getElementById('tz-caption').textContent.includes('Sezonní okno není dostupné'));
 assert.ok(await page.locator('#tz-results button').count()>0,'Missing seasonality never hides zones');
 await page.waitForFunction(()=>document.getElementById('tz-chart').dataset.seasonalStart==='null');
 assert.equal(await page.locator('#tz-open-seasonality').isDisabled(),true,'No fabricated seasonal interval without context');
 assert.equal(await page.getByRole('tab',{name:'HTF shoda',exact:true}).count(),0);assert.equal(await page.locator('#market-htf-view').count(),0);
 const resources=await page.locator('script[src],link[rel=stylesheet]').evaluateAll(nodes=>nodes.map(n=>n.src||n.href));assert.ok(!resources.some(s=>/\/(htf-ui|htf-chart|htf-zones|htf)\.(js|css)/.test(s)),'Retired resources not loaded');
 await page.getByRole('tab',{name:'Seasonality',exact:true}).click();assert.equal(await page.locator('#market-seasonality-view').isVisible(),true);assert.deepEqual(errors,[]);
 console.log('PASS: actual zone-first tab, chart/seasonal window, filters, desktop/mobile, no retired HTF tab/resources and working Seasonality navigation.');
 }finally{if(browser)await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
