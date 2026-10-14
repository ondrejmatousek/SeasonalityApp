// Trusted Actions bridge. Original daily JSON/audit stay in ignored staging, never in Git.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const {restore}=require('./market-history-seed.cjs'),{preflight}=require('./market-daily-preflight.cjs');
const {baselineFingerprint}=require('./market-daily-sql-worker.cjs');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
function check(ok,message){if(!ok)throw Error(message);}
function evidence(contextFile,{now=Date.now()}={}){
 const file=path.resolve(contextFile),dir=path.dirname(file);
 check(dir.startsWith(path.resolve('artifacts')+path.sep),'SQL staging must be private artifacts subtree');
 const c=read(file);
 check(c.schemaVersion===1&&Number.isSafeInteger(c.generationId)&&c.generationId>0&&/^\d{4}-\d{2}-\d{2}$/.test(c.runDate),'Invalid SQL context');
 for(const key of ['receiptId','payloadSha256','auditSha256','stateSha256','baselineFingerprint'])check(/^[a-f0-9]{64}$/.test(c[key]),'Invalid SQL digest');
 check(hash(Buffer.from(c.payloadSha256+c.auditSha256,'hex'))===c.receiptId,'Receipt identity mismatch');
 for(const [name,key] of [['latest.json','payloadSha256'],['state.json','stateSha256'],['audit/'+c.runDate+'.json','auditSha256']])
  check(hash(fs.readFileSync(path.join(dir,name)))===c[key],'SQL export changed: '+name);
 const fingerprint=baselineFingerprint(fs.readFileSync('data/market-history/tradingview-backfill-36-v1.json.gz.sha256'),fs.readFileSync('data/commodity-research/source-registry.json'));
 const state=read(path.join(dir,'state.json'));
 check(fingerprint===c.baselineFingerprint&&state.schemaVersion===1&&state.baselineFingerprint===fingerprint,'SQL baseline mismatch');
 check(Object.keys(state.files).length===39&&Object.entries(state.files).every(([k,v])=>/^[A-Z]+\.json$/.test(k)&&typeof v==='string'),'SQL state must contain 39 safe files');
 require('./daily-health.cjs').marketFreshness(path.join(dir,'latest.json'),new Date(now));
 return {c,dir,state,input:path.join(dir,'latest.json'),root:path.join(dir,'history')};
}
function prepareSnapshot(contextFile,{now=Date.now()}={}){
 const e=evidence(contextFile,{now}),stateDir=path.join(e.dir,'overlays');
 check(!fs.existsSync(e.root)&&!fs.existsSync(stateDir),'Refusing to replace SQL staging');fs.mkdirSync(stateDir);
 for(const [name,body] of Object.entries(e.state.files))fs.writeFileSync(path.join(stateDir,name),body,{flag:'wx'});
 restore(e.root,{state:stateDir});
 const plan=preflight({input:e.input,root:e.root,now});
 check(plan.accepted&&plan.failed===0&&plan.plannedInsertions===0,'SQL accepted state/evidence admission mismatch');
 return e;
}
function guardGeneration(candidate,current){
 if(!current)return true;
 check(Number.isSafeInteger(current.generationId)&&current.generationId>0,'Invalid committed SQL generation');
 check(candidate.generationId>=current.generationId,'Older SQL generation cannot overwrite a newer web');
 if(candidate.generationId===current.generationId){
  check(candidate.receiptId===current.receiptId&&candidate.stateSha256===current.stateSha256,'Committed generation identity changed');return false;
 }
 return true;
}
function build(contextFile){
 const e=prepareSnapshot(contextFile);
 const h=require('./morning-run.cjs').execute({root:e.root,input:e.input,dailySource:'Azure SQL market_daily.Inbox / '+e.c.receiptId});
 check(h.status!=='failed'&&h.eligibleForPublication,'SQL analytics failed; last good publication retained');
 const manifest='artifacts/morning-site/data/manifest.json',m=read(manifest);
 m.marketDailySql=e.c;fs.writeFileSync(manifest,JSON.stringify(m,null,2));
 h.marketDailySql=e.c;require('./daily-health.cjs').write('artifacts/daily-health',h);
 evidence(contextFile); // No rewritten raw input/state/audit while calculating.
 return {generationId:e.c.generationId,receiptId:e.c.receiptId};
}
function commit(contextFile){
 check(process.env.SEASONALITY_SQL_PUBLICATION_FENCED==='true','Publication requires the .NET SQL fence wrapper');
 const e=evidence(contextFile),candidate=read('artifacts/morning-site/data/manifest.json');
 check(JSON.stringify(candidate.marketDailySql)===JSON.stringify(e.c),'Candidate SQL provenance mismatch');
 const current=read('data/generated/site/data/manifest.json');
 if(!guardGeneration(e.c,current.marketDailySql))return {published:false,duplicate:true,generationId:e.c.generationId};
 const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
 check(!git('diff','--cached','--name-only'),'Refusing pre-existing staged edits');
 const allowed=p=>p.startsWith('data/generated/site/')||p.startsWith('data/market-state/')||p.startsWith('artifacts/daily-health/');
 check(git('diff','--name-only').split('\n').filter(Boolean).every(allowed),'Refusing unrelated tracked edits');
 // Tracking/static checks run before taking the SQL fence. Recheck their final result under it.
 const h=read('artifacts/daily-health/latest.json');
 check(h.mode==='live'&&h.eligibleForPublication&&h.status!=='failed'&&JSON.stringify(h.marketDailySql)===JSON.stringify(e.c),'Live SQL health/provenance gate refused candidate');
 require('./daily-health.cjs').checkOutputs('artifacts/morning-site',h);
 execFileSync(process.execPath,['Tools/static-site-checks.cjs','artifacts/morning-site'],{stdio:'inherit'});
 const result=require('./publish-morning-data.cjs').publish({root:e.root});
 check(result.published,'Publication gate refused candidate');
 git('config','user.name','seasonality-data-bot');git('config','user.email','41898282+github-actions[bot]@users.noreply.github.com');
 git('add','data/generated/site','data/market-state');git('add','-f','artifacts/daily-health');
 check(git('diff','--cached','--name-only').split('\n').filter(Boolean).every(allowed),'Unexpected staged publication files');
 git('commit','-m','SQL market generation '+e.c.generationId+' verified analytics');
 // A competing repository writer must cause a rejection, never a rebase/force-push of stale outputs.
 git('push','origin','HEAD:master');
 return {published:true,generationId:e.c.generationId,receiptId:e.c.receiptId,commit:git('rev-parse','HEAD')};
}
module.exports={evidence,prepareSnapshot,guardGeneration,build,commit};
if(require.main===module){try{console.log(JSON.stringify(process.argv[2]==='--commit'?commit(process.argv[3]):build(process.argv[2])));}catch{console.error('SQL_PUBLICATION_FAILED; last good committed web retained');process.exitCode=1;}}
