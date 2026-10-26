// Private artifact projection; this tool never uploads data or connects to SQL.
// Full history is separate from capped live-zone inputs and prospective ledgers.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const historical=require('./h4-zone-snapshot.cjs'),incremental=require('./h4-zone-live.cjs'),extra=require('./cfd-zone-snapshot.cjs'),universe=require('../wwwroot/js/cfd-instruments.js');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex'),read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
function build(site,original,additional){
 site=path.resolve(site);assert.ok(site.startsWith(path.resolve('artifacts')+path.sep),'Use a private artifacts staging directory');
 const checked=historical.validate(original,'.',{fullHistory:true});assert.ok(original.zoneValidationText);assert.equal(sha(original.zoneValidationText),original.zoneValidationSha256);historical.assertEvidenceMatches(JSON.parse(original.zoneValidationText),checked.report);
 incremental.merge(checked.prices,original.live,{fullHistory:true});const grouped=extra.validate(additional);
 const prices={...checked.prices};for(const key of universe.extraFx){const symbol='OANDA:'+key,rows=grouped.get(symbol+'4h');assert.ok(rows?.length>=200,'Missing full history '+key);prices[key]={status:'ready',provider:'OANDA',symbol,timeframe:'H4',timezone:'UTC',asOfUtc:additional.builtAt,validation:additional.rule,bars:rows.map(r=>({...r,date:new Date(r.timestamp*1000).toISOString(),endDate:new Date((r.timestamp+14400)*1000).toISOString()}))};}
 assert.equal(Object.keys(prices).length,39);const folder=path.join(site,'data/backtesting');fs.mkdirSync(folder,{recursive:true});
 const index={schemaVersion:1,kind:'backtest-history-v1',asOf:additional.builtAt,prices:{},note:'Complete stored validated H4 per symbol, independent of the 2200-bar live projection. Holiday/calendar exclusions remain visible gaps. Existing SQL OHLCV take precedence over revised provider observations.'};
 for(const [key,h]of Object.entries(prices).sort(([a],[b])=>a.localeCompare(b))){const bars=h.bars.map(b=>({timestamp:b.timestamp,date:b.date,endDate:b.endDate,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume})),last=bars.at(-1);assert.ok(bars.length>=200);assert.equal(new Set(bars.map(b=>b.timestamp)).size,bars.length);
  const price={status:'ready',provider:'OANDA',symbol:h.symbol,timeframe:'H4',timezone:'UTC',sessionTimezone:'America/New_York',validation:h.validation,asOfUtc:h.asOfUtc,latestDate:last.date,latestClose:last.close,bars,weekly:[]};
  const json=JSON.stringify(price),hash=sha(json),url='/data/backtesting/h4-'+key+'.'+hash.slice(0,20)+'.json';fs.writeFileSync(path.join(site,url.slice(1)),json);
  index.prices[key]={h4:{status:'ready',provider:'OANDA',symbol:h.symbol,historyPath:url,sha256:hash,count:bars.length,first:bars[0].date,last:last.endDate}};
 }
 const json=JSON.stringify(index),hash=sha(json),url='/data/backtesting/h4-history-index.'+hash.slice(0,20)+'.json';fs.writeFileSync(path.join(site,url.slice(1)),json);
 const manifest=read(path.join(site,'data/manifest.json'));manifest.backtestHistory={ready:true,path:url,instruments:39,bars:Object.values(index.prices).reduce((n,p)=>n+p.h4.count,0)};require('./apply-market-sources.cjs').saveManifest(site,manifest);
 return manifest.backtestHistory;
}
module.exports={build};if(require.main===module)console.log(JSON.stringify(build(process.argv[2],read(process.argv[3]),read(process.argv[4]))));
