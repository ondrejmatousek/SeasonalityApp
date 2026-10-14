// Materializes a single audited market routing bundle. No SQL or provider requests.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {ingest,loadSeries,supplementalEntries}=require('./market-daily-ingest.cjs');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8')),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const appKey=k=>k==='XAGUSD'?'SILVER':k;
function prepare({root='artifacts/tradingview-backfill-36-v1',input='data/market-daily/latest.json',dailySource=null}={}) {
 root=path.resolve(root);const registry=read(path.join(root,'test-source-registry.json'));
 const ingestion=ingest({root,input,includeReview:true});
 const dir=path.join(root,'analytics-sources-v1');fs.mkdirSync(dir,{recursive:true});
 const entries=[];
 for(const e of registry.entries){
  try {
   const stored=loadSeries(root,e,path.join(root,'daily-ingestion')),all=stored.rows;
   // Keep raw evidence untouched. Sparse prehistory isn't presented as daily OHLC.
   const minYear=e.assetClass==='metal'?Math.max(1970,e.firstCompleteYearWithNoFlatOhlc||1970):null;
   const bars=minYear?all.filter(b=>Number(b.date.slice(0,4))>=minYear):all;
   const htfStart=e.logicalSymbol==='SPX'?`${Math.max(1962,e.firstCompleteYearWithNoFlatOhlc||1962)}-01-01`:minYear?`${minYear}-01-01`:null;
   const source={schemaVersion:1,assetKey:appKey(e.logicalSymbol),logicalSymbol:e.logicalSymbol,id:e.canonicalTestId,provider:e.provider,providerSymbol:e.providerSymbol,sourceIdentity:e.sourceIdentity,
    timeframe:'1D',assetClass:e.assetClass,instrumentKind:e.instrumentKind,status:e.status,review:e.status!=='canonical-test-candidate',
    historicalSource:e.seasonalitySource,dailySource:dailySource||'data/market-daily/latest.json',overlaySource:`daily-ingestion/${e.logicalSymbol}.json`,
    historicalSha256:sha(fs.readFileSync(path.join(root,e.seasonalitySource))),ingestionRunId:ingestion.runId,
    dailyStatus:ingestion.instruments.find(x=>x.symbol===e.logicalSymbol)?.reason||'unchanged or updated',
    seasonalityFrom:minYear?`${minYear}-01-01`:null,htfFrom:htfStart,
    timezone:e.provider==='OANDA'?'America/New_York':e.logicalSymbol==='BRENT'?'Europe/London':'America/New_York',
    sessionContract:e.provider==='OANDA'?'NY17 start/end; exceptional metal cutoffs retain review':'Provider D1 timestamps; exchange completion evidence required for new bars',
    dateContract:e.provider==='OANDA'?'NY17 session end date':'Provider timestamp UTC date, matching backfill (not assumed session end)',
    bars,htfBars:bars.filter(b=>!htfStart||b.date>=htfStart),prices:bars.map(b=>[b.date,b.close])};
   const body=JSON.stringify(source),file=`${e.logicalSymbol}.${sha(body).slice(0,20)}.json`;
   if(!fs.existsSync(path.join(dir,file)))fs.writeFileSync(path.join(dir,file),body,{flag:'wx'});
   const {bars:_,htfBars:__,prices:___,...meta}=source;entries.push({...meta,file,count:bars.length,lastDate:bars.at(-1)?.date});
  }catch(err){entries.push({assetKey:appKey(e.logicalSymbol),logicalSymbol:e.logicalSymbol,provider:e.provider,providerSymbol:e.providerSymbol,sourceIdentity:e.sourceIdentity,id:e.canonicalTestId,status:'unavailable',error:err.message,count:0});}
 }
 // Immutable supplemental histories share the append-only overlay, never the original seed.
 const supplement='data/commodity-research/source-registry.json';
 if(fs.existsSync(supplement)){
  const extra=read(supplement);if(extra.schemaVersion!==1||extra.version!=='commodity-research-v1')throw Error('Unknown research commodity registry');
  for(const item of extra.entries){
   if(entries.some(e=>e.assetKey===item.assetKey))throw Error('Duplicate market source '+item.assetKey);
   const f=path.resolve(path.dirname(supplement),item.file);if(!f.startsWith(path.resolve(path.dirname(supplement))+path.sep))throw Error('Unsafe commodity source');
   const bytes=fs.readFileSync(f);if(sha(bytes)!==item.sha256)throw Error('Research source hash mismatch '+item.assetKey);
   const source=JSON.parse(bytes);for(const k of ['id','assetKey','provider','providerSymbol'])if(source[k]!==item[k])throw Error('Research source identity mismatch');
   const e=supplementalEntries().find(e=>e.logicalSymbol===item.assetKey),stored=loadSeries(root,e,path.join(root,'daily-ingestion'));
   const results=ingestion.instruments.filter(r=>r.symbol===item.assetKey),failed=results.some(r=>r.failed);
   source.bars=stored.rows;source.prices=stored.rows.filter(b=>b.date>=source.seasonalityFrom).map(b=>[b.date,b.close]);
   source.dailySource=dailySource||(results.length?(results.at(-1).input||input):'Awaiting first validated daily JSON');
   source.dailyStatus=failed?'daily-error':results.length?'daily-connected':'awaiting-daily';
   source.overlaySource=`daily-ingestion/${item.assetKey}.json`;
   source.reason='Research only / unsupported for validated ranking. Continuous roll gaps may affect seasonality; no contract-aware reconstruction.';
   const body=JSON.stringify(source),file=`${item.assetKey}.${sha(body).slice(0,20)}.json`;if(!fs.existsSync(path.join(dir,file)))fs.writeFileSync(path.join(dir,file),body,{flag:'wx'});
   const {bars:_,htfBars:__,prices:___,rejected:____,...meta}=source;entries.push({...meta,file,count:source.prices.length,lastDate:source.prices.at(-1)?.[0]});
  }
 }
 const bundle={schemaVersion:1,version:'asset-class-price-routing-v1',builtAt:new Date().toISOString(),ingestion,entries};
 const temp=path.join(dir,'manifest.'+crypto.randomUUID()+'.tmp');fs.writeFileSync(temp,JSON.stringify(bundle,null,2));fs.renameSync(temp,path.join(dir,'manifest.json'));
 return {bundlePath:path.join(dir,'manifest.json'),...bundle};
}
module.exports={prepare,appKey};
if(require.main===module){try{const value=(k,d)=>process.argv.find(a=>a.startsWith(k+'='))?.slice(k.length+1)||d;const r=prepare({root:value('--root','artifacts/tradingview-backfill-36-v1'),input:value('--input','data/market-daily/latest.json')});console.log(JSON.stringify({bundle:r.bundlePath,inserted:r.ingestion.inserted,duplicates:r.ingestion.skipped,failed:r.ingestion.failed,sources:r.entries.length,unavailable:r.entries.filter(e=>e.status==='unavailable')},null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
