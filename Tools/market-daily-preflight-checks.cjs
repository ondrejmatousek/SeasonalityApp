const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {preflight}=require('./market-daily-preflight.cjs');
const {ingest}=require('./market-daily-ingest.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),read=f=>JSON.parse(fs.readFileSync(f));
const seed=path.resolve('artifacts/tradingview-backfill-36-v1');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'seasonality-preflight-'));
const root=path.join(temp,'history'),feed=path.join(temp,'feed'),supplement=path.resolve('data/commodity-research');
fs.mkdirSync(root);fs.mkdirSync(path.join(feed,'audit'),{recursive:true});
const registry=read(path.join(seed,'test-source-registry.json'));
fs.copyFileSync(path.join(seed,'test-source-registry.json'),path.join(root,'test-source-registry.json'));
for(const e of registry.entries){
 const original=read(path.join(seed,e.seasonalitySource));
 // Synthetic isolated history fixture keeps the same registered identity but only its tail.
 original.bars=original.bars.slice(-2);
 const f=path.join(root,e.seasonalitySource);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(original));
}
const original=read('data/market-daily/latest.json'),now=Date.parse(original.fetchedAt)+60000;
const originalAudit=read('data/market-daily/audit/'+original.runDate+'.json');
const input=path.join(feed,'latest.json'),auditFile=path.join(feed,'audit',original.runDate+'.json');
function write(p=original,a=originalAudit){fs.writeFileSync(input,JSON.stringify(p));fs.writeFileSync(auditFile,JSON.stringify(a));}
function snapshot(dir){return fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).map(e=>{
 const f=path.join(dir,e.name);return e.isDirectory()?e.name+'/'+snapshot(f):e.name+':'+sha(fs.readFileSync(f));
}).join('\n');}
function run(){const before=snapshot(root),supp=snapshot(supplement),r=preflight({input,root,supplement,now});assert.equal(snapshot(root),before);assert.equal(snapshot(supplement),supp);assert.equal(r.persisted,false);assert.equal(r.analyticsTriggered,false);assert.equal(r.inserted,0);return r;}
function rejected(mutator){const p=structuredClone(original),a=structuredClone(originalAudit);mutator(p,a);write(p,a);const before=snapshot(root);try{const r=run();assert.equal(r.accepted,false);}catch(e){assert.notEqual(e.code,'ERR_ASSERTION',e.message);}assert.equal(snapshot(root),before);}
write();let r=run();assert.equal(r.accepted,true,JSON.stringify(r.instruments.filter(i=>i.failed)));assert.equal(r.plannedInsertions+r.skipped,39);assert.equal(r.calendarIndependentlyVerified,false);assert.equal(r.requiresCommitRevalidation,true);
assert.equal(fs.existsSync(path.join(root,'daily-ingestion')),false,'Preflight must not create even a directory');
// Match the server's public contract as well as legacy wire labels for ALL classes.
const classes=new Map([...registry.entries,...require('./market-daily-ingest.cjs').supplementalEntries(supplement)].map(e=>[e.providerSymbol,e.assetClass]));
for(const legacy of [false,true]){
 const p=structuredClone(original);
 for(const b of p.bars){const canonical=classes.get(b.providerSymbol);b.assetClass=legacy?({forex:'fx',metal:'metals',commodity:'futures',index:'index'}[canonical]):canonical;}
 write(p);assert.equal(run().accepted,true,'Registry/wire assetClass parity');
}
rejected(p=>{p.bars[0].assetClass='commodity';});
rejected(p=>{p.bars[0].assetClass=null;});
rejected(p=>p.bars.pop());
rejected(p=>p.bars[1]=structuredClone(p.bars[0]));
rejected(p=>p.bars[0].completed=false);
rejected(p=>p.bars[0].provider='Yahoo');
rejected(p=>p.bars[0].timestamp=-1);
rejected(p=>p.runDate='2000-01-01');
rejected(p=>p.fetchedAt=new Date(now+60000).toISOString());
rejected((p,a)=>a.runs[0].checkedAt=new Date(now).toISOString());
rejected((p,a)=>a.runs[0].entries.pop());
rejected((p,a)=>a.runs[0].entries[0].sourceEvidence=[]);
rejected((p,a)=>a.runs[0].entries[0].rawResponse.bars.find(x=>x.t===p.bars[0].timestamp).c+=1);
rejected((p,a)=>a.runs[0].entries[0].completionMethod='matched_existing_history');
rejected((p,a)=>a.runs[0].entries.find(x=>x.symbol==='WHEAT').timezone='Europe/Prague');
write();assert.throws(()=>preflight({input,root,supplement,now:now+86400000}),/stale/);
// Actual existing writer remains the only commit path. Preflight must agree and leave no lock/evidence.
const committed=ingest({input,root,supplement,includeReview:true,now});assert.equal(committed.failed,0);
r=run();assert.equal(r.skipped,39);assert.equal(r.plannedInsertions,0);
// OHLC conflict must be caught against persisted history even when its audit agrees with the changed value.
rejected((p,a)=>{p.bars[0].close=p.bars[0].open;const raw=a.runs[0].entries[0].rawResponse.bars.find(x=>x.t===p.bars[0].timestamp);raw.c=p.bars[0].close;});
write();fs.mkdirSync(path.join(root,'daily-ingestion','.lock'));assert.throws(()=>preflight({input,root,supplement,now}),/writer active/);fs.rmdirSync(path.join(root,'daily-ingestion','.lock'));
console.log('PASS: read-only full-39 admission, exact audit/raw OHLC, session timezone, freshness, history/conflicts, idempotency, no directory/evidence writes, existing writer parity. Isolated evidence: '+temp);
