// Real chart-library regression, not a mock of autoscaling or logical coordinates.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.resolve(process.argv[2]||'artifacts/cfd-zones-preview');let browser;
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':'text/plain');res.end(fs.readFileSync(file));});
const errors=[];let currentCase;
(async()=>{try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));try{browser=await chromium.launch({headless:true});}catch{browser=await chromium.launch({headless:true,channel:'msedge'});}
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port+'/lib/lightweight-charts/README.md');
 await page.setContent('<style>body{margin:0;background:#101416}#chart{width:100vw;height:480px}</style><div id="chart"></div><div id="tip" hidden></div>');
 const url='http://127.0.0.1:'+server.address().port;await page.addScriptTag({url:url+'/lib/lightweight-charts/lightweight-charts.standalone.production.js'});await page.addScriptTag({url:url+'/js/zone-price-chart.js'});
 const visible=async seasonal=>{
  await page.waitForFunction(expected=>{const d=document.getElementById('chart').dataset,n=k=>Number(d[k]),has=k=>d[k]!==undefined&&d[k]!=='null'&&Number.isFinite(n(k));return ['zoneLeft','zoneTop','zoneBottom','paneWidth','paneHeight'].every(has)&&n('paneWidth')>100&&n('zoneLeft')>=0&&n('zoneLeft')<n('paneWidth')&&n('zoneTop')>=0&&n('zoneBottom')<=n('paneHeight')&&n('zoneTop')<n('zoneBottom')&&(!expected||has('seasonalStart')&&has('seasonalEnd')&&n('seasonalStart')>=0&&n('seasonalEnd')<=n('paneWidth')&&n('seasonalStart')<n('seasonalEnd'));},seasonal);
  const d=await page.locator('#chart').evaluate(n=>({...n.dataset}));assert.ok(Number(d.zoneTop)>=0&&Number(d.zoneBottom)<=Number(d.paneHeight));if(!seasonal)assert.equal(d.seasonalStart,'null');
 };
 for(const width of [1600,390,320])for(const resolution of ['D1','W1','H4'])for(const seasonal of ['future','ongoing',false])for(const side of ['above','below']){
  currentCase={width,resolution,seasonal,side};await page.setViewportSize({width,height:820});await page.evaluate(({resolution,seasonal,side})=>{
   window.testChart?.destroy();const c=document.getElementById('chart');for(const k of Object.keys(c.dataset))delete c.dataset[k];
   const step=resolution==='H4'?14400000:resolution==='W1'?604800000:86400000,count=resolution==='H4'?2200:resolution==='W1'?104:400,start=Date.parse('2024-01-01T00:00Z');
   const bars=Array.from({length:count},(_,i)=>{const t=start+i*step;return {date:resolution==='H4'?new Date(t).toISOString():new Date(t).toISOString().slice(0,10),timestamp:t/1000,open:100+i*.01,high:102+i*.01,low:99+i*.01,close:101+i*.01};});
   const price={bars,weekly:bars,latestClose:bars.at(-1).close,provider:'OANDA',symbol:'OANDA:EURUSD'},zone={baseDate:bars[seasonal==='ongoing'?count-12:2].date,lower:side==='above'?300:10,upper:side==='above'?302:12,timeframe:resolution,type:side==='above'?'supply':'demand'},last=Date.parse(bars.at(-1).date),date=t=>new Date(t).toISOString().slice(0,10),candidate=seasonal?{startDate:seasonal==='ongoing'?date(start-5*86400000):date(last+20*86400000),endDate:date(last+180*86400000),direction:'up'}:null;
   window.originalEvidence=JSON.stringify({price,zone,candidate});window.testEvidence={price,zone,candidate};window.testChart=ZonePriceChart.create(c,document.getElementById('tip'),{price,zone,candidate,resolution});
  },{resolution,seasonal,side});
  await visible(seasonal);
  if(resolution==='D1'&&seasonal==='future'&&side==='above'&&width!==320)await page.locator('#chart').screenshot({path:path.join(root,'zone-framing-seasonal-'+width+'.png')});
  // Reset must recover the complete framing after an intentional zoom/pan.
  await page.evaluate(()=>{testChart.zoom(.1);testChart.reset();});await visible(seasonal);
  await page.setViewportSize({width:width===320?1000:320,height:740});await page.waitForTimeout(100);await visible(seasonal);
  assert.ok(await page.evaluate(()=>JSON.stringify(testEvidence)===originalEvidence),'No provider price/zone/window mutation');
 }
 await page.setViewportSize({width:390,height:740});await page.waitForTimeout(100);await visible(false);await page.locator('#chart').screenshot({path:path.join(root,'zone-framing-mobile.png')});
 await page.evaluate(()=>testChart.destroy());assert.deepEqual(errors,[]);console.log('PASS 54 real-library chart cases: old/new origins, zones above/below candles, D1/W1/H4, long/ongoing/no seasonality, 1600/390/320px, resize, reset and immutable inputs.');
}catch(e){console.error({currentCase,errors});const pages=browser?.contexts()[0]?.pages();if(pages?.[0])console.error(await pages[0].locator('#chart').evaluate(n=>({...n.dataset})));throw e;}finally{await browser?.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
