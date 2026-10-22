// Explicit reconstruction of existing source-preserving D1 overlays. No SQL or network.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,'')),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const [input,mode='state']=process.argv.slice(2);assert.ok(input);
const seed=require('../market-history-seed.cjs'),ingest=require('../market-daily-ingest.cjs');
const root=path.resolve('artifacts/sql-recovery-market'),registry=seed.restore(root),entries=[...registry.entries,...ingest.supplementalEntries()];
if(mode==='state'){
 const plan=read(path.join(input,'plan.json')),results=[];
 for(const entry of entries){
  const req=plan.requests.find(r=>r.symbol===entry.providerSymbol&&r.interval==='1D');assert.ok(req,'No capture for '+entry.logicalSymbol);
  const candidates=['captures/boundary-refresh','captures/retries','captures'].map(d=>path.join(input,d,req.id+'.json')),capture=read(candidates.find(p=>fs.existsSync(p))),raw=JSON.parse(capture.rawText),observed=Date.parse(capture.observedAt);
  assert.ok(raw.success&&raw.symbol===entry.providerSymbol&&raw.interval==='1D'&&raw.format==='columns');
  const stateFile=path.join('data/market-state',entry.logicalSymbol+'.json'),state=read(stateFile),stored=ingest.loadSeries(root,entry,path.join(root,'daily-ingestion')),byTime=new Map(stored.rows.map(r=>[r.timestamp,r])),byDate=new Map(stored.rows.map(r=>[r.date,r.timestamp]));
  const backup=path.join('artifacts/sql-recovery-original-state',entry.logicalSymbol+'.json');fs.mkdirSync(path.dirname(backup),{recursive:true});if(!fs.existsSync(backup))fs.copyFileSync(stateFile,backup,fs.constants.COPYFILE_EXCL);
  const added=[],revisions=[],b=raw.bars;assert.equal(b.t.length,raw.count);
  for(let i=0;i<b.t.length;i++){
   const last=i===b.t.length-1;if(last&&!['NDX','SPX','LIVECATTLE'].includes(entry.logicalSymbol))continue;
   if(!last&&b.t[i+1]*1000>observed)continue;const bar={symbol:entry.logicalSymbol,provider:entry.provider,providerSymbol:entry.providerSymbol,sourceIdentity:entry.sourceIdentity,timeframe:'1D',timestamp:b.t[i],open:b.o[i],high:b.h[i],low:b.l[i],close:b.c[i],completed:true,status:'ok'};
   let documented=null;if(last){bar.date=new Date(bar.timestamp*1000).toISOString().slice(0,10);const cattle=entry.logicalSymbol==='LIVECATTLE',timezone=cattle?'America/Chicago':'America/New_York',sources=cattle?[{id:'session',url:'https://www.cmegroup.com/markets/agriculture/livestock/live-cattle/specs',finding:'Live Cattle regular Globex session Monday-Friday 08:30-13:05 CT; the conservative 17:00 CT completion window is later than this close.'},{id:'calendar',url:'https://www.cmegroup.com/tools-information/holiday-calendar.html',finding:'Product-specific holiday calendar; only an already observed prior-day regular-session D1 bar is considered, never a fabricated holiday candle.'}]:[{id:'session',url:'https://www.nasdaq.com/market-activity/stock-market-holiday-schedule',finding:'US regular cash session 09:30-16:00 ET; source response is regular-session only. Conservative completion window 18:00 ET is later than the close.'},{id:'close',url:'https://www.nasdaqtrader.com/trader.aspx?id=openclose',finding:'Nasdaq Closing Cross occurs at 16:00 ET. Observed prior-day regular-session bar is evaluated after the conservative completion window.'}];
    documented=ingest.auditCompletion(bar,observed,{schemaVersion:1,runs:[{checkedAt:capture.observedAt,sources,entries:[{symbol:bar.symbol,providerSymbol:bar.providerSymbol,timestamp:bar.timestamp,date:bar.date,completed:true,status:'ok',method:'documented_session_and_bar_timestamp',timezone,sourceIds:sources.map(s=>s.id),reason:'Original regular-session D1 bar from the previous session; its conservative documented close window elapsed before the actual provider capture.'}]}]});}
   const known=byTime.get(bar.timestamp),evidence=known||{completionEvidence:'Operator recovery: a later original provider D1 boundary was observed; exact exchange-calendar sessionEnd remains unverified.'};
   const normalized=ingest.validateBar(bar,entry,observed,Date.now(),['forex','metal'].includes(entry.assetClass)?known:evidence,documented);
   if(known){if(['open','high','low','close'].some(k=>known[k]!==normalized[k]))revisions.push({timestamp:bar.timestamp,kept:known,incoming:normalized,decision:'Retain previously admitted immutable value; revision preserved for explicit source review'});continue;}
   assert.ok(!byDate.has(normalized.date),'Recovery date collision '+entry.logicalSymbol);
   if(byTime.size&&normalized.timestamp<Math.max(...byTime.keys()))continue;
   const next={...normalized,...(b.v?{volume:b.v[i]}:{}),recovery:{sourceRawSha256:sha(capture.rawText),capturedAt:capture.observedAt,nextProviderTimestamp:b.t[i+1]??null,exchangeCalendarValidated:false},ingestion:{inputSha256:sha(capture.rawText),fetchedAt:capture.observedAt,runId:'operator-recovery-20261022'}};
   state.bars.push(next);byTime.set(next.timestamp,next);byDate.set(next.date,next.timestamp);added.push(next.date);
  }
  state.bars.sort((a,b)=>a.timestamp-b.timestamp);state.recovery={mode:'operator-recovery-20261022',originalSqlAuditRestored:false,sourceRawSha256:sha(capture.rawText),overlapRevisions:revisions};
  fs.writeFileSync(stateFile,JSON.stringify(state,null,2));
  // Working overlay is a generated copy of the explicitly updated committed baseline.
  fs.writeFileSync(path.join(root,'daily-ingestion',entry.logicalSymbol+'.json'),JSON.stringify(state,null,2));ingest.loadSeries(root,entry,path.join(root,'daily-ingestion'));
  results.push({symbol:entry.logicalSymbol,added:added.length,revisions:revisions.length,lastDate:stored.rows.at(-1)?.date,newLastDate:state.bars.at(-1)?.date});
 }
 fs.writeFileSync('artifacts/sql-recovery-d1-state.json',JSON.stringify({createdAt:new Date().toISOString(),results,originalSqlAuditRestored:false},null,2));console.log(JSON.stringify({series:results.length,added:results.reduce((n,r)=>n+r.added,0),results}));
}else if(mode==='bundle'){
 const prepared=require('../prepare-market-sources.cjs').prepare({root});console.log(JSON.stringify({bundle:prepared.bundlePath,entries:prepared.entries.length,failed:prepared.ingestion.failed}));
}else if(mode==='zones'){
 const plan=read(path.join(input,'plan.json')),allowed=new Set(['USDHKD','EURNOK','EURPLN','EURSEK','USDMXN','USDNOK','USDPLN','USDSEK','USDZAR','SGDJPY','USDSGD','XPTUSD'].map(s=>'OANDA:'+s));
 const dir=path.join(input,'zone-envelopes');fs.mkdirSync(dir,{recursive:true});let count=0;
 for(const req of plan.requests.filter(r=>allowed.has(r.symbol)&&['1D','4h'].includes(r.interval))){
  const candidate=['captures/boundary-refresh','captures/retries','captures'].map(d=>path.join(input,d,req.id+'.json')).find(p=>fs.existsSync(p));assert.ok(candidate);
  const capture=read(candidate),raw=JSON.parse(capture.rawText);assert.ok(raw.success&&raw.symbol===req.symbol&&raw.interval===req.interval);
  const envelope={schemaVersion:1,fetchedAt:capture.observedAt,captures:[{capturedAt:capture.observedAt,rawJson:capture.rawText}]};fs.writeFileSync(path.join(dir,req.id+'.json'),JSON.stringify(envelope));count++;
 }console.log(JSON.stringify({zoneEnvelopes:count,originalCaptureTimesPreserved:true}));
}else throw Error('Unknown prepare mode');
