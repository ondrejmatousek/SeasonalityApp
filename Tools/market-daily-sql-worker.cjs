// Private worker bridge, no network/SQL credentials. All paths/time are supplied by the server worker.
// Existing seed restore + preflight + ingestion, applied ONLY to a fresh isolated work directory.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {restore}=require('./market-history-seed.cjs');
const {preflight}=require('./market-daily-preflight.cjs');
const {ingest}=require('./market-daily-ingest.cjs');
const {execFileSync}=require('node:child_process');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
// Text checkout conventions are not a change to the immutable source identities.
function baselineFingerprint(seedChecksum,registryText){
 const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
 const checksum=String(seedChecksum).trim();
 check(/^[a-f0-9]{64}$/i.test(checksum),'Invalid seed checksum');
 return hash(checksum.toLowerCase()+':'+hash(JSON.stringify(canonical(JSON.parse(String(registryText))))));
}
function check(v,m){if(!v)throw Error(m);}
function run(request){
 const work=fs.realpathSync(request.work),root=path.join(work,'history'),stateDir=path.join(work,'state');
 check(!fs.existsSync(root)&&!fs.existsSync(stateDir),'Work directory already used');fs.mkdirSync(stateDir);
 // Checksum-pinned immutable source definitions. supplement loader separately verifies all referenced bytes.
 const baseline=()=>baselineFingerprint(fs.readFileSync('data/market-history/tradingview-backfill-36-v1.json.gz.sha256'),fs.readFileSync('data/commodity-research/source-registry.json'));
 const fingerprint=baseline();
 if(request.state){
  const previous=JSON.parse(fs.readFileSync(path.join(work,'previous-state.json')));
  check(previous.schemaVersion===1&&previous.baselineFingerprint===fingerprint,'Immutable baseline changed');
  for(const [name,body] of Object.entries(previous.files)){
   check(/^[A-Z]+\.json$/.test(name)&&typeof body==='string','Unsafe state entry');fs.writeFileSync(path.join(stateDir,name),body,{flag:'wx'});
  }
 }else{
  // Explicit bootstrap from the current canonical overlay, never from an empty second pricing branch.
  check(typeof request.bootstrapState==='string'&&fs.existsSync(request.bootstrapState),'Bootstrap state unavailable');
  for(const name of fs.readdirSync(request.bootstrapState)){
   check(/^[A-Z]+\.json$/.test(name),'Unsafe bootstrap state entry');
   const bytes=fs.readFileSync(path.join(request.bootstrapState,name));fs.writeFileSync(path.join(stateDir,name),bytes,{flag:'wx'});
  }
  // Fail if the canonical bootstrap changed while it was being copied; don't admit a torn batch baseline.
  const originalNames=fs.readdirSync(request.bootstrapState).sort(),copiedNames=fs.readdirSync(stateDir).sort();
  check(JSON.stringify(originalNames)===JSON.stringify(copiedNames)&&copiedNames.every(name=>
   hash(fs.readFileSync(path.join(request.bootstrapState,name)))===hash(fs.readFileSync(path.join(stateDir,name)))),'Bootstrap state changed during copy');
 }
 restore(root,{state:stateDir});
 const input=path.join(work,'latest.json'),auditFile=path.join(work,'audit',request.runDate+'.json');
 const payloadHash=hash(fs.readFileSync(input)),auditHash=hash(fs.readFileSync(auditFile));
 let plan;
 try{plan=preflight({input,root,now:request.receivedAt});}
 catch(e){
  if(e.code)throw e; // missing files/IO are environmental, not rejected market data
  return {report:{mode:'shadow-history-only',accepted:false,receivedBars:39,payloadSha256:payloadHash,auditSha256:auditHash,
   baselineFingerprint:fingerprint,calendarIndependentlyVerified:false,analyticsTriggered:false,productionChanged:false,errorCode:'ADMISSION_REJECTED'},state:null};
 }
 const report={mode:'shadow-history-only',accepted:plan.accepted,receivedBars:39,payloadSha256:payloadHash,auditSha256:auditHash,
  baselineFingerprint:fingerprint,calendarIndependentlyVerified:false,analyticsTriggered:false,productionChanged:false,
  plannedInsertions:plan.plannedInsertions,duplicates:plan.skipped,failed:plan.failed,
  instruments:plan.instruments.map(i=>({symbol:i.symbol,failed:i.failed,reason:i.reason||null}))};
 check(baseline()===fingerprint,'Immutable baseline changed during validation');
 if(!plan.accepted)return {report,state:null};
 const result=ingest({input,root,includeReview:true,now:request.receivedAt});
 check(result.failed===0&&result.notEnabled===0&&result.instruments.length===39,'Isolated ingestion did not match preflight');
 const files={};
 for(const name of fs.readdirSync(path.join(root,'daily-ingestion'))){
  if(!/^[A-Z]+\.json$/.test(name))continue;
  files[name]=fs.readFileSync(path.join(root,'daily-ingestion',name),'utf8');
 }
 check(Object.keys(files).length===39,'Cumulative state must contain 39 identities');
 const state={schemaVersion:1,baselineFingerprint:fingerprint,files};
 check(hash(fs.readFileSync(input))===payloadHash&&hash(fs.readFileSync(auditFile))===auditHash,'Worker input changed');
 check(baseline()===fingerprint,'Immutable baseline changed during ingestion');
 report.inserted=result.inserted;report.duplicates=result.skipped;
 if(request.analyticsSnapshot){
  check(request.htfFeed&&fs.existsSync(path.join(request.analyticsSnapshot,'data/manifest.json'))&&fs.existsSync(request.htfFeed),'Analytics snapshot/HTF evidence missing');
  const output=path.join(work,'site');
  const sourceManifestHash=hash(fs.readFileSync(path.join(request.analyticsSnapshot,'data/manifest.json')));
  // Same scoring/OHLC builders, frozen stock/COT snapshot, no SQL queries/refresh/publication/render-side DB setup.
  require('./morning-analytics.cjs').run({root,input,snapshot:request.analyticsSnapshot,output,
   feed:request.htfFeed,approvedRehearsalRoot:work,renderShell:false});
  for(const script of ['raw-seasonality-checks.cjs','zone-prices-checks.cjs','static-site-checks.cjs'])
   execFileSync(process.execPath,[path.resolve('Tools',script),output],{stdio:'inherit'});
  const health=require('./daily-health.cjs'),checks=health.create();checks.mode='safe-rehearsal';
  health.checkOutputs(output,checks);
  check(hash(fs.readFileSync(path.join(request.analyticsSnapshot,'data/manifest.json')))===sourceManifestHash,'Analytics source snapshot changed during rehearsal');
  const manifestBytes=fs.readFileSync(path.join(output,'data/manifest.json')),manifest=JSON.parse(manifestBytes);
  report.analyticsRehearsal={passed:true,publicationEligible:false,shellRefreshed:false,
   manifestSha256:hash(manifestBytes),stockSnapshotAt:manifest.stockSnapshotAt,
   sourceSnapshotSha256:sourceManifestHash,healthWarnings:checks.warnings,
   screener:manifest.screener,opportunities:manifest.opportunities,zonePrices:manifest.zonePrices};
 }
 return {report,state};
}
module.exports={run,baselineFingerprint};
if(require.main===module){
 const file=process.argv[2],request=JSON.parse(fs.readFileSync(file));
 try{const result=run(request);fs.writeFileSync(path.join(request.work,'result.json'),JSON.stringify(result),{flag:'wx'});}
 catch(e){
  // Data errors block this batch; infrastructure errors are retried by the .NET orchestrator.
  // Do not echo payloads, environment variables or connection strings to stdout/stderr.
  console.error('MARKET_WORKER_VALIDATION_FAILED');process.exitCode=1;
 }
}
