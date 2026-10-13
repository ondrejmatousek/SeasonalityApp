const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zones=require('../wwwroot/js/htf-zones.js');
const dir=path.resolve(process.argv[2]),feedDir=path.resolve(process.argv[3]),read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const manifest=read(path.join(dir,'data/manifest.json')),opps=read(path.join(dir,manifest.opportunities.path.slice(1))),asOf=opps.asOf,prices={},assets=[];
const bundlePath=process.argv[4]?path.resolve(process.argv[4]):null;
const bundle=bundlePath?read(bundlePath):null;
for(const a of opps.assets.filter(a=>a.mapping.scope==='core'||a.mapping.priceSource?.id&&a.mapping.priceSource.htfEnabled!==false)){
    const key=a.mapping.priceKey;if(!prices[key]){
        try{
            const source=a.mapping.priceSource;
            if(source?.id){
                if(!bundle)throw Error('TradingView market bundle required; Yahoo fallback prohibited');
                const entry=bundle.entries.find(e=>e.assetKey===key);
                if(!entry||entry.status==='unavailable')throw Error('TradingView series unavailable');
                const data=read(path.join(path.dirname(bundlePath),entry.file));
                if(data.id!==source.id||data.providerSymbol!==source.providerSymbol||data.sourceIdentity!==source.sourceIdentity)throw Error('HTF/seasonality source mismatch');
                const bars=data.htfBars.filter(b=>b.date<asOf&&zones.valid(b)).slice(-1500);
                if(bars.length<100)throw Error('Insufficient modern valid OHLC');
                if(Date.parse(asOf)-Date.parse(bars.at(-1).date)>7*86400000)throw Error('Stale TradingView OHLC (>7 days)');
                if(bars.slice(-100).some((b,i,s)=>i&&Date.parse(b.date)-Date.parse(s[i-1].date)>7*86400000))throw Error('Recent TradingView gap >7 days');
                const latest=bars.at(-1),found=['D1','W1'].flatMap(tf=>zones.detect(bars,tf,asOf));
                prices[key]={status:'ready',provider:data.provider,symbol:data.providerSymbol,sourceIdentity:data.sourceIdentity,priceSeriesId:data.id,
                    observedAt:bundle.builtAt,timezone:data.timezone,priceType:'Exact TradingView provider OHLC',cutoff:data.sessionContract,revisionPolicy:'Daily OHLC conflicts fail closed; immutable raw backfill',
                    review:data.review,sourceStatus:data.status,htfFrom:data.htfFrom,barCount:bars.length,excludedBars:data.bars.length-bars.length,latestDate:latest.date,latestClose:latest.close,
                    bars:bars.slice(-400),weekly:zones.weekly(bars,asOf).slice(-104),zones:found};
            }else{
            if(manifest.priceRouting&&a.mapping.priceKind!=='etf')throw Error('No registered market source; Yahoo fallback prohibited');
            const feed=read(path.join(feedDir,key+'.json'));if(feed.error)throw Error(feed.error);
            const r=feed.payload.chart.result[0],q=r.indicators.quote[0],timezone=r.meta.exchangeTimezoneName;
            if(r.meta.symbol!==a.mapping.chartSource.symbol||!timezone)throw Error('Symbol/timezone mismatch');
            const bars=r.timestamp.map((t,i)=>({date:new Intl.DateTimeFormat('sv-SE',{timeZone:timezone}).format(new Date(t*1000)),open:q.open[i],high:q.high[i],low:q.low[i],close:q.close[i]})).filter(b=>b.date<asOf&&zones.valid(b));
            if(new Set(bars.map(b=>b.date)).size!==bars.length)throw Error('Duplicate trading dates');
            bars.sort((a,b)=>a.date.localeCompare(b.date));if(bars.length<100)throw Error('Insufficient daily OHLC');
            if(Date.parse(asOf)-Date.parse(bars.at(-1).date)>7*86400000)throw Error('Stale OHLC (>7 days)');
            const gap=bars.slice(-100).some((b,i,s)=>i&&Date.parse(b.date)-Date.parse(s[i-1].date)>7*86400000);if(gap)throw Error('Recent OHLC gap >7 days');
            const source=manifest.assets.find(x=>x.key===key),old=new Map(read(path.join(dir,source.prices.path.slice(1))).prices),common=bars.slice(-30).filter(b=>old.has(b.date)).at(-1);
            if(!common||Math.abs(common.close/old.get(common.date)-1)>.005)throw Error('OHLC/seasonality close scale mismatch (>0.5%) or no common date');
            // Never let an unadjusted ETF split manufacture a base/departure pattern.
            const splitDates=Object.values(r.events?.splits||{}).map(e=>new Intl.DateTimeFormat('sv-SE',{timeZone:timezone}).format(new Date(e.date*1000))).filter(d=>d<asOf).sort();
            const lastSplit=splitDates.at(-1),detectionBars=lastSplit?bars.filter(b=>b.date>=lastSplit):bars;
            const found=['D1','W1'].flatMap(tf=>zones.detect(detectionBars,tf,asOf));
            prices[key]={status:'ready',provider:feed.provider,symbol:feed.symbol,url:feed.url,observedAt:feed.observedAt,timezone,priceType:'unadjusted provider OHLC',cutoff:'Completed daily candles only: trading date before evaluation date; W1 excludes current week',revisionPolicy:'Provider may revise history; snapshot retained per deployment, not strict PIT',lastSplit:lastSplit||null,barCount:bars.length,excludedBars:r.timestamp.length-bars.length,latestDate:bars.at(-1).date,latestClose:bars.at(-1).close,bars:detectionBars.slice(-400),weekly:zones.weekly(detectionBars,asOf).slice(-104),zones:found};
            }
        }catch(e){prices[key]={status:'unavailable',error:e.message,bars:[],weekly:[],zones:[]};}
    }
    const p=prices[key];assets.push({key:a.key,name:a.name,mapping:a.mapping,matches:p.status==='ready'?zones.match(p.zones,a.candidates,p.latestClose,asOf):[]});
}
const payload={schemaVersion:1,modelVersion:zones.config.version,asOf,builtAt:new Date().toISOString(),config:zones.config,prices,assets};
const json=JSON.stringify(payload),hash=crypto.createHash('sha256').update(json).digest('hex').slice(0,20),url=`/data/screener/htf-confluence.${hash}.json`;
fs.writeFileSync(path.join(dir,url.slice(1)),json);manifest.htfConfluence={path:url,asOf,modelVersion:zones.config.version};
const safe=JSON.stringify(manifest).replace(/[<>&\u2028\u2029]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
fs.writeFileSync(path.join(dir,'data/manifest.json'),safe);const file=path.join(dir,'index.html');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace(/(<script id="static-market-manifest" type="application\/json">)[\s\S]*?(<\/script>)/,(_,s,e)=>s+safe+e));
console.log(JSON.stringify({asOf,feeds:Object.keys(prices).length,available:Object.values(prices).filter(p=>p.status==='ready').length,unavailable:Object.entries(prices).filter(([,p])=>p.status!=='ready').map(([key,p])=>({key,error:p.error})),matches:assets.reduce((n,a)=>n+a.matches.length,0)},null,2));
