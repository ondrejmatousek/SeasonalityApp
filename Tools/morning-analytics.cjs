// Shared analytics entry point. Scheduling/health are in morning-run; hosting is separate.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {prepare}=require('./prepare-market-sources.cjs'),{apply,saveManifest}=require('./apply-market-sources.cjs');
function run({root='artifacts/tradingview-backfill-36-v1',input='data/market-daily/latest.json',snapshot=null,output,feed='artifacts/htf-ohlc',prepared=false,onStage=(name,fn)=>fn()}={}) {
 if(!output)throw Error('--output=<new artifacts directory> required');
 output=path.resolve(output);if(!output.startsWith(path.resolve('artifacts')+path.sep)||fs.existsSync(output))throw Error('Use a new output directory under artifacts/');
 const bundlePath=path.resolve(root,'analytics-sources-v1/manifest.json');
 const bundle=prepared?JSON.parse(fs.readFileSync(bundlePath)):prepare({root,input});
 const exec=(file,args)=>execFileSync(process.execPath,[file,...args],{stdio:'inherit'});
 if(snapshot){fs.cpSync(path.resolve(snapshot),output,{recursive:true});fs.cpSync('wwwroot',output,{recursive:true});
  execFileSync('dotnet',['run','--project','SeasonalityApp.csproj','-c','Release','--no-build','--','--render-static-shell','--output',output],{stdio:'inherit'});
 }
 else execFileSync('dotnet',['run','--project','SeasonalityApp.csproj','-c','Release','--no-build','--','--export-static','--output',output],{stdio:'inherit',env:{...process.env,MarketData__BundlePath:bundlePath}});
 const before=JSON.parse(fs.readFileSync(path.join(output,'data/manifest.json')));
 before.sourceSnapshotAt=before.exportedAt;before.stockSnapshotAt=before.exportedAt;saveManifest(output,before);
 const routing=apply(output,bundlePath);
 onStage('seasonality',()=>exec('Tools/build-screener.cjs',[output]));
 // Candidate discovery uses the existing COT context; formulas stay unchanged.
 onStage('scoring',()=>exec('Tools/build-opportunities.cjs',[output]));
 onStage('htf',()=>exec('Tools/build-htf-confluence.cjs',[output,path.resolve(feed),bundlePath]));
 const m=JSON.parse(fs.readFileSync(path.join(output,'data/manifest.json')));
 const representatives=['AAPL','EURUSD','NDX','SPX','XAUUSD','WTI'].map(key=>{const a=m.assets.find(a=>a.key===key);return {key,...a.priceSource,actualPricePath:a.prices.path,count:a.prices.count,lastDate:a.prices.lastDate};});
 const report={builtAt:new Date().toISOString(),mode:snapshot?'offline snapshot rehearsal; not a live stock refresh':'fresh SQL stock/COT export',ingestion:bundle.ingestion,representatives,stockRowsPreserved:routing.stocksPreserved,unsupported:routing.unsupported,productionDeployment:false,schedulingChanged:false};
 fs.writeFileSync(path.join(output,'morning-analytics-report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({output,inserted:bundle.ingestion.inserted,duplicates:bundle.ingestion.skipped,failed:bundle.ingestion.failed,representatives:representatives.map(a=>({key:a.key,provider:a.provider,symbol:a.providerSymbol,count:a.count,lastDate:a.lastDate,status:a.status})),unsupported:routing.unsupported},null,2));
 return report;
}
module.exports={run};
if(require.main===module){try{const v=(k,d)=>process.argv.find(a=>a.startsWith(k+'='))?.slice(k.length+1)||d;run({root:v('--root','artifacts/tradingview-backfill-36-v1'),input:v('--input','data/market-daily/latest.json'),snapshot:v('--snapshot',null),output:v('--output',null),feed:v('--feed','artifacts/htf-ohlc'),prepared:process.argv.includes('--prepared')});}catch(e){console.error(e.message);process.exitCode=1;}}
