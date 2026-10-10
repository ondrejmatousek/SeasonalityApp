// Daily build-time scan. Browsers fetch only this compact summary; no new server, SQL query or account.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const model=require('../wwwroot/js/daily-opportunities.js');
const dir=path.resolve(process.argv[2]),manifestPath=path.join(dir,'data/manifest.json');
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const asOf=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Prague'}).format(new Date(manifest.exportedAt));
const contracts=new Map(),assets=[];
for(const asset of manifest.assets.filter(a=>a.cot.markets.length)){
    // Fixed primary market: never cherry-pick whichever currency/proxy produces the highest percentage.
    const market=asset.cot.markets.find(m=>!m.isDollarIndex)||asset.cot.markets[0];
    if(!contracts.has(market.contractCode))contracts.set(market.contractCode,JSON.parse(fs.readFileSync(path.join(dir,manifest.contracts[market.contractCode].files['52']))).reports);
    const prices=JSON.parse(fs.readFileSync(path.join(dir,asset.prices.path))).prices.map(([date,close])=>({date,close}));
    const analysis=model.analyzeAsset(prices,contracts.get(market.contractCode),asOf);
    assets.push({key:asset.key,name:asset.name,aliases:asset.aliases,lastDate:asset.prices.lastDate,market,cotNote:asset.cot.note,...analysis});
}
const payload=JSON.stringify({schemaVersion:1,modelVersion:'seasonal-extremes-v1',asOf,exportedAt:manifest.exportedAt,config:model.config,assets});
const hash=crypto.createHash('sha256').update(payload).digest('hex').slice(0,20),url=`/data/screener/opportunities.${hash}.json`;
fs.mkdirSync(path.join(dir,'data/screener'),{recursive:true});fs.writeFileSync(path.join(dir,url),payload);
manifest.opportunities={path:url,asOf,modelVersion:'seasonal-extremes-v1'};
const safe=JSON.stringify(manifest).replace(/[<>&\u2028\u2029]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
fs.writeFileSync(manifestPath,safe);
const htmlPath=path.join(dir,'index.html'),html=fs.readFileSync(htmlPath,'utf8');
if(!html.includes('id="static-market-manifest"'))throw Error('Missing embedded manifest');
fs.writeFileSync(htmlPath,html.replace(/(<script id="static-market-manifest" type="application\/json">)[\s\S]*?(<\/script>)/,(_,start,end)=>start+safe+end));
console.log(`Daily opportunities: ${assets.length} COT-supported instruments, ${assets.reduce((n,a)=>n+a.candidates.length,0)} windows, ${asOf}, ${(Buffer.byteLength(payload)/1024).toFixed(0)} KiB`);
