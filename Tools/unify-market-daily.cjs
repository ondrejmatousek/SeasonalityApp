// One-time lossless envelope migration; does not fetch or alter provider bars.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const read=f=>JSON.parse(fs.readFileSync(f)),hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function merge(base,extra,audit,extraAudit){
 assert.equal(base.schemaVersion,1);assert.equal(extra.schemaVersion,1);assert.equal(base.timeframe,'1D');assert.equal(extra.timeframe,'1D');
 assert.equal(base.fetchedAt,extra.fetchedAt,'Do not mix collections from different timestamps');
 const bars=[...base.bars,...extra.bars];assert.equal(bars.length,39);assert.equal(new Set(bars.map(b=>b.symbol)).size,39,'Duplicate logical symbol');
 assert.ok(['WHEAT','LIVECATTLE','SOYBEANS'].every(k=>extra.bars.some(b=>b.symbol===k)));
 for(const a of [audit,extraAudit])assert.equal(a.schemaVersion,1);
 const runs=structuredClone(audit.runs);
 for(const incoming of extraAudit.runs){
  const target=runs.find(r=>r.checkedAt===incoming.checkedAt);
  if(!target){runs.push(structuredClone(incoming));continue;}
  for(const s of incoming.sources||[]){target.sources??=[];const old=target.sources.find(x=>x.id===s.id);if(old)assert.deepEqual(old,s,'Conflicting audit source id');else target.sources.push(s);}
  for(const e of incoming.entries){assert.ok(!target.entries.some(x=>x.providerSymbol===e.providerSymbol&&x.timestamp===e.timestamp),'Duplicate audit bar');target.entries.push(structuredClone(e));}
  // Original per-feed summaries are retained, never used as merged counters.
  target.collectionParts=[{kind:'original-36',summary:target.summary||null},{kind:'research-3',summary:incoming.summary||null}];
  delete target.summary;
 }
 const matched=runs.find(r=>r.checkedAt===base.fetchedAt);assert.ok(matched);assert.equal(matched.entries.length,39);
 for(const b of bars)assert.equal(matched.entries.filter(e=>e.providerSymbol===b.providerSymbol&&e.timestamp===b.timestamp).length,1,'Missing audit entry');
 return {payload:{...base,runDate:extra.runDate,bars},audit:{...audit,runs}};
}
function migrate(directory='data/market-daily'){
 const input=path.join(directory,'latest.json'),extension=path.join(directory,'commodity-extension/latest.json'),base=read(input),extra=read(extension),date=extra.runDate;
 assert.match(date,/^\d{4}-\d{2}-\d{2}$/);
 const mainAudit=path.join(directory,'audit',date+'.json'),extraAudit=path.join(directory,'commodity-extension/audit',date+'.json');
 const merged=merge(base,extra,read(mainAudit),read(extraAudit));
 const evidence=path.join(directory,'migration-evidence',date);fs.mkdirSync(evidence,{recursive:true});
 const originals={};for(const [key,f] of Object.entries({original36:input,research3:extension,originalAudit:mainAudit,researchAudit:extraAudit})){
  const dest=path.join(evidence,key+'.json');if(fs.existsSync(dest))assert.equal(hash(dest),hash(f),'Existing evidence differs');else fs.copyFileSync(f,dest);originals[key]={file:dest,sha256:hash(f)};
 }
 const body=JSON.stringify(merged.payload,null,2)+'\n';fs.writeFileSync(path.join(directory,date+'.json'),body);fs.writeFileSync(input,body);
 fs.writeFileSync(mainAudit,JSON.stringify(merged.audit,null,2)+'\n');
 fs.writeFileSync(path.join(evidence,'manifest.json'),JSON.stringify({schemaVersion:1,originals,notice:'Provider OHLC/timestamps unchanged; only collection envelopes/audits merged'},null,2));
 return {date,bars:39};
}
module.exports={merge,migrate};
if(require.main===module)console.log(JSON.stringify(migrate()));
