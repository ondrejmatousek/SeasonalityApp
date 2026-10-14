// Read-only admission check shared by a future receiver/worker and the existing pipeline.
// Uses the SAME session/history/conflict engine as daily ingestion; never commits its plan.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {ingest,auditCompletion}=require('./market-daily-ingest.cjs');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function check(ok,reason){if(!ok)throw Error(reason);}
function instant(value){
 check(typeof value==='string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)),'Invalid ISO timestamp');
 return Date.parse(value);
}
function load(file){
 const bytes=fs.readFileSync(file);check(bytes.length>0 && bytes.length<=262144,'Input exceeds 256 KiB');
 return {bytes,value:JSON.parse(bytes)};
}
function preflight({input='data/market-daily/latest.json',root='artifacts/tradingview-backfill-36-v1',supplement='data/commodity-research',now=Date.now()}={}){
 const daily=load(input),p=daily.value;
 check(p.schemaVersion===1 && p.timeframe==='1D','Unsupported collection schema/timeframe');
 const observed=instant(p.fetchedAt);
 check(observed<=now && now-observed<=86400000,'Collection is stale/future');
 if(p.generatedAt!==undefined)check(instant(p.generatedAt)===observed,'Conflicting envelope timestamps');
 const runDate=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(observed));
 check(p.runDate===runDate,'Collection runDate is not fetchedAt in Europe/Prague');
 check(Array.isArray(p.bars) && p.bars.length===39,'Require all 39 registered instruments');
 const auditFile=path.join(path.dirname(input),'audit',runDate+'.json'),audit=load(auditFile),a=audit.value;
 check(a.schemaVersion===1 && a.runDate===runDate && a.timezone==='Europe/Prague' && Array.isArray(a.runs),'Invalid collection audit');
 const runs=a.runs.filter(r=>instant(r.checkedAt)===observed);
 check(runs.length===1,'Exactly one audit run must match fetchedAt');
 const run=runs[0];check(Array.isArray(run.entries) && run.entries.length===39,'Require exactly 39 audit entries');
 const seen=new Set();
 for(const b of p.bars){
  check(typeof b.providerSymbol==='string' && !seen.has(b.providerSymbol),'Duplicate/missing providerSymbol');seen.add(b.providerSymbol);
  check(b.completed===true && b.status==='ok','Completed/ok declaration required');
  check(Number.isSafeInteger(b.timestamp) && b.timestamp>=0,'Invalid Unix timestamp');
  const entries=run.entries.filter(e=>e.providerSymbol===b.providerSymbol && e.timestamp===b.timestamp);
  check(entries.length===1,'Missing/ambiguous audit bar: '+b.providerSymbol);
  const e=entries[0];
  check(e.symbol===b.symbol && e.provider===b.provider && e.completed===true && e.status==='ok' && !e.error && !e.errorType,'Audit identity/status mismatch: '+b.providerSymbol);
  const date=e.selectedDate??e.date;
  check(date===b.date && (e.date===undefined||e.date===date),'Audit date mismatch: '+b.providerSymbol);
  if(e.canonicalIdentity!=null)check(e.canonicalIdentity===(b.id??b.canonicalIdentity),'Audit canonical identity mismatch');
  const method=e.completionMethod??e.method,reason=e.completionEvidence??e.reason;
  check(method==='documented_session_and_bar_timestamp' && typeof reason==='string' && reason.length>20,'Documented completion evidence required');
  // Source citations are retained and checked for consistency, NOT independently fetched or trusted as calendars.
  const sources=e.sourceEvidence??(e.sourceIds||[]).map(id=>run.sources?.find(s=>s.id===id));
  check(Array.isArray(sources) && sources.length>=2 && sources.every(s=>s && typeof s.finding==='string' && s.finding.trim().length>0 && (()=>{try{return new URL(s.url).protocol==='https:';}catch{return false;}})()) && new Set(sources.map(s=>s.url)).size>=2,'Session/calendar citations missing');
  const raw=e.rawResponse;
  check(raw?.success===true && raw.symbol===b.providerSymbol && raw.interval==='1D' && Array.isArray(raw.bars),'Raw provider evidence missing');
  const matching=raw.bars.filter(x=>x.t===b.timestamp);
  check(matching.length===1 && Object.entries({open:'o',high:'h',low:'l',close:'c'}).every(([k,v])=>matching[0][v]===b[k]),'Audit raw OHLC mismatch: '+b.providerSymbol);
  if(b.provider==='OANDA')check(e.timezone==='America/New_York','Audit NY17 timezone mismatch');
  else auditCompletion(b,observed,a);
 }
 const report=ingest({input,root,supplement,includeReview:true,now,dryRun:true});
 check(report.inputSha256===hash(daily.bytes) && report.completionAuditSha256===hash(audit.bytes),'Collection changed during preflight');
 check(hash(fs.readFileSync(input))===hash(daily.bytes) && hash(fs.readFileSync(auditFile))===hash(audit.bytes),'Collection changed during preflight');
 const failed=report.failed+report.notEnabled;
 return {...report,accepted:failed===0 && report.instruments.length===39,receivedBars:39,
  persisted:false,analyticsTriggered:false,completionEvidenceValidated:failed===0,calendarIndependentlyVerified:false,
  historyChecked:true,requiresCommitRevalidation:true,
  // No write capability is exposed here. A persisted worker must revalidate against its current state.
  validation:'Producer evidence/session boundaries and same-provider history checked; cited exchange calendars not fetched. No persistence/publication.'};
}
module.exports={preflight};
if(require.main===module){
 try{const value=(key,fallback)=>process.argv.find(x=>x.startsWith(key+'='))?.slice(key.length+1)||fallback;
  const r=preflight({input:value('--input','data/market-daily/latest.json'),root:value('--root','artifacts/tradingview-backfill-36-v1'),supplement:value('--supplement','data/commodity-research')});
  console.log(JSON.stringify(r,null,2));if(!r.accepted)process.exitCode=1;
 }catch(e){console.error(JSON.stringify({accepted:false,persisted:false,analyticsTriggered:false,reason:e.message}));process.exitCode=1;}
}
