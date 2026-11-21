const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const F=require('../wwwroot/js/h4-history-format.js'),{saveManifest}=require('./apply-market-sources.cjs');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function build(site,source){
 site=path.resolve(site);assert.ok(site.startsWith(path.resolve('artifacts')+path.sep));
 assert.equal(source.provider,'Dukascopy');assert.equal(source.priceSide,'BID');
 const manifest=JSON.parse(fs.readFileSync(path.join(site,'data/manifest.json')));
 const zones=JSON.parse(fs.readFileSync(path.join(site,manifest.zonePrices.path.slice(1))));
 const index={schemaVersion:1,kind:'backtest-history-v1',provider:'Dukascopy',asOf:source.builtAt,prices:{},note:'Complete stored Dukascopy BID H4 history. Four complete H1 candles per H4, NY17 alignment. Missing periods remain gaps.'};
 const folder=path.join(site,'data/backtesting');fs.mkdirSync(folder,{recursive:true});
 for(const [key,p] of Object.entries(zones.prices)){
  if(p.h4?.status!=='ready')continue;
  assert.equal(p.h4.provider,'Dukascopy');
  const sourceKey=key==='SILVER'?'XAGUSD':key;
  const bars=source.rows.filter(r=>r.key===sourceKey&&r.interval==='H4').map(r=>({timestamp:r.timestamp,date:new Date(r.timestamp*1000).toISOString(),endDate:new Date((r.timestamp+14400)*1000).toISOString(),open:r.open,high:r.high,low:r.low,close:r.close,volume:r.volume}));
  assert.ok(bars.length>=100,key);assert.equal(new Set(bars.map(b=>b.timestamp)).size,bars.length);
  const price={...p.h4,bars,validatedBarCount:bars.length};delete price.dailyLifecycleBars;
  const bytes=JSON.stringify(F.encode(price)),sha=hash(bytes),url='/data/backtesting/h4-'+key+'.'+sha.slice(0,20)+'.json';
  fs.writeFileSync(path.join(site,url.slice(1)),bytes);
  index.prices[key]={h4:{status:'ready',provider:'Dukascopy',symbol:price.symbol,historyPath:url,sha256:sha,count:bars.length,first:bars[0].date,last:bars.at(-1).endDate}};
 }
 assert.equal(Object.keys(index.prices).length,49);
 const bytes=JSON.stringify(index),url='/data/backtesting/h4-history-index.'+hash(bytes).slice(0,20)+'.json';fs.writeFileSync(path.join(site,url.slice(1)),bytes);
 manifest.backtestHistory={ready:true,provider:'Dukascopy',path:url,instruments:49,bars:Object.values(index.prices).reduce((n,p)=>n+p.h4.count,0)};
 saveManifest(site,manifest);return manifest.backtestHistory;
}
module.exports={build};if(require.main===module)console.log(JSON.stringify(build(process.argv[2],JSON.parse(fs.readFileSync(process.argv[3])))));
