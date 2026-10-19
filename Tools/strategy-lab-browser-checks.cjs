const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{chromium}=require('playwright'),L=require('../wwwroot/js/strategy-lab.js');
const root=path.resolve(process.argv[2]||'artifacts/cfd-zones-preview');let browser;const errors=[];
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost'),file=path.resolve(root,'.'+(u.pathname.endsWith('/')?u.pathname+'index.html':u.pathname));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));});
(async()=>{try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));try{browser=await chromium.launch({headless:true});}catch{browser=await chromium.launch({headless:true,channel:'msedge'});}
 const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/strategy-lab/');await page.waitForFunction(()=>!document.getElementById('lab-run').disabled);
 assert.equal(await page.locator('#lab-symbol option').count(),3);assert.match(await page.locator('.lab-warning').textContent(),/nelze vyhlásit/);
 await page.locator('#lab-run').click();await page.waitForFunction(()=>!document.getElementById('lab-export').disabled);assert.equal(await page.locator('#lab-results tr').count(),24);assert.match(await page.locator('#lab-report-context').textContent(),/ŽÁDNÝ VÍTĚZ PRO LIVE/);
 async function download(){const promise=page.waitForEvent('download');await page.locator('#lab-export').click();const item=await promise;return JSON.parse(fs.readFileSync(await item.path(),'utf8'));}
 const zones=await download();assert.equal(zones.selectionEligible,false);assert.ok(zones.results.every(r=>r.config.model!=='ema'&&!Object.hasOwn(r.config,'fast')));
 const data=JSON.parse(fs.readFileSync(path.join(root,'research/strategy-lab-pilot.json'))),prepared=L.prepare(data.instruments[0]);
 assert.deepEqual(zones.results[0].metrics,L.run(prepared,zones.results[0].config).metrics,'Web Worker and CLI use identical engine');
 await page.locator('#lab-family').selectOption('ema');await page.locator('#lab-run').click();await page.waitForFunction(()=>!document.getElementById('lab-export').disabled);assert.equal(await page.locator('#lab-results tr').count(),8);
 const ema=await download();assert.ok(ema.results.every(r=>r.config.model==='ema'));assert.deepEqual(ema.results[0].metrics,L.run(prepared,ema.results[0].config).metrics);
 await page.locator('#lab-spread').fill('10');await page.locator('#lab-run').click();await page.waitForFunction(()=>!document.getElementById('lab-export').disabled);const expensive=await download();assert.ok(expensive.results[0].metrics.totalR<ema.results[0].metrics.totalR,'Explicit higher costs reduce same simulated strategy result');
 await page.screenshot({path:path.join(root,'strategy-lab-desktop.png'),fullPage:true});
 for(const width of [320,390,768]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Lab mobile overflow '+width);}
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(root,'strategy-lab-mobile.png'),fullPage:true});
 await page.locator('#lab-spread').fill('-1');await page.locator('#lab-run').click();assert.match(await page.locator('#lab-status').textContent(),/musí být čísla/);assert.equal(await page.locator('#lab-export').isDisabled(),true);
 await page.route('**/research/strategy-lab-pilot.json',r=>r.fulfill({status:503,body:'Unavailable'}));await page.reload();await page.waitForFunction(()=>document.getElementById('lab-data-state').textContent.includes('nejsou dostupná'));assert.equal(await page.locator('#lab-run').isDisabled(),true);
 assert.deepEqual(errors,[]);console.log('PASS: real rendered lab, separate 24/8 variant workers, exact CLI parity, audit export, costs, mobile and unavailable-data states. No SQL/provider/order calls.');
}finally{if(browser)await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
