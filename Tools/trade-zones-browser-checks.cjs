const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.resolve(process.argv[2]||'artifacts/data-runs-preview');let browser;const errors=[];
const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost'),name=path.resolve(root,'.'+(url.pathname.endsWith('/')?url.pathname+'index.html':url.pathname));if(!name.startsWith(root+path.sep)||!fs.existsSync(name)||!fs.statSync(name).isFile()){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.svg':'image/svg+xml'})[path.extname(name)]||'application/octet-stream');res.end(fs.readFileSync(name));});
(async()=>{try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));try{browser=await chromium.launch({headless:true});}catch{browser=await chromium.launch({headless:true,channel:'msedge'});}
 const page=await browser.newPage({viewport:{width:1600,height:1000}});page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port+'/');
 await page.getByRole('tab',{name:'Obchodní zóny',exact:true}).click();await page.locator('#tz-results button').first().waitFor();assert.ok(await page.locator('#tz-results button').count()>0);
 assert.ok(await page.locator('#tz-chart').getAttribute('data-candle-count'));assert.match(await page.locator('#tz-status').textContent(),/Session a makro neověřeny/);
 for(const row of await page.locator('#tz-results tr').allTextContents())assert.ok(!row.includes('Research / review'),'Core/research separation');
 await page.locator('#tz-kind').selectOption('origin');for(const r of await page.locator('#tz-results tr').allTextContents())assert.match(r,/Původ impulzu/);
 await page.locator('#tz-bos').selectOption('yes');for(const r of await page.locator('#tz-results tr').allTextContents())assert.match(r,/BOS close potvrzen/);
 await page.locator('#tz-bos').selectOption('all');await page.locator('#tz-search').fill('GBPAUD');assert.ok(await page.locator('#tz-results button').count()>0);
 await page.locator('#tz-search').fill('');await page.locator('#tz-volume-window').selectOption('3');await page.locator('#tz-bounds').selectOption('body-wick');assert.ok(await page.locator('#tz-results button').count()>0);
 await page.locator('#tz-search').fill('NO_SUCH_SYMBOL');assert.match(await page.locator('#tz-results').textContent(),/Žádná platná zóna/);assert.equal(await page.locator('#tz-detail').isVisible(),false);
 await page.locator('#tz-search').fill('');await page.screenshot({path:path.join(root,'trade-zones-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Mobile overflow');await page.screenshot({path:path.join(root,'trade-zones-mobile.png'),fullPage:true});
 await page.getByRole('tab',{name:'HTF shoda',exact:true}).click();await page.waitForFunction(()=>document.getElementById('htf-status').textContent.includes('Vyhodnoceno'));assert.equal(await page.locator('#market-zones-view').isVisible(),false);assert.equal(await page.locator('#market-htf-view').isVisible(),true);
 await page.getByRole('tab',{name:'Seasonality',exact:true}).click();assert.equal(await page.locator('#market-seasonality-view').isVisible(),true);assert.deepEqual(errors,[]);
 console.log('PASS: actual zone-first tab, live snapshot rendering/chart, origin/BOS/asset/volume/bounds filters, empty states, desktop/mobile and unchanged HTF/Seasonality tab navigation.');
 }finally{if(browser)await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
