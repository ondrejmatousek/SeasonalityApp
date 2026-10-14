// Manual, private test ingestion. Immutable backfill + append-only daily overlay;
// no SQL, production routing, analytics rebuild, network or scheduling.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const ny = new Intl.DateTimeFormat('sv-SE', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
const isoDate = t => new Date(t).toISOString().slice(0,10);
function check(ok, reason) { if (!ok) throw Error(reason); }
function instant(s) { check(typeof s==='string' && /Z$|[+-]\d\d:\d\d$/.test(s) && Number.isFinite(Date.parse(s)), 'invalid ISO timestamp'); return Date.parse(s); }
function safeFile(root, relative) {
  const f = path.resolve(root, relative);
  check(f.startsWith(path.resolve(root)+path.sep), 'path outside test root');
  const actual = fs.realpathSync(f);
  check(actual.startsWith(fs.realpathSync(root)+path.sep), 'symlink outside test root');
  return actual;
}
function atomic(file, value) {
  const tmp=file+'.'+crypto.randomUUID()+'.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value,null,2), {flag:'wx'});
  try { fs.renameSync(tmp,file); } finally { if(fs.existsSync(tmp))fs.unlinkSync(tmp); }
}
function auditCompletion(b, observed, audit) {
  check(audit?.schemaVersion===1 && Array.isArray(audit.runs), 'completion audit unavailable');
  const runs=audit.runs.filter(r=>instant(r.checkedAt)===observed);
  check(runs.length===1, 'completion audit collection timestamp mismatch');
  const run=runs[0], entries=run.entries.filter(x=>x.providerSymbol===b.providerSymbol && x.timestamp===b.timestamp);
  check(entries.length===1, 'completion audit bar missing/ambiguous');
  const raw=entries[0];
  // Work's extension audit has selectedDate/completionMethod/sourceEvidence.
  // The *_with_existing_validated_history method must NEVER authorize a new bar.
  const a=raw.completionMethod ? {...raw,date:raw.selectedDate,method:raw.completionMethod,reason:raw.completionEvidence} : raw;
  check(a.symbol===b.symbol && a.date===b.date && a.completed===true && a.status==='ok' && !a.error && !a.errorType,
    'completion audit identity/date/status mismatch');
  check(a.method==='documented_session_and_bar_timestamp' && typeof a.reason==='string' && a.reason.length>20,
    'completion audit method/reason missing');
  const sources=raw.completionMethod ? (raw.sourceEvidence||[]).filter(s=>/^https:\/\//.test(s.url||'') && typeof s.finding==='string' && s.finding.length>0) : (a.sourceIds||[]).map(id=>run.sources?.find(s=>s.id===id));
  check(sources.length>=2 && sources.every(s=>s && /^https:\/\//.test(s.url) && s.finding) && new Set(sources.map(s=>s.url)).size>=2,
    'completion audit documented session/calendar sources missing');
  if(raw.completionMethod){
    check(raw.provider===b.provider && (!b.id||raw.canonicalIdentity===b.id),'completion audit provider/canonical identity mismatch');
    check(raw.rawResponse?.success===true && raw.rawResponse.symbol===b.providerSymbol && raw.rawResponse.interval==='1D','completion audit raw provider evidence missing');
    const matches=raw.rawResponse.bars?.filter(x=>x.t===b.timestamp)||[];
    check(matches.length===1 && ['open','high','low','close'].every(k=>matches[0][{open:'o',high:'h',low:'l',close:'c'}[k]]===b[k]),'completion audit raw OHLC mismatch');
  }
  // Conservative acceptance window, NOT a fabricated provider time_close.
  const policy=b.providerSymbol==='NASDAQ:NDX'||b.providerSymbol==='SP:SPX'
    ? {zone:'America/New_York',time:'18:00:00'}
    : b.providerSymbol==='ICEEUR:BRN1!' ? {zone:'Europe/London',time:'23:00:00'}
    : ['NYMEX:CL1!','NYMEX:NG1!','COMEX:HG1!','CBOT:ZW1!','CBOT:ZS1!','CME:LE1!'].includes(b.providerSymbol)
      ? {zone:'America/Chicago',time:'17:00:00'} : null;
  check(policy && a.timezone===policy.zone, 'completion audit session not supported');
  const local=new Intl.DateTimeFormat('sv-SE',{timeZone:policy.zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(observed));
  check(/^\d{4}-\d{2}-\d{2}$/.test(b.date||'') && local>=b.date+' '+policy.time, 'documented session completion window has not elapsed');
  return {method:a.method,reason:a.reason,checkedAt:run.checkedAt,timezone:a.timezone,sources};
}
function validateBar(b, e, observed, now, knownCompletion=null, documentedCompletion=null) {
  check(b && typeof b==='object', 'invalid bar');
  if(b.status!==undefined)check(b.status==='ok','provider bar status not ok');
  check(b.symbol===e.logicalSymbol, 'unknown/logical symbol mismatch');
  for(const k of ['provider','providerSymbol','sourceIdentity']) check(b[k]===e[k], k+' mismatch / provider splice prohibited');
  for(const k of ['id','canonicalIdentity'])if(b[k]!==undefined)check(b[k]===e.canonicalTestId,'canonical identity mismatch');
  check(b.timeframe==='1D', 'timeframe must be 1D');
  check(Number.isSafeInteger(b.timestamp) && Number.isFinite(new Date(b.timestamp*1000).getTime()), 'timestamp must be Unix seconds');
  check(b.timestamp*1000<=observed && b.timestamp*1000<=now, 'future bar timestamp');
  check(['open','high','low','close'].every(k=>typeof b[k]==='number' && Number.isFinite(b[k]) && b[k]!==0), 'nonfinite/zero OHLC');
  check(b.low<=b.open && b.open<=b.high && b.low<=b.close && b.close<=b.high, 'strict OHLC bounds');
  if(e.assetClass!=='commodity')check(['open','high','low','close'].every(k=>b[k]>0), 'negative non-futures price');
  let end=b.sessionEnd?instant(b.sessionEnd):null;
  let completion='Daily producer declared completed sessionEnd';
  if(end===null && (e.assetClass==='forex'||e.assetClass==='metal') && b.status==='ok') {
    const start=ny.format(new Date(b.timestamp*1000)), target=isoDate(Date.parse(start.slice(0,10)+'T00:00:00Z')+86400000);
    for(const hour of [20,21,22,23]) {
      const candidate=Date.parse(target+'T'+hour+':00:00Z');
      if(ny.format(new Date(candidate))===target+' 17:00:00')end=candidate;
    }
    completion='Timestamp-derived NY17 session end, elapsed by fetchedAt; status ok';
  }
  if(end===null && documentedCompletion && b.completed===true && b.status==='ok') {
    completion='Documented session/calendar audit; exact provider sessionEnd unavailable';
  } else if(end===null && knownCompletion && b.status==='ok') {
    completion=knownCompletion.completionEvidence;
    check(typeof completion==='string' && completion.length>0, 'stored completion evidence missing');
  } else {
    check(b.completed===true || b.status==='ok', 'bar not marked completed/ok');
    check(end!==null && end>b.timestamp*1000 && end<=observed && end<=now, 'session incomplete or invalid sessionEnd; non-FX new bar needs explicit evidence');
  }
  check(b.completed!==false, 'bar marked unfinished');
  // Completion is explicit producer evidence, not guessed from the OHLC or today's date.
  const local=ny.format(new Date(b.timestamp*1000));
  let date=isoDate(b.timestamp*1000), label='provider timestamp UTC calendar date (session-end not verified)';
  if(e.assetClass==='forex'||e.assetClass==='metal') {
    date=isoDate(Date.parse(local.slice(0,10)+'T00:00:00Z')+86400000);
    const endLocal=ny.format(new Date(end));
    check(endLocal.slice(0,10)===date && endLocal.slice(-8)==='17:00:00', 'NY17 session end mismatch');
    if(e.assetClass==='forex')check(local.slice(-8)==='17:00:00', 'FX start not NY17');
    label=local.slice(-8)==='17:00:00'?'timestamp-derived NY17 session-end date':'NY local start calendar date +1; exceptional cutoff requires review';
  }
  if(b.date!==undefined) {
    check(typeof b.date==='string' && /^\d{4}-\d{2}-\d{2}$/.test(b.date) && isoDate(Date.parse(b.date))===b.date, 'invalid date label');
    if(e.assetClass==='forex'||e.assetClass==='metal'||e.assetClass==='index'||e.historicalRoot)check(b.date===date, 'date label inconsistent with timestamp/session');
  }
  return {timestamp:b.timestamp,providerTimestamp:new Date(b.timestamp*1000).toISOString(),providerUtcDate:isoDate(b.timestamp*1000),date,
    open:b.open,high:b.high,low:b.low,close:b.close,dateLabel:label,
    completionEvidence:completion,...(documentedCompletion?{documentedCompletion}:{}),...(end!==null?{sessionEnd:new Date(end).toISOString()}:{} )};
}
function equal(a,b) { return ['open','high','low','close'].every(k=>a[k]===b[k]); }
function historyFile(root,e) { return safeFile(e.historicalRoot||root,e.seasonalitySource); }
function supplementalEntries(directory='data/commodity-research') {
  if(!fs.existsSync(path.join(directory,'source-registry.json')))return [];
  const registry=read(path.join(directory,'source-registry.json'));
  check(registry.schemaVersion===1 && registry.version==='commodity-research-v1' && registry.entries.length===3,'unsupported commodity registry');
  const expected={WHEAT:['CBOT','CBOT:ZW1!'],LIVECATTLE:['CME','CME:LE1!'],SOYBEANS:['CBOT','CBOT:ZS1!']};
  const seen=new Set();
  return registry.entries.map(item=>{
    check(expected[item.assetKey] && !seen.has(item.assetKey),'unknown/duplicate commodity identity');seen.add(item.assetKey);
    const bytes=fs.readFileSync(safeFile(directory,item.file));check(sha(bytes)===item.sha256,'commodity historical checksum mismatch');
    const s=JSON.parse(bytes);
    check(item.provider===expected[item.assetKey][0] && item.providerSymbol===expected[item.assetKey][1] && item.id===`commodity:${item.assetKey}:${item.providerSymbol}:tv-research:v1`,'commodity provider identity mismatch');
    for(const k of ['id','assetKey','provider','providerSymbol'])check(item[k]===s[k],'commodity source identity mismatch');
    check(s.sourceIdentity===item.provider+'_TRADINGVIEW_RESEARCH' && s.timeframe==='1D' && s.status==='research-only' && s.htfEnabled===false,'commodity research restrictions missing');
    return {...s,canonicalTestId:s.id,seasonalitySource:item.file,historicalRoot:path.resolve(directory),historicalSha256:item.sha256,productionActive:false,bars:undefined,prices:undefined,htfBars:undefined};
  });
}
function loadSeries(root,e,overlay) {
  const bytes=fs.readFileSync(historyFile(root,e)),historical=JSON.parse(bytes);
  if(e.historicalSha256)check(sha(bytes)===e.historicalSha256,'commodity historical checksum mismatch');
  check(historical.id===e.canonicalTestId && historical.logicalSymbol===e.logicalSymbol && (e.historicalRoot ? historical.status==='research-only' && historical.htfEnabled===false : historical.activationAllowed===false), 'historical identity/activation mismatch');
  for(const k of ['provider','providerSymbol','sourceIdentity'])check(historical[k]===e[k], 'historical '+k+' mismatch');
  const file=path.join(overlay,e.logicalSymbol+'.json');
  const daily=fs.existsSync(file)?read(file):null;
  if(daily) {
    check(daily.id===historical.id && daily.productionActive===false && daily.timeframe==='1D', 'daily identity/activation mismatch');
    for(const k of ['provider','providerSymbol','sourceIdentity'])check(daily[k]===e[k], 'daily '+k+' mismatch');
    check(daily.historicalSha256===sha(bytes), 'historical evidence changed since overlay creation');
  }
  const rows=[...historical.bars,...(daily?.bars||[])].sort((a,b)=>a.timestamp-b.timestamp);
  for(let i=1;i<rows.length;i++)check(rows[i].timestamp>rows[i-1].timestamp && rows[i].date!==rows[i-1].date, 'stored duplicate timestamp/date');
  return {historical,daily,file,rows};
}
function ingest({input='data/market-daily/latest.json',root='artifacts/tradingview-backfill-36-v1',includeReview=false,now=Date.now(),supplement='data/commodity-research',researchOnly=false,dryRun=false}={}) {
  root=path.resolve(root);
  const bytes=fs.readFileSync(input), payload=JSON.parse(bytes);
  check(payload.schemaVersion===1, 'unsupported schemaVersion');
  if(payload.timeframe!==undefined)check(payload.timeframe==='1D','payload timeframe must be 1D');
  if(payload.generatedAt && payload.fetchedAt)check(instant(payload.generatedAt)===instant(payload.fetchedAt),'conflicting envelope timestamps');
  const fetchedAt=payload.fetchedAt||payload.generatedAt;
  const observed=instant(fetchedAt);
  check(observed<=now, 'future generatedAt');
  check(Array.isArray(payload.bars), 'bars must be an array');
  const runDate=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(observed));
  const auditFile=path.join(path.dirname(input),'audit',runDate+'.json');
  const auditBytes=fs.existsSync(auditFile)?fs.readFileSync(auditFile):null;
  const audit=auditBytes?JSON.parse(auditBytes):null;
  const registry=read(path.join(root,'test-source-registry.json'));
  check(registry.version==='tv-backfill-36-test-v1' && registry.productionRoutingChanged===false, 'unsupported/active registry');
  const entries=new Map(registry.entries.map(e=>[e.logicalSymbol,e]));
  check(entries.size===36, 'expected 36 unique identities');
  for(const e of supplementalEntries(supplement)){check(!entries.has(e.logicalSymbol),'duplicate supplemental symbol');entries.set(e.logicalSymbol,e);}
  for(const e of entries.values())check(/^[A-Z0-9]+$/.test(e.logicalSymbol) && !e.productionActive, 'unsafe/active registry entry');
  const overlay=path.join(root,'daily-ingestion'), lock=path.join(overlay,'.lock');
  if(!dryRun)fs.mkdirSync(overlay,{recursive:true});
  if(fs.existsSync(overlay))check(fs.realpathSync(overlay).startsWith(fs.realpathSync(root)+path.sep),'overlay outside test root');
  if(dryRun)check(!fs.existsSync(lock),'ingestion writer active; preflight must be retried');
  else fs.mkdirSync(lock); // Exclusive manual writer; a stale lock fails closed, never auto-deleted.
  try {
    const report={schemaVersion:1,runId:crypto.randomUUID(),startedAt:new Date(now).toISOString(),input:path.resolve(input),inputSha256:sha(bytes),generatedAt:payload.generatedAt,
      mode:dryRun?'preflight-only':includeReview?'all-test-and-research':'24-clean-FX-plus-NDX',fetchedAt,productionChanged:false,providerSplice:false,inserted:0,plannedInsertions:0,skipped:0,failed:0,notEnabled:0,instruments:[]};
    const evidenceDir=path.join(overlay,'evidence');if(!dryRun)fs.mkdirSync(evidenceDir,{recursive:true});
    const evidenceFile=path.join(evidenceDir,report.inputSha256+'.json');
    if(fs.existsSync(evidenceFile))check(sha(fs.readFileSync(evidenceFile))===report.inputSha256,'raw evidence hash mismatch');
    else if(!dryRun)fs.writeFileSync(evidenceFile,bytes,{flag:'wx'});
    if(!dryRun)report.rawEvidence=path.relative(root,evidenceFile);
    if(auditBytes){const auditHash=sha(auditBytes),f=path.join(evidenceDir,auditHash+'.json');if(!dryRun&&!fs.existsSync(f))fs.writeFileSync(f,auditBytes,{flag:'wx'});report.completionAuditSha256=auditHash;}
    const groups=new Map();
    const aliases={NASDAQ100:'NDX',SP500:'SPX',NATURALGAS:'NATGAS'};
    for(const b of payload.bars){const inputSymbol=typeof b?.symbol==='string'?b.symbol:'<missing-symbol>',key=aliases[inputSymbol]||inputSymbol;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(b);}
    for(const [symbol, inputBars] of groups) {
      const r={symbol,received:inputBars.length,inserted:0,skipped:0,failed:0};report.instruments.push(r);
      try {
        const e=entries.get(symbol);check(e, 'symbol not in backfill registry');
        if(researchOnly)check(e.historicalRoot,'extension accepts only the three supplemental research instruments');
        // Validate even disabled instruments; accepting them requires an explicit test-only switch.
        const stored=loadSeries(root,e,overlay), byTime=new Map(stored.rows.map(b=>[b.timestamp,b])), byDate=new Map(stored.rows.map(b=>[b.date,b.timestamp]));
        const normalized=inputBars.map(b=> {
          // SP is the exact TradingView namespace for the existing S&P identity, not a different price provider.
          const provider=e.logicalSymbol==='SPX' && b.provider==='SP'?'S&P':b.provider;
          if(b.assetClass!==undefined)check(b.assetClass===({forex:'fx',metal:'metals',index:'index',commodity:'futures'}[e.assetClass]),'assetClass mismatch');
          const mapped={...b,symbol,provider,sourceIdentity:b.sourceIdentity===undefined?e.sourceIdentity:b.sourceIdentity};
          const documented=!b.sessionEnd && !byTime.has(b.timestamp) && !['forex','metal'].includes(e.assetClass)
            ? auditCompletion(b,observed,audit):null;
          const known=byTime.get(b.timestamp);
          return validateBar(mapped,e,observed,now,known && e.historicalRoot ? {...known,completionEvidence:known.completionEvidence||'Immutable accepted TradingView historical backfill; completed at capture'} : known,documented);
        });
        const seen=new Set();for(const b of normalized){check(!seen.has(b.timestamp),'duplicate timestamp in incoming instrument');seen.add(b.timestamp);}
        const enabled=e.status==='canonical-test-candidate';
        r.scope=enabled?'initial-test-candidate':symbol==='SPX'?'restricted-history-test':e.assetClass==='forex'?'conditional-test':'research-test';
        if(!enabled&&!includeReview){r.notEnabled=inputBars.length;r.reason='Supported but inactive in first test; use --include-review for test/research only';report.notEnabled+=r.notEnabled;continue;}
        const additions=[];
        for(const b of normalized.sort((a,b)=>a.timestamp-b.timestamp)) {
          const old=byTime.get(b.timestamp);
          if(old){check(equal(old,b), 'OHLC_CONFLICT timestamp='+b.timestamp+' existing='+JSON.stringify({open:old.open,high:old.high,low:old.low,close:old.close})+' incoming='+JSON.stringify({open:b.open,high:b.high,low:b.low,close:b.close}));r.skipped++;continue;}
          check(!byDate.has(b.date), 'date collision with another provider timestamp');
          check(!stored.historical.rejected.some(x=>x.bar?.t===b.timestamp), 'timestamp quarantined by historical strict audit');
          check(b.timestamp>stored.rows.at(-1).timestamp, 'new daily timestamp precedes/equal stored tail; historical hole repair not allowed');
          byTime.set(b.timestamp,b);byDate.set(b.date,b.timestamp);additions.push({...b,ingestion:{inputSha256:report.inputSha256,fetchedAt,runId:report.runId}});
        }
        r.canonicalTestId=e.canonicalTestId;r.beforeLastTimestamp=stored.rows.at(-1).timestamp;r.beforeLastDate=stored.rows.at(-1).date;
        if(additions.length) {
          const bars=[...(stored.daily?.bars||[]),...additions].sort((a,b)=>a.timestamp-b.timestamp);
          if(!dryRun)atomic(stored.file,{schemaVersion:1,id:e.canonicalTestId,logicalSymbol:symbol,provider:e.provider,providerSymbol:e.providerSymbol,sourceIdentity:e.sourceIdentity,timeframe:'1D',
            productionActive:false,scope:'test/research only',historicalSource:e.seasonalitySource,historicalSha256:sha(fs.readFileSync(historyFile(root,e))),
            htfPolicy:symbol==='SPX'?'Do not consume historical close-only data; HTF range not activated':'No HTF rebuild/activation',bars});
          if(dryRun)r.plannedInsertions=additions.length;
          else r.inserted=additions.length;
        }
        r.afterLastTimestamp=Math.max(r.beforeLastTimestamp,...normalized.map(b=>b.timestamp));r.afterLastDate=byTime.get(r.afterLastTimestamp).date;
        r.appendedAfterHistoricalTail=additions.length>0 && additions[0].timestamp>stored.historical.bars.at(-1).timestamp;
        report.inserted+=r.inserted;report.plannedInsertions+=r.plannedInsertions||0;report.skipped+=r.skipped;
      } catch(err) {
        // Transaction boundary is the entire instrument: no partial writes on a conflict.
        r.inserted=0;r.skipped=0;r.failed=inputBars.length;r.reason=err.message;report.failed+=r.failed;
      }
    }
    if(!dryRun){
      fs.mkdirSync(path.join(overlay,'runs'),{recursive:true});
      fs.writeFileSync(path.join(overlay,'runs',report.runId+'.json'),JSON.stringify(report,null,2),{flag:'wx'});
    }
    return report;
  } finally { if(!dryRun)fs.rmdirSync(lock); }
}
module.exports={ingest,validateBar,loadSeries,auditCompletion,supplementalEntries,historyFile};
if(require.main===module) {
  try { const args=process.argv.slice(2),value=(key,fallback)=>args.find(x=>x.startsWith(key+'='))?.slice(key.length+1)||fallback;
    const report=ingest({input:value('--input','data/market-daily/latest.json'),root:value('--root','artifacts/tradingview-backfill-36-v1'),includeReview:args.includes('--include-review')});
    console.log(JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;
  } catch(err){console.error(JSON.stringify({status:'INPUT_OR_REGISTRY_BLOCKED',inserted:0,skipped:0,failed:null,reason:err.message,productionChanged:false}));process.exitCode=1;}
}
