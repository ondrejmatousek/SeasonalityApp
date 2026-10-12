const fs=require('node:fs'),path=require('node:path'),{aggregate}=require('./dukascopy-session.cjs'),{pack}=require('./twelve-pilot-bundle.cjs');
function finish(root,out,publicKeyFile){
 for(const p of [root,out])if(!path.resolve(p).startsWith(path.resolve('artifacts')+path.sep))throw Error('Private artifacts directory required');
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))),daily=[];
 if(manifest.accessResult==='PASS')for(const pair of ['EURUSD','GBPUSD','USDCAD','USDCHF']){
  const files=manifest.controlResults.filter(r=>r.pair===pair).sort((a,b)=>a.hourStart.localeCompare(b.hourStart));
  if(files.length!==24||files.some(r=>!r.validBI5)){daily.push({pair,status:'CONTROL BLOCKED'});continue;}
  try{const ticks=files.flatMap(r=>JSON.parse(fs.readFileSync(path.join(root,r.rawFile.replace('.response','.ticks.json'))))),result=aggregate(ticks,{symbol:pair,priceSide:'bid',transportComplete:true,observedAt:manifest.observedAt});
   if(result.bars.length!==1||result.bars[0].date!=='2026-10-09')throw Error('Unexpected session date');
   const bar=result.bars[0];daily.push({pair,status:'NY17 CONTROL BUILT',bar});
  }catch(error){daily.push({pair,status:'CONTROL BLOCKED',error:error.message});}
 }
 fs.writeFileSync(path.join(root,'daily-control.json'),JSON.stringify(daily,null,2));
 const summary={accessResult:manifest.accessResult,status:manifest.status,productionChanged:false,
  results:manifest.results.map(r=>({pair:r.pair,hourStart:r.hourStart,requestTimestamp:r.requestTimestamp,httpStatus:r.httpStatus,bytes:r.bytes,contentType:r.contentType,sha256:r.sha256,error:r.error,decodeError:r.decodeError||null,validBI5:r.validBI5,tickCount:r.tickCount||0})),
  control:daily.map(({bar,...r})=>r),continueFourPairPilot:manifest.accessResult==='PASS'&&daily.length===4&&daily.every(r=>r.status==='NY17 CONTROL BUILT')};
 fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2));
 fs.writeFileSync(path.join(out,'evidence.encrypted.json'),JSON.stringify(pack(root,fs.readFileSync(publicKeyFile))));
 console.log(JSON.stringify(summary,null,2));if(summary.accessResult!=='PASS')process.exitCode=1;
}
module.exports={finish};if(require.main===module)finish(...process.argv.slice(2));
