// Real browser against a rendered static export; private local server, no provider/SQL calls.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const root=path.resolve(process.argv[2]||'artifacts/data-runs-preview');
const errors=[];let browser;
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 const file=path.resolve(root,'.'+(pathname.endsWith('/')?pathname+'index.html':pathname));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
 res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
});
(async()=>{try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{browser=await chromium.launch({headless:true});}catch{browser=await chromium.launch({headless:true,channel:'msedge'});}
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
 const audit={schemaVersion:1,ready:true,asOf:new Date().toISOString(),limitPerSource:200,runs:Array.from({length:31},(_,i)=>({id:String(i).padStart(64,'a'),source:i<19?'market_h4':'market_zones',timeframes:[i<19?'H4':'D1'],receivedAt:new Date(Date.UTC(i<19?2026:2020,9,18,0,i)).toISOString(),status:i===0?'PartialConflict':'Accepted',inserted:i===0?27:0,blockedSymbols:i===0?['OANDA:EURUSD']:[],duplicates:12,excluded:0,symbols:1,receivedBars:12,volumeWarnings:0,historical:false}))};
 await page.route('**/api/data-runs/receipts',r=>r.fulfill({json:audit}));
 await page.route('**/artifacts/daily-health/latest.json',r=>r.fulfill({json:{schemaVersion:1,runDate:'2026-10-20',runStartedAt:'2026-10-20T01:00:00Z',runFinishedAt:'2026-10-20T01:24:00Z',staleAfter:'2026-10-21T01:00:00Z',status:'ok',mode:'live',instrumentChecks:[{symbol:'WTI',lastBarDate:'2026-10-19',lastSessionDate:'2026-10-19'}]}}));
 await page.goto('http://127.0.0.1:'+server.address().port+'/');
 const snapshot=await page.evaluate(async()=>window.StaticMarketData.opportunities());assert.ok(snapshot.assets.filter(a=>a.candidates.length).every(a=>a.candidates.every(c=>c.scoringV1ByHistory&&c.scoringV2)),'Existing automatic V1/V2 scores remain built server-side');
 await page.goto('http://127.0.0.1:'+server.address().port+'/runs/');
 await page.locator('.run-day').first().waitFor();
 await page.waitForFunction(()=>!document.getElementById('runs-refresh').disabled);
 assert.match(await page.locator('#runs-detail').textContent(),/WTI \/ datum svíčky \(UTC začátek\)/);
 assert.match(await page.locator('#runs-detail').textContent(),/WTI \/ den session \(odvozený\)/);
 assert.ok(await page.locator('.run-steps li').count()>=10);
 assert.equal(await page.locator('#daily-health-toggle').count(),0);
 assert.equal(await page.locator('.app-navbar .nav-link').count(),0,'No duplicate links in the top-right header');
 await page.getByRole('link',{name:'Denní běhy',exact:true}).waitFor();
 await page.locator('#runs-next').click();assert.match(await page.locator('#runs-page').textContent(),/^2 \/ /);
 await page.locator('#runs-h4').click();assert.equal(await page.locator('.run-day').count(),8);assert.match(await page.locator('#runs-page').textContent(),/^1 \/ 3/);
 assert.match(await page.locator('#runs-detail').textContent(),/Duplicity/);assert.match(await page.locator('#runs-detail').textContent(),/neobsahovala žádné nové/);assert.equal(await page.locator('.is-served').count(),0,'SQL receipt is not deployment proof');
 const firstId=await page.locator('.run-day').first().getAttribute('data-day');await page.locator('#runs-next').click();assert.match(await page.locator('#runs-page').textContent(),/^2 \/ 3/);assert.notEqual(await page.locator('.run-day').first().getAttribute('data-day'),firstId);
 await page.locator('#runs-d1').click();assert.match(await page.locator('#runs-page').textContent(),/^2 \/ /,'Independent D1 page retained');
 await page.locator('#runs-h4').click();assert.match(await page.locator('#runs-page').textContent(),/^2 \/ 3/,'Independent H4 page retained');
 await page.locator('#runs-next').click();assert.equal(await page.locator('.run-day').count(),3);assert.equal(await page.locator('#runs-next').isDisabled(),true);
 await page.locator('.run-day').last().click();assert.match(await page.locator('#runs-detail').textContent(),/Částečné přijetí/);assert.match(await page.locator('#runs-detail').textContent(),/OANDA:EURUSD/);await page.locator('#runs-d1').click();
 await page.screenshot({path:path.join(root,'runs-desktop.png'),fullPage:true});
 for(const route of ['/','/runs/']){
  await page.goto('http://127.0.0.1:'+server.address().port+route);
  for(const width of [320,390,600,768,991]){
   await page.setViewportSize({width,height:844});
   const geometry=await page.evaluate(()=>{
    const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height};};
    return {sidebar:box('.app-sidebar'),main:box('.app-workspace-main'),links:[...document.querySelectorAll('.sidebar-link')].map(e=>e.getBoundingClientRect().height),position:getComputedStyle(document.querySelector('.app-sidebar')).position};
   });
   assert.ok(geometry.sidebar.height<844,`${route} ${width}: mobile navigation fits screen`);
   assert.ok(geometry.links.every(h=>h>=44&&h<=80),`${route} ${width}: touch-sized links without vertical stretching`);
   assert.ok(geometry.main.top>=geometry.sidebar.bottom-1,`${route} ${width}: navigation does not overlap content`);
   assert.equal(geometry.position,'static',`${route} ${width}: mobile navigation scrolls with the page`);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),`${route} ${width}: no horizontal overflow`);
  }
 }
 await page.goto('http://127.0.0.1:'+server.address().port+'/runs/');
 await page.locator('.run-day').first().waitFor();
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.getByRole('link',{name:'Denní běhy',exact:true}).isVisible(),true,'Sidebar navigation remains reachable on mobile');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Mobile horizontal overflow');
 await page.screenshot({path:path.join(root,'runs-mobile.png'),fullPage:true});
 await page.locator('#runs-h4').click();
 for(const width of [320,390,768]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'H4 mobile pagination and long receipt ID fit viewport');}
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(root,'runs-h4-mobile.png'),fullPage:true});await page.locator('#runs-d1').click();
 await page.route('**/data/manifest.json',r=>r.fulfill({status:503,body:'Unavailable'}));await page.getByRole('button',{name:'Obnovit',exact:true}).click();await page.waitForFunction(()=>document.getElementById('runs-state').textContent.includes('nelze ověřit'));
 assert.equal(await page.locator('.run-badge.is-served').count(),0);
 await page.route('**/artifacts/daily-health/latest.json',r=>r.fulfill({status:503,body:'Unavailable'}));await page.getByRole('button',{name:'Obnovit',exact:true}).click();await page.waitForFunction(()=>document.getElementById('runs-state').textContent.includes('HTTP 503'));await page.locator('#runs-h4').click();assert.ok(await page.locator('.run-day').count()>0,'D1 report failure does not hide H4');
 await page.route('**/api/data-runs/receipts',r=>r.fulfill({status:503,body:'Unavailable'}));await page.getByRole('button',{name:'Obnovit',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('runs-refresh').disabled);assert.ok(await page.locator('.run-day').count()>0,'Last good audit survives refresh failure');assert.match(await page.locator('#runs-audit-state').textContent(),/kopie SQL auditu/);
 const slow=await browser.newPage({viewport:{width:390,height:844}});slow.on('pageerror',e=>errors.push(e.message));
 await slow.addInitScript(()=>Object.defineProperty(AbortSignal,'timeout',{value:undefined}));
 let release;const gate=new Promise(resolve=>{release=resolve;});
 await slow.route('**/api/data-runs/receipts',async r=>{await gate;await r.fulfill({json:audit});});
 await slow.route('**/data/manifest.json',async r=>{await gate;await r.continue();});
 try{
  await slow.goto('http://127.0.0.1:'+server.address().port+'/runs/',{waitUntil:'domcontentloaded'});
  await slow.locator('.run-day').first().waitFor({timeout:3000});
  assert.equal(await slow.locator('#runs-refresh').isDisabled(),true,'Audit and manifest are still pending while D1 is already visible');
  await slow.waitForFunction(()=>document.getElementById('runs-audit-state').textContent.includes('kopie SQL auditu'));
  await slow.locator('#runs-h4').click();assert.ok(await slow.locator('.run-day').count()>0,'Published fallback shows H4 before live API returns');
  assert.ok(await slow.locator('.run-day').count()>0,'Slow independent dependencies never block D1');
 }finally{release();}
 await slow.waitForFunction(()=>!document.getElementById('runs-refresh').disabled);await slow.locator('#runs-h4').click();assert.ok(await slow.locator('.run-day').count()>0);await slow.close();
 const cold=await browser.newPage();cold.on('pageerror',e=>errors.push(e.message));
 let releaseCold;const coldGate=new Promise(r=>{releaseCold=r;});
 await cold.route('**/data/data-runs/receipts.json',r=>r.fulfill({status:503,body:'Unavailable'}));
 await cold.route('**/api/data-runs/receipts',async r=>{await coldGate;await r.fulfill({json:audit});});
 await cold.goto('http://127.0.0.1:'+server.address().port+'/runs/',{waitUntil:'domcontentloaded'});await cold.locator('#runs-h4').click();
 assert.match(await cold.locator('#runs-page').textContent(),/Načítám/,'Pending request must not claim zero runs');
 assert.match(await cold.locator('#runs-detail').textContent(),/Načítám uložené H4/);
 await cold.waitForTimeout(13000);releaseCold();
 await cold.waitForFunction(()=>document.getElementById('runs-audit-state').textContent.startsWith('Živý SQL audit'));
 assert.equal(await cold.locator('.run-day').count(),8,'Cold API response after old 12-second cutoff is accepted');
 await cold.close();
 const unavailable=await browser.newPage();
 for(const url of ['**/api/data-runs/receipts','**/data/data-runs/receipts.json'])await unavailable.route(url,r=>r.fulfill({status:503,body:'Unavailable'}));
 await unavailable.goto('http://127.0.0.1:'+server.address().port+'/runs/');await unavailable.locator('#runs-h4').click();
 await unavailable.waitForFunction(()=>!document.getElementById('runs-refresh').disabled);
 assert.equal(await unavailable.locator('.run-day').count(),0);assert.match(await unavailable.locator('#runs-detail').textContent(),/Nelze z toho vyvozovat/);await unavailable.close();
 assert.deepEqual(errors,[]);console.log('PASS: rendered Data view in real browser, day selection, desktop/mobile layout, no old popup, missing manifest and HTTP error states.');
 }finally{if(browser)await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
