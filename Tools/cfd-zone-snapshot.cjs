// Additive zone projection. Original daily/COT/seasonality history is never replaced.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const universe=require('../wwwroot/js/cfd-instruments.js'),candles=require('../wwwroot/js/market-candles.js'),h4=require('./h4-zone-live.cjs');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex'),read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const ny=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
function sessionDate(t){const d=ny.format(new Date(t*1000)).slice(0,10);return new Date(Date.parse(d)+86400000).toISOString().slice(0,10);}
function dailyComplete(s,t,next,at){
 if(s.startsWith('CRYPTO:'))return t%86400===0&&t+86400<=at/1000-60;
 const local=ny.format(new Date(t*1000)),date=local.slice(0,10),day=new Date(date).getUTCDay();
 if(t%3600!==0||local.slice(-2)!=='17'||[5,6].includes(day)||date.slice(5,7)==='12'&&date.slice(8)>='24'||date.slice(5,7)==='01'&&date.slice(8)<='02')return false;
 // OANDA weekday daily sessions do not cross a Sunday DST change.
 return t+86400<=at/1000-60&&(day===4||next===t+86400);
}
function allowed(s,tf){return ['1D','4h'].includes(tf)&&universe.extraFx.some(k=>s==='OANDA:'+k)||tf==='1D'&&(s==='OANDA:XPTUSD'||Object.keys(universe.crypto).some(k=>s==='CRYPTO:'+k));}
function validate(source){
 assert.equal(source.schemaVersion,1);assert.equal(source.source,'Azure SQL market_zones');assert.equal(source.rule,'zone-provider-boundary-v1');
 const receipts=new Map(),groups=new Map();
 for(const r of source.receipts){assert.equal(sha(r.payload),r.receiptId);assert.ok(!receipts.has(r.receiptId));const p=JSON.parse(r.payload),captures=new Map();assert.equal(p.schemaVersion,1);assert.ok(Math.abs(Date.parse(r.receivedAt)-Date.parse(p.fetchedAt))<=86400000,'Bootstrap/live capture freshness');
  for(const c of p.captures){const raw=JSON.parse(c.rawJson),s=raw.symbol,tf=raw.interval,b=raw.format==='rows'?Object.fromEntries(['t','o','h','l','c','v'].map(k=>[k,raw.bars.map(b=>b[k])])):raw.bars;assert.equal(raw.success,true);assert.ok(allowed(s,tf));assert.ok(['rows','columns'].includes(raw.format));for(const k of ['t','o','h','l','c','v'])assert.equal(b[k].length,raw.count);assert.ok(b.t.every((t,i)=>Number.isSafeInteger(t)&&(!i||t>b.t[i-1])));const at=Date.parse(c.capturedAt);assert.ok(Number.isFinite(at)&&at<=Date.parse(p.fetchedAt)+60000&&Math.abs(at-Date.parse(r.receivedAt))<=86400000);assert.ok(!captures.has(s+tf));captures.set(s+tf,{b,at});}receipts.set(r.receiptId,captures);
 }
 for(const row of source.rows){assert.ok(allowed(row.symbol,row.interval));const evidence=receipts.get(row.receiptId)?.get(row.symbol+row.interval);assert.ok(evidence);const b=evidence.b,i=b.t.indexOf(row.timestamp);assert.ok(i>=0);for(const [field,col]of Object.entries({open:'o',high:'h',low:'l',close:'c',volume:'v'}))assert.equal(row[field],b[col][i],'SQL/raw exact OHLCV');assert.ok(candles.valid({...row,date:'2000-01-01'})&&row.low>0&&(row.volume===null||Number.isFinite(row.volume)&&row.volume>=0));assert.ok(row.interval==='4h'?h4.complete(row.timestamp,b.t[i+1],evidence.at):dailyComplete(row.symbol,row.timestamp,b.t[i+1],evidence.at),'Unproven provider boundary');
  const id=row.symbol+row.interval;if(!groups.has(id))groups.set(id,[]);const rows=groups.get(id);assert.ok(!rows.some(r=>r.timestamp===row.timestamp));rows.push({...row});
 }
 for(const rows of groups.values())rows.sort((a,b)=>a.timestamp-b.timestamp);return groups;
}
function mapping(key,symbol){return {version:universe.version,tradingInstrument:key,priceKey:key,priceSeriesId:'zone-only:'+symbol,priceKind:'spot-or-cfd-reference',chartSource:{provider:'OANDA',symbol},cotSources:[],cotMode:'unavailable',scope:'research',status:'price-zone-only',executionKind:'spot-or-cfd',exposureFamily:universe.extraFx.includes(key)?'FX':'Platinum',proxyRelationship:'Zone-only provider series; no synthetic COT or seasonal mapping'};}
function addYahoo(snapshot,manifest,site,feeds){
 for(const [key,symbol]of Object.entries(universe.crypto)){
  try{const feed=read(path.join(feeds,key+'.json'));if(feed.error)throw Error(feed.error);const r=feed.payload.chart.result[0],q=r.indicators.quote[0];assert.equal(feed.symbol,symbol);assert.equal(feed.provider,'Yahoo Finance');assert.equal(r.meta.symbol,symbol);assert.ok(r.meta.exchangeTimezoneName);
   const raw=r.timestamp.map((t,i)=>({timestamp:t,date:new Date(t*1000).toISOString().slice(0,10),open:q.open[i],high:q.high[i],low:q.low[i],close:q.close[i],volume:q.volume?.[i]??null}));
   const bars=raw.filter(b=>b.date<snapshot.asOf&&(b.timestamp+86400)*1000<=Date.parse(feed.observedAt)&&candles.valid(b));assert.ok(bars.length>=100);assert.equal(new Set(bars.map(b=>b.date)).size,bars.length);assert.ok(Date.parse(snapshot.asOf)-Date.parse(bars.at(-1).date)<=7*86400000);
   const a=manifest.assets.find(a=>a.key===key);assert.ok(a?.prices?.path);const closes=new Map(read(path.join(site,a.prices.path.slice(1))).prices),common=bars.slice(-30).filter(b=>closes.has(b.date)).at(-1);assert.ok(common&&Math.abs(common.close/closes.get(common.date)-1)<=.005,'Yahoo OHLC/seasonality close identity');
   const latest=bars.at(-1);snapshot.prices[key]={status:'ready',provider:'Yahoo Finance',symbol,timezone:'UTC',observedAt:feed.observedAt,priceType:'Yahoo crypto spot reference (not broker CFD execution)',latestDate:latest.date,latestClose:latest.close,bars:bars.slice(-400),weekly:candles.weekly(bars,snapshot.asOf).slice(-104),review:'Crypto spot reference; broker spreads/prices may differ'};
   if(!snapshot.assets.some(a=>a.key===key))snapshot.assets.push({key,name:key,mapping:{...mapping(key,symbol),chartSource:{provider:'Yahoo Finance',symbol},priceKind:'crypto-spot',exposureFamily:'Crypto'}});
  }catch(e){snapshot.prices[key]={status:'unavailable',bars:[],weekly:[],error:'Yahoo crypto: '+e.message};}
 }
}
function overlay(site,source,feeds){
 const groups=validate(source),manifest=read(path.join(site,'data/manifest.json')),snapshot=read(path.join(site,manifest.zonePrices.path.slice(1)));
 for(const code of [...universe.extraFx,'XPTUSD']){
  const key=code==='XPTUSD'?'PLATINUM':code,symbol='OANDA:'+code,rows=groups.get(symbol+'1D')||[],bars=rows.map(b=>({...b,date:sessionDate(b.timestamp)})).filter(b=>b.date<snapshot.asOf),latest=bars.at(-1);let p;
  if(bars.length<100||Date.parse(snapshot.asOf)-Date.parse(latest.date)>7*86400000)p={status:'unavailable',bars:[],weekly:[],error:'Chybí alespoň 100 aktuálních, ověřených D1 svíček rozšířeného zdroje'};
  else{assert.equal(new Set(bars.map(b=>b.date)).size,bars.length);p={status:'ready',provider:'OANDA',symbol,timezone:'America/New_York',observedAt:source.builtAt,sourceIdentity:'zone-only:'+symbol,contextCompatible:false,priceType:'Spot/CFD reference, provider-boundary validated; not broker execution',revisionPolicy:'Immutable raw SQL receipts, exact OHLC conflicts fail closed; volume revisions audited',latestDate:latest.date,latestClose:latest.close,bars:bars.slice(-400),weekly:candles.weekly(bars,snapshot.asOf).slice(-104),review:'New zone-only series; seasonality and full-pair COT not validated'};
   const h=groups.get(symbol+'4h')||[];if(h.length>=100){const last=h.at(-1);p.h4={status:'ready',provider:'OANDA',symbol,timeframe:'H4',timezone:'UTC',sessionTimezone:'America/New_York',observedAt:source.builtAt,asOfUtc:source.builtAt,validation:source.rule,contextCompatible:false,validatedBarCount:h.length,excludedBarCount:null,latestDate:new Date(last.timestamp*1000).toISOString(),latestClose:last.close,bars:h.map(b=>({...b,date:new Date(b.timestamp*1000).toISOString(),endDate:new Date((b.timestamp+14400)*1000).toISOString()})),weekly:[],note:'Provider-boundary evidence only; no full exchange calendar or D1 parity certification'};}
  }
  assert.ok(!snapshot.prices[key]||snapshot.prices[key].sourceIdentity==='zone-only:'+symbol,'Refusing canonical price overwrite');snapshot.prices[key]=p;
  if(!snapshot.assets.some(a=>a.key===key))snapshot.assets.push({key,name:code,mapping:mapping(key,symbol)});
 }
 if(feeds)addYahoo(snapshot,manifest,site,feeds);
 snapshot.cfdCoverage={version:universe.version,requested:universe.keys,source:'Azure SQL market_zones + existing provider identities',crypto:'Yahoo; TradingView comparison never enters zones',builtAt:source.builtAt,shadowCryptoRows:source.rows.filter(r=>r.symbol.startsWith('CRYPTO:')).length};
 const json=JSON.stringify(snapshot),url='/data/screener/zone-prices.'+sha(json).slice(0,20)+'.json';fs.writeFileSync(path.join(site,url.slice(1)),json);manifest.zonePrices={...manifest.zonePrices,path:url,cfdCoverage:snapshot.cfdCoverage};require('./apply-market-sources.cjs').saveManifest(site,manifest);
 return {requested:universe.keys.length,ready:universe.keys.filter(k=>snapshot.prices[k]?.status==='ready').length,missing:universe.keys.filter(k=>snapshot.prices[k]?.status!=='ready'),newFxH4:universe.extraFx.filter(k=>snapshot.prices[k]?.h4?.status==='ready').length};
}
module.exports={validate,dailyComplete,allowed,overlay,addYahoo};
if(require.main===module)try{console.log(JSON.stringify(overlay(path.resolve(process.argv[2]),read(process.argv[3]),process.argv[4])));}catch(e){console.error(e.message);process.exitCode=1;}
