// Daily build-time scan. Browsers fetch only this compact summary; no new server, SQL query or account.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const model=require('../wwwroot/js/daily-opportunities.js');
const registry=require('../wwwroot/js/core-market-registry.js');
const cot=require('../wwwroot/js/core-cot.js');
const scoring=require('../wwwroot/js/opportunity-scoring-v2.js');
const scoringV3=require('../wwwroot/js/opportunity-scoring-v3.js');
const dir=path.resolve(process.argv[2]),manifestPath=path.join(dir,'data/manifest.json');
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const asOf=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Prague'}).format(new Date(manifest.exportedAt));
const contracts=new Map(),assets=[];
const catalog=[...manifest.assets.filter(a=>a.cot.markets.length||a.assetClass==='index'||registry.get(a.key)?.executionKind!=='futures-profile'&&registry.get(a.key)),...Object.values(registry.entries).filter(m=>m.executionKind==='futures-profile').map(m=>{
    const reference=manifest.assets.find(a=>a.key===m.priceKey);
    return reference?{...reference,key:m.tradingInstrument,isTradingProfile:true,name:m.tradingInstrument+' · execution profile / '+m.priceKey,aliases:[],assetClass:'index'}:null;
}).filter(Boolean)];
for(const asset of catalog){
    const mapping=registry.resolve(asset),markets=[];
    for(const source of mapping.cotSources.filter(s=>s.contractCode)){
        const file=manifest.contracts[source.contractCode]?.files['52'];if(!file)continue;
        if(!contracts.has(source.contractCode))contracts.set(source.contractCode,JSON.parse(fs.readFileSync(path.join(dir,file.replace(/^\//,'')))).reports);
        const metadata=asset.cot.markets.find(m=>m.contractCode===source.contractCode)||source;
        markets.push({...metadata,reports:contracts.get(source.contractCode)});
    }
    const selected=cot.market(mapping,markets,manifest.exportedAt),{reports:cotReports,...market}=selected,cotModel=mapping.cotMode;
    const prices=JSON.parse(fs.readFileSync(path.join(dir,asset.prices.path.replace(/^\//,'')))).prices.map(([date,close])=>({date,close}));
    const analysis=model.analyzeAsset(prices,cotReports,asOf,{evaluationAt:manifest.exportedAt});
    for(const c of analysis.candidates)c.scoringV2=scoring.prepare(model,prices,asset,c,asOf);
    const dataStatus=mapping.status!=='validated-ranking-ready'?mapping.status:!prices.length?'unavailable':
        !model.cotAt(cotReports,manifest.exportedAt)?'COT-unavailable':'validated-ranking-ready';
    assets.push({key:asset.key,name:asset.name,aliases:asset.aliases,assetClass:asset.assetClass,commodityGroup:asset.commodityGroup,lastDate:asset.prices.lastDate,market,cotModel,cotNote:asset.cot.note,mapping,dataStatus,...analysis});
}
const calibrationV3=scoringV3.calibrate(assets);
const payload=JSON.stringify({schemaVersion:1,modelVersion:'seasonal-extremes-v1',mappingVersion:registry.version,scoringVersions:['research-priority-v1','research-priority-v2-experimental',scoringV3.version],calibrationV3,asOf,exportedAt:manifest.exportedAt,config:model.config,assets});
const hash=crypto.createHash('sha256').update(payload).digest('hex').slice(0,20),url=`/data/screener/opportunities.${hash}.json`;
fs.mkdirSync(path.join(dir,'data/screener'),{recursive:true});fs.writeFileSync(path.join(dir,url),payload);
manifest.opportunities={path:url,asOf,modelVersion:'seasonal-extremes-v1'};
manifest.coreMappingVersion=registry.version;
for(const a of manifest.assets){a.coreMapping=registry.resolve(a);a.coreDataStatus=assets.find(x=>x.key===a.key)?.dataStatus||a.coreMapping.status;}
const safe=JSON.stringify(manifest).replace(/[<>&\u2028\u2029]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
fs.writeFileSync(manifestPath,safe);
const htmlPath=path.join(dir,'index.html'),html=fs.readFileSync(htmlPath,'utf8');
if(!html.includes('id="static-market-manifest"'))throw Error('Missing embedded manifest');
fs.writeFileSync(htmlPath,html.replace(/(<script id="static-market-manifest" type="application\/json">)[\s\S]*?(<\/script>)/,(_,start,end)=>start+safe+end));
console.log(`Daily opportunities: ${assets.length} core/research instruments, ${assets.reduce((n,a)=>n+a.candidates.length,0)} windows, ${asOf}, ${(Buffer.byteLength(payload)/1024).toFixed(0)} KiB`);
