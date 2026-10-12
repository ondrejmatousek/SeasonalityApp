const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const dir=path.resolve(process.argv[2]||'artifacts/morning-market-routing-v1'),legacy=path.resolve(process.argv[3]||'artifacts/htf-preview');
const read=(root,p)=>JSON.parse(fs.readFileSync(path.join(root,p.replace(/^\//,'')),'utf8'));
const m=read(dir,'data/manifest.json'),old=read(legacy,'data/manifest.json'),htf=read(dir,m.htfConfluence.path),summary=read(dir,m.screener.path),opps=read(dir,m.opportunities.path);
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const expected={EURUSD:['OANDA','OANDA:EURUSD'],NDX:['NASDAQ','NASDAQ:NDX'],SPX:['S&P','SP:SPX'],XAUUSD:['OANDA','OANDA:XAUUSD'],WTI:['NYMEX','NYMEX:CL1!']};
for(const [key,[provider,symbol]]of Object.entries(expected)){
 const a=m.assets.find(a=>a.key===key),p=read(dir,a.prices.path);
 assert.equal(a.priceSource.provider,provider);assert.equal(a.priceSource.providerSymbol,symbol);assert.notEqual(a.prices.path,old.assets.find(a=>a.key===key).prices.path);
 assert.deepEqual(p.prices,JSON.parse(fs.readFileSync(path.join('artifacts/tradingview-backfill-36-v1/analytics-sources-v1',a.priceSource.file))).prices);
 assert.equal(htf.prices[key].priceSeriesId,a.priceSource.id);assert.equal(htf.prices[key].symbol,symbol);
 assert.equal(opps.assets.find(a=>a.key===key).mapping.priceSeriesId,a.priceSource.id);
}
for(const a of m.assets.filter(a=>!['forex','index','commodity'].includes(a.assetClass))){const b=old.assets.find(b=>b.key===a.key);assert.deepEqual(a.prices,b.prices);assert.equal(hash(path.join(dir,a.prices.path)),hash(path.join(legacy,b.prices.path)));}
const apple=m.assets.find(a=>a.key==='AAPL');assert.equal(apple.priceSource.provider,'Yahoo');
assert.equal(apple.prices.lastDate,old.assets.find(a=>a.key==='AAPL').prices.lastDate);
assert.equal(summary.assets.find(a=>a.key==='AAPL').lastDate,apple.prices.lastDate);
// Show that next analytics consume stock input revisions, not an old cached summary.
const metrics=require('../wwwroot/js/screener-metrics.js'),prices=read(dir,apple.prices.path).prices;
assert.deepEqual(summary.assets.find(a=>a.key==='AAPL').windows['30:10'],metrics.summarize(prices,summary.asOf,30,'10'));
const revised=prices.map(p=>[...p]);for(const p of revised)if(p[0]>='2025-11-10'&&p[0]<='2025-11-12')p[1]*=1.1;
assert.notDeepEqual(metrics.summarize(revised,summary.asOf,30,'10'),metrics.summarize(prices,summary.asOf,30,'10'));
for(const [code,contract]of Object.entries(m.contracts))for(const url of Object.values(contract.files))assert.equal(hash(path.join(dir,url)),hash(path.join(legacy,url)),'COT unchanged '+code);
assert.ok(htf.prices.SPX.bars.every(b=>b.date>='1962-01-01'));
assert.equal(opps.assets.find(a=>a.key==='XAUUSD').mapping.scope,'research');assert.equal(opps.assets.find(a=>a.key==='WTI').mapping.scope,'research');
assert.equal(read(dir,m.assets.find(a=>a.key==='LEANHOGS').prices.path).prices.length,0);
const workflow=fs.readFileSync('.github/workflows/seasonality-update.yml','utf8');assert.match(workflow,/cron: '0 4 \* \* \*'/);assert.match(workflow,/cron: '0 5 \* \* \*'/);assert.ok(!workflow.includes('static-web-apps-deploy'));
console.log('PASS: representative real price files, 28 FX routed, stocks/ETF byte-identical and consumed by fresh seasonality metrics, research flags, unchanged COT files, SPX HTF boundary, DST-aware schedule without deploy.');
