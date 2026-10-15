// Real browser against a rendered static export; private local server, no provider/SQL calls.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
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
 await page.goto('http://127.0.0.1:'+server.address().port+'/');
 const snapshot=await page.evaluate(async()=>window.StaticMarketData.opportunities());assert.ok(snapshot.assets.filter(a=>a.candidates.length).every(a=>a.candidates.every(c=>c.scoringV1ByHistory&&c.scoringV2)),'Existing automatic V1/V2 scores remain built server-side');
 await page.goto('http://127.0.0.1:'+server.address().port+'/runs/');
 await page.locator('.run-day').first().waitFor();
 assert.ok(await page.locator('.run-steps li').count()>=10);
 assert.equal(await page.locator('#daily-health-toggle').count(),0);
 assert.equal(await page.locator('.app-navbar .nav-link').count(),0,'No duplicate links in the top-right header');
 await page.getByRole('link',{name:'Denní běhy',exact:true}).waitFor();
 if(await page.locator('.run-day').count()>1){const button=page.locator('.run-day').nth(1),day=await button.getAttribute('data-day');await button.click();assert.equal(await page.locator('#runs-detail h3').first().textContent(),day);}
 await page.screenshot({path:path.join(root,'runs-desktop.png'),fullPage:true});
 for(const route of ['/','/runs/']){
  await page.goto('http://127.0.0.1:'+server.address().port+route);
  for(const width of [320,390,600,768,991]){
   await page.setViewportSize({width,height:844});
   const geometry=await page.evaluate(()=>{
    const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height};};
    return {sidebar:box('.app-sidebar'),main:box('.app-workspace-main'),links:[...document.querySelectorAll('.sidebar-link')].map(e=>e.getBoundingClientRect().height),position:getComputedStyle(document.querySelector('.app-sidebar')).position};
   });
   assert.ok(geometry.sidebar.height<=140,`${route} ${width}: compact mobile navigation`);
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
 await page.route('**/data/manifest.json',r=>r.fulfill({status:503,body:'Unavailable'}));await page.getByRole('button',{name:'Obnovit',exact:true}).click();await page.waitForFunction(()=>document.getElementById('runs-state').textContent.includes('nelze ověřit'));
 assert.equal(await page.locator('.run-badge.is-served').count(),0);
 await page.route('**/artifacts/daily-health/latest.json',r=>r.fulfill({status:503,body:'Unavailable'}));await page.getByRole('button',{name:'Obnovit',exact:true}).click();await page.waitForFunction(()=>document.getElementById('runs-state').textContent.includes('HTTP 503'));assert.equal(await page.locator('.run-day').count(),0);
 assert.deepEqual(errors,[]);console.log('PASS: rendered Data view in real browser, day selection, desktop/mobile layout, no old popup, missing manifest and HTTP error states.');
 }finally{if(browser)await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
