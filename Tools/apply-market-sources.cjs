const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8')),hash=b=>crypto.createHash('sha256').update(b).digest('hex').slice(0,20);
function saveManifest(dir,m) {
 const safe=JSON.stringify(m).replace(/[<>&\u2028\u2029]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
 fs.writeFileSync(path.join(dir,'data/manifest.json'),safe);
 const html=path.join(dir,'index.html');fs.writeFileSync(html,fs.readFileSync(html,'utf8').replace(/(<script id="static-market-manifest" type="application\/json">)[\s\S]*?(<\/script>)/,(_,s,e)=>s+safe+e));
}
function apply(dir,bundlePath,{evaluationAt=new Date().toISOString()}={}) {
 dir=path.resolve(dir);bundlePath=path.resolve(bundlePath);
 const m=read(path.join(dir,'data/manifest.json')),bundle=read(bundlePath),entries=new Map(bundle.entries.map(e=>[e.assetKey,e])),stocks=[];
 for(const a of m.assets) {
  if(!['forex','index','commodity'].includes(a.assetClass)) {
   stocks.push({key:a.key,path:a.prices.path,count:a.prices.count,lastDate:a.prices.lastDate});
   a.priceSource={provider:'Yahoo',sourceIdentity:'existing-stock-sql',dailySource:'existing Yahoo stock refresh → SQL → fresh static export',pricePolicy:'Existing stock/ETF ingestion retained; no TradingView migration'};
   continue;
  }
  const e=entries.get(a.key)||{assetKey:a.key,status:'unavailable',error:'No TradingView series registered; no Yahoo fallback'};
  let prices=[];
  if(e.status!=='unavailable') {
   const s=read(path.join(path.dirname(bundlePath),e.file));
   for(const k of ['id','provider','providerSymbol','sourceIdentity','assetKey'])if(s[k]!==e[k])throw Error('Bundle identity mismatch '+a.key+'/'+k);
   prices=s.prices;
  }
  const body=JSON.stringify({assetKey:a.key,prices,priceSource:e}),url=`/data/prices/${a.key}.${hash(body)}.json`;
  fs.writeFileSync(path.join(dir,url.slice(1)),body);
  a.prices={path:url,count:prices.length,lastDate:prices.at(-1)?.[0]||null};a.priceSource=e;
 }
 m.exportedAt=evaluationAt;m.priceRouting={version:bundle.version,marketInput:bundle.ingestion.inputSha256,stockSnapshotAt:m.stockSnapshotAt||m.sourceSnapshotAt||null,failures:bundle.ingestion.instruments.filter(x=>x.failed),unsupported:m.assets.filter(a=>a.priceSource?.status==='unavailable').map(a=>a.key)};
 m.stockSnapshotAt=m.stockSnapshotAt||null;
 saveManifest(dir,m);return {stocksPreserved:stocks,marketSources:bundle.entries,unsupported:m.priceRouting.unsupported};
}
module.exports={apply,saveManifest};
