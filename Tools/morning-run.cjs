// The only live orchestrator. Generates staging outputs, NEVER deploys or pushes.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const health=require('./daily-health.cjs'),{prepare}=require('./prepare-market-sources.cjs'),{run}=require('./morning-analytics.cjs');
function execute({root='artifacts/tradingview-backfill-36-v1',input='data/market-daily/latest.json',snapshot=null,output='artifacts/morning-site',feed='artifacts/htf-ohlc',healthDir='artifacts/daily-health'}={}){
 const h=health.create(),safe=Boolean(snapshot);h.mode=safe?'safe-rehearsal':'live';
 const command=(cmd,args)=>execFileSync(cmd,args,{stdio:'inherit',env:process.env});
 const node=(script,...args)=>command(process.execPath,[script,...args]);
 const stage=(key,fn)=>{h[key].status='running';try{const value=fn();h[key].status='ok';return value;}catch(e){h[key].status='failed';throw e;}};
 try{
  h.market.status='running';const payload=JSON.parse(fs.readFileSync(input));h.marketDailyFetchedAt=payload.fetchedAt||payload.generatedAt||null;
  h.market.received=Array.isArray(payload.bars)?payload.bars.length:0;health.marketFreshness(input);
  const bundle=stage('market',()=>prepare({root,input})),r=bundle.ingestion;
  h.market={status:'ok',received:r.instruments.reduce((n,a)=>n+a.received,0),inserted:r.inserted,duplicates:r.skipped,failed:r.failed,
   failedSymbols:r.instruments.filter(a=>a.failed).map(a=>a.symbol),inputSha256:r.inputSha256};
  const gates=health.ingestionGate(r,JSON.parse(fs.readFileSync(path.join(root,'test-source-registry.json'))));
  h.warnings.push(...gates.warnings);h.errors.push(...gates.errors);if(gates.errors.length){h.market.status='failed';throw Error('Critical market ingestion failed');}
  if(r.extension?.error)h.warnings.push('Commodity extension: '+r.extension.error);
  if(gates.warnings.length||r.extension?.error)h.market.status='warning';
  if(!safe){
   stage('stocks',()=>command('dotnet',['run','--project','SeasonalityApp.csproj','-c','Release','--no-build','--','--update-once','--stock-refresh-report','artifacts/stock-refresh/latest.json']));
   const audit=JSON.parse(fs.readFileSync('artifacts/stock-refresh/latest.json'));h.stocks={...h.stocks,refresh:audit};
   try{const warnings=health.stockRefreshAudit(audit);if(warnings.length){h.stocks.status='warning';h.warnings.push(...warnings);}}
   catch(e){h.stocks.status='failed';throw e;}
   // Existing CFTC refresh only; no change to COT definitions or normalization.
   try{stage('cot',()=>command('dotnet',['run','--project','SeasonalityApp.csproj','-c','Release','--no-build','--','--update-cot-once']));}
   catch{h.cot.status='warning';h.warnings.push('COT refresh failed; existing snapshot freshness will be checked');}
   command('pwsh',['-NoProfile','-File','Tools/fetch-htf-ohlc.ps1','-OutputDir',feed]);
  }else{h.stocks.status='snapshot-only';h.cot.status='snapshot-only';h.warnings.push('Safe rehearsal: no stock/COT refresh, no SQL writes, no publication');}
  run({root,input,snapshot,output,feed,prepared:true,onStage:stage});
  stage('staticExport',()=>{
   health.checkOutputs(output,h);
   node('Tools/raw-seasonality-checks.cjs',output);node('Tools/htf-export-checks.cjs',output);node('Tools/static-site-checks.cjs',output);
  });
  h.eligibleForPublication=!safe;
 }catch(e){if(h.market.status==='running')h.market.status='failed';h.errors.push(e.message);h.eligibleForPublication=false;}
 finally{
  health.finish(h);health.write(healthDir,h);
  if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,health.summary(h));
  console.log(health.summary(h));
 }
 return h;
}
module.exports={execute};
if(require.main===module){const value=(k,d)=>process.argv.find(a=>a.startsWith(k+'='))?.slice(k.length+1)||d;
 const h=execute({root:value('--root','artifacts/tradingview-backfill-36-v1'),input:value('--input','data/market-daily/latest.json'),snapshot:value('--snapshot',null),output:value('--output','artifacts/morning-site'),feed:value('--feed','artifacts/htf-ohlc'),healthDir:value('--health-dir','artifacts/daily-health')});
 if(h.status==='failed')process.exitCode=1;
}
