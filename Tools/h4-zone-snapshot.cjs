// H4 is a zone-only SQL sidecar. Never changes D1 dates, seasonality or COT.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const symbolOrder=(a,b)=>a.symbol<b.symbol?-1:a.symbol>b.symbol?1:0;
function assertEvidenceMatches(stored,computed){const ordered=r=>({...r,instruments:[...r.instruments].sort(symbolOrder)});assert.deepEqual(ordered(stored),ordered(computed),'SQL eligibility evidence/D1 parity changed');}
const ny=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
function sessionDate(t){const local=ny.format(new Date(t*1000)),date=new Date(local.slice(0,10)+'T00:00:00Z');if(Number(local.slice(-2))>=17)date.setUTCDate(date.getUTCDate()+1);return date.toISOString().slice(0,10);}
function validateGroup(rows,daily,capturedAt){
 if(!daily)return 'missing-accepted-D1';
 if(typeof daily.completionEvidence!=='string'||!daily.completionEvidence||daily.timestamp%3600!==0||ny.format(new Date(daily.timestamp*1000)).slice(-2)!=='17')return 'D1-session-evidence-missing';
 if(rows.length!==6||rows.some((b,i)=>b.timestamp!==daily.timestamp+i*14400))return 'incomplete-NY17-session';
 if(rows.at(-1).timestamp+14400>capturedAt)return 'session-not-elapsed';
 if(rows[0].open!==daily.open||rows.at(-1).close!==daily.close||Math.max(...rows.map(b=>b.high))!==daily.high||Math.min(...rows.map(b=>b.low))!==daily.low)return 'D1-OHLC-mismatch';
 return null;
}
function validate(source,repository='.'){
 assert.equal(source.schemaVersion,1);assert.equal(source.source,'Azure SQL market_h4');assert.match(source.batchId,/^[a-f0-9]{64}$/);
 const seedBytes=fs.readFileSync(path.join(repository,'data/market-history/tradingview-backfill-36-v1.json.gz'));
 assert.equal(sha(seedBytes),fs.readFileSync(path.join(repository,'data/market-history/tradingview-backfill-36-v1.json.gz.sha256'),'utf8').trim());
 const seed=JSON.parse(zlib.gunzipSync(seedBytes)),registry=JSON.parse(seed.files['test-source-registry.json']),fx=registry.entries.filter(e=>e.assetClass==='forex');
 assert.equal(fx.length,28);assert.equal(source.captures.length,28);
 const prices={},instruments=[],seen=new Set();
 for(const capture of [...source.captures].sort(symbolOrder)){
  const key=capture.symbol.replace(/^OANDA:/,''),entry=fx.find(e=>e.logicalSymbol===key);assert.ok(entry&&!seen.has(key));seen.add(key);
  assert.equal(sha(Buffer.from(capture.rawText,'utf8')),capture.rawSha256);
  const raw=JSON.parse(capture.rawText),b=raw.bars;assert.equal(raw.success,true);assert.equal(raw.symbol,entry.providerSymbol);assert.equal(raw.interval,'4h');assert.equal(raw.format,'columns');
  const captured=Date.parse(capture.capturedAt)/1000;assert.ok(Number.isFinite(captured));
  assert.equal(raw.count,b.t.length);for(const k of ['o','h','l','c','v'])assert.equal(b[k].length,b.t.length);
  const original=JSON.parse(seed.files[entry.seasonalitySource]),overlay=read(path.join(repository,'data/market-state',key+'.json'));
  assert.equal(original.id,entry.canonicalTestId);assert.equal(overlay.id,original.id);assert.equal(overlay.historicalSha256,sha(seed.files[entry.seasonalitySource]));
  const daily=new Map(original.bars.map(d=>[d.date,d]));for(const d of overlay.bars){if(daily.has(d.date))for(const k of ['timestamp','open','high','low','close'])assert.equal(daily.get(d.date)[k],d[k]);daily.set(d.date,d);}
  const groups=new Map();let previous=0;
  for(let i=0;i<b.t.length;i++){
   const row={timestamp:b.t[i],date:new Date(b.t[i]*1000).toISOString(),endDate:new Date((b.t[i]+14400)*1000).toISOString(),open:b.o[i],high:b.h[i],low:b.l[i],close:b.c[i],volume:b.v[i],sessionDate:sessionDate(b.t[i])};
   assert.ok(Number.isSafeInteger(row.timestamp)&&row.timestamp>previous);previous=row.timestamp;
   assert.ok(['open','high','low','close'].every(k=>Number.isFinite(row[k])&&row[k]>0));assert.ok(row.low<=Math.min(row.open,row.close)&&row.high>=Math.max(row.open,row.close));
   if(!groups.has(row.sessionDate))groups.set(row.sessionDate,[]);groups.get(row.sessionDate).push(row);
  }
  const accepted=[],rejected=[],witness=[];
  for(const [date,rows]of groups){const d=daily.get(date),reason=validateGroup(rows,d,captured);if(reason)rejected.push({sessionDate:date,reason,timestamps:rows.map(b=>b.timestamp)});else{accepted.push(...rows);witness.push([d.timestamp,d.open,d.high,d.low,d.close]);}}
  const evidence={symbol:capture.symbol,rawSha256:capture.rawSha256,d1Identity:original.id,d1ParitySha256:sha(JSON.stringify(witness)),accepted:accepted.length,rejected:rejected.reduce((n,g)=>n+g.timestamps.length,0),rejectedSessions:rejected};
  instruments.push(evidence);
  const latest=accepted.at(-1);assert.ok(latest,'No validated H4 history for '+key);
  prices[key]={status:'ready',provider:'OANDA',symbol:capture.symbol,timeframe:'H4',timezone:'UTC',sessionTimezone:'America/New_York',observedAt:capture.capturedAt,asOfUtc:capture.capturedAt,
   validation:'h4-d1-parity-v1',sourceBatchId:source.batchId,rawSha256:capture.rawSha256,latestDate:latest.date,latestClose:latest.close,
   bars:accepted.slice(-2200),weekly:[],validatedBarCount:accepted.length,excludedBarCount:evidence.rejected,
   dailyLifecycleBars:[...daily.values()].filter(d=>d.timestamp+86400<=captured&&d.timestamp>=accepted[0].timestamp).sort((a,b)=>a.timestamp-b.timestamp).slice(-400).map(d=>({date:new Date(d.timestamp*1000).toISOString(),endDate:new Date((d.timestamp+86400)*1000).toISOString(),open:d.open,high:d.high,low:d.low,close:d.close})),
   note:'Historical H4 snapshot; six elapsed 4h slots match the accepted OANDA NY17 D1 OHLC exactly. No missing bars synthesized. Provider volume is not centralized FX volume.'};
 }
 const report={schemaVersion:1,ruleVersion:'h4-d1-parity-v1',batchId:source.batchId,accepted:instruments.reduce((n,x)=>n+x.accepted,0),rejected:instruments.reduce((n,x)=>n+x.rejected,0),instruments};
 return {report,prices};
}
function overlay(site,source,repository='.'){
 const checked=validate(source,repository);assert.ok(source.zoneValidationText,'SQL zone eligibility evidence missing');assert.equal(sha(source.zoneValidationText),source.zoneValidationSha256);assertEvidenceMatches(JSON.parse(source.zoneValidationText),checked.report);
 const manifest=read(path.join(site,'data/manifest.json')),snapshot=read(path.join(site,manifest.zonePrices.path.slice(1)));
 for(const [key,h4]of Object.entries(checked.prices)){const p=snapshot.prices[key];assert.ok(p?.status==='ready'&&p.symbol===h4.symbol&&p.provider==='OANDA','H4/D1 provider mismatch');p.h4=h4;}
 snapshot.h4={schemaVersion:1,source:'Azure SQL market_h4',batchId:source.batchId,validationRule:checked.report.ruleVersion,validationSha256:source.zoneValidationSha256,accepted:checked.report.accepted,rejected:checked.report.rejected,scope:'Obchodní zóny only; no seasonality/COT input'};
 const json=JSON.stringify(snapshot),url='/data/screener/zone-prices.'+sha(json).slice(0,20)+'.json';fs.writeFileSync(path.join(site,url.slice(1)),json);
 manifest.zonePrices={...manifest.zonePrices,path:url,h4:snapshot.h4};require('./apply-market-sources.cjs').saveManifest(site,manifest);
 return snapshot.h4;
}
module.exports={sessionDate,validateGroup,validate,overlay,assertEvidenceMatches};
if(require.main===module){try{const [mode,input,output]=process.argv.slice(2),source=read(input);if(mode==='validate'){const {report}=validate(source);fs.writeFileSync(output,JSON.stringify(report));console.log(JSON.stringify({accepted:report.accepted,rejected:report.rejected,sha256:sha(JSON.stringify(report))}));}else if(mode==='overlay')console.log(JSON.stringify(overlay(output,source)));else throw Error('Expected validate/overlay <SQL-source> <output>');}catch(e){console.error(e.message);process.exitCode=1;}}
