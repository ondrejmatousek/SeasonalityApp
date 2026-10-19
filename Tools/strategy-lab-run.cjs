const fs=require('node:fs'),path=require('node:path'),L=require('../wwwroot/js/strategy-lab.js');
const file=process.argv[2]||'wwwroot/research/strategy-lab-pilot.json',data=JSON.parse(fs.readFileSync(file,'utf8'));
if(data.schemaVersion!==1||data.researchOnly!==true||data.selectionEligible!==false)throw Error('Expected explicitly research-only pilot.');
const reports=[];
for(const instrument of data.instruments){const prepared=L.prepare(instrument);for(const family of ['zones','ema']){
 const results=L.matrix(family).map(config=>{const r=L.run(prepared,config),stress=L.run(prepared,{...config,spreadBps:config.spreadBps*2,slippageBps:config.slippageBps*2});return {...r,stressMetrics:stress.metrics};});
 reports.push({symbol:instrument.symbol,first:instrument.first,last:instrument.last,family,rawSha256:instrument.rawSha256,results});
}}
const report={schemaVersion:1,engineVersion:L.version,researchOnly:true,selectionEligible:false,qualifiedWinner:null,reason:'Krátká historie, tři páry, neověřené brokerové náklady a žádný nedotčený závěrečný test.',sourceSnapshotSha256:data.sourceSnapshotSha256,engineSha256:data.engineSha256,detectorSha256:data.detectorSha256,reports};
if(process.argv[3]){const output=path.resolve(process.argv[3]);if(fs.existsSync(output))throw Error('Output must be new.');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));}
console.log(JSON.stringify({variants:reports.reduce((n,r)=>n+r.results.length,0),qualifiedWinner:null,reports:reports.map(r=>({symbol:r.symbol,family:r.family,variants:r.results.length,closedTradeCounts:[...new Set(r.results.map(x=>x.metrics.trades))].sort((a,b)=>a-b)}))}));
