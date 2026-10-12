// Server-side only. Do not import into wwwroot or copy evidence to a public export.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const core=require('../wwwroot/js/core-market-registry.js');
const pilot=['EURUSD','GBPUSD','USDCAD','USDCHF'],DAY=86400000;
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const date=s=>{if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s)||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)throw Error('Invalid provider date');return s;};
const previous=s=>new Date(Date.parse(date(s)+'T00:00:00Z')-DAY).toISOString().slice(0,10);
function artifactRoot(root){const absolute=path.resolve(root);if(!absolute.startsWith(path.resolve('artifacts')+path.sep))throw Error('Private artifacts directory required');fs.mkdirSync(absolute,{recursive:true});return absolute;}
function save(f,value){const tmp=f+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2),{flag:'wx'});fs.renameSync(tmp,f);}
function saveEvidence(f,value){fs.writeFileSync(f,JSON.stringify(value,null,2),{flag:'wx'});}
function redact(x,key){if(typeof x==='string')return key?x.split(key).join('[REDACTED]'):x;if(Array.isArray(x))return x.map(v=>redact(v,key));if(x&&typeof x==='object')return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,/^(apikey|authorization|api_key)$/i.test(k)?'[REDACTED]':redact(v,key)]));return x;}
function quota(state,now){const today=new Date(now).toISOString().slice(0,10);if(state.day!==today){state.day=today;state.used=0;}state.recent=(state.recent||[]).filter(t=>now-t<60000);if(state.used>=700)throw Error('Daily audit budget reached; resume after UTC midnight');if(state.recent.length>=6)throw Error('Minute audit budget reached; resume on next run');state.used++;state.recent.push(now);}
function client({fetchImpl=fetch,clock=()=>Date.now(),reserve=()=>{}}={}){
    const key=process.env.TWELVE_DATA_API_KEY;if(!key)throw Error('TWELVE_DATA_API_KEY is not configured');
    return async(endpoint,params)=>{
        if(!['time_series','earliest_timestamp'].includes(endpoint))throw Error('Endpoint not allowed');
        if(Object.keys(params).some(k=>/apikey|authorization|token/i.test(k)))throw Error('Credentials in parameters forbidden');
        const url=new URL('https://api.twelvedata.com/'+endpoint);for(const[k,v]of Object.entries(params))url.searchParams.set(k,v);
        reserve(clock());let response;
        try{response=await fetchImpl(url,{headers:{Authorization:'apikey '+key},redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw Error('Twelve Data transport failed (details suppressed)');}
        let payload;try{payload=await response.json();}catch{throw Error('Twelve Data response is not JSON');}
        // Never log provider errors, URLs with secrets, headers, or exception causes.
        if(!response.ok||payload.status==='error')throw Error('Twelve Data request rejected; HTTP '+response.status+'; provider code '+(Number(payload.code)||'unknown'));
        return {provider:'Twelve Data',endpoint,params:{...params},observedAt:new Date(clock()).toISOString(),payload:redact(payload,key)};
    };
}
function validatePages(key,pages,earliest,observedAt){
    if(!core.pairs.includes(key)||!pages.length)throw Error('Core FX history required');
    const symbol=key.slice(0,3)+'/'+key.slice(3),seen=new Set(),bars=[],flags={excludedCurrent:[],outliers:[],missingWeekdays:[],weekendDates:[],precisionAccepted:[]};
    // Exclude the current date in BOTH documented relevant zones. This is conservative
    // diagnostic filtering, NOT proof of an exact provider daily completion contract.
    const today=z=>new Intl.DateTimeFormat('sv-SE',{timeZone:z,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(observedAt));
    if(!Number.isFinite(Date.parse(observedAt)))throw Error('Invalid observation time');
    const cutoff=[today('UTC'),today('Australia/Sydney')].sort()[0];let metadata;
    for(const e of pages){const p=e.payload;if(e.provider!=='Twelve Data'||e.endpoint!=='time_series'||e.params.symbol!==symbol||p.status!=='ok'||p.meta?.symbol!==symbol||p.meta.interval!=='1day'||!Array.isArray(p.values)||!p.values.length)throw Error('Payload identity/layout mismatch');
        const m={symbol:p.meta.symbol,interval:p.meta.interval,type:p.meta.type,currencyBase:p.meta.currency_base,currencyQuote:p.meta.currency_quote,exchangeTimezone:p.meta.exchange_timezone};
        if(metadata&&JSON.stringify(m)!==JSON.stringify(metadata))throw Error('Provider metadata changed between pages');metadata=m;
        if((m.currencyBase&&m.currencyBase!==key.slice(0,3))||(m.currencyQuote&&m.currencyQuote!==key.slice(3)))throw Error('Currency orientation mismatch');
        for(const r of p.values){const d=date(r.datetime);if(seen.has(d))throw Error('Duplicate provider date');seen.add(d);
            const b={date:d,open:Number(r.open),high:Number(r.high),low:Number(r.low),close:Number(r.close)};
            if(['open','high','low','close'].some(k=>!['string','number'].includes(typeof r[k])||r[k]===''||!Number.isFinite(b[k])||b[k]<=0))throw Error('Invalid/nonpositive OHLC');
            const gap=Math.max(b.open-b.high,b.close-b.high,b.low-b.open,b.low-b.close,b.low-b.high,0),tolerance=key.endsWith('JPY')?.0005:.000005;
            if(b.high<b.low||gap>tolerance+32*Number.EPSILON*Math.max(b.high,b.open,b.close,1))throw Error('OHLC outside general FX precision tolerance');
            if(gap>0)flags.precisionAccepted.push({date:d,gap}); // originals retained, no envelope repair
            if(d>=cutoff){flags.excludedCurrent.push(d);continue;}bars.push(b);
        }
    }
    bars.sort((a,b)=>a.date.localeCompare(b.date));if(!bars.length)throw Error('No conservatively closed daily labels');
    const dates=new Set(bars.map(b=>b.date));for(let t=Date.parse(bars[0].date);t<=Date.parse(bars.at(-1).date);t+=DAY){const d=new Date(t);if(![0,6].includes(d.getUTCDay())&&!dates.has(d.toISOString().slice(0,10)))flags.missingWeekdays.push(d.toISOString().slice(0,10));}
    bars.forEach((b,i)=>{if([0,6].includes(new Date(b.date).getUTCDay()))flags.weekendDates.push(b.date);if(i){const change=100*(b.close/bars[i-1].close-1);if(Math.abs(change)>5)flags.outliers.push({date:b.date,returnPct:change});}});
    const model=require('../wwwroot/js/daily-opportunities.js'),eligibleYears=model.seasonalCurve(bars,new Date(observedAt).toISOString().slice(0,10),{displayOnly:true}).years;
    return {schemaVersion:1,id:`fx-spot:${key}:twelve-provider-daily-unverified:v1`,key,provider:'Twelve Data',symbol,metadata,observedAt,
        session:{status:'UNVERIFIED',timezone:metadata.exchangeTimezone||null,dateLabel:'provider date preserved verbatim',cutoff:null,ny17:false,completionPolicy:'Conservative current-date exclusion in UTC and Sydney; exact session must be verified before activation'},
        maximumHistoryConfirmed:bars[0].date<=date(earliest.slice(0,10)),earliestAdvertised:earliest,firstDate:bars[0].date,lastDate:bars.at(-1).date,count:bars.length,eligibleYears,
        covers2006To2025:Array.from({length:20},(_,i)=>2006+i).every(y=>eligibleYears.includes(y)),status:'research-only',activationAllowed:false,
        flags,revisionPolicy:'Immutable raw requests + new same-provider snapshot; no provider splice',rawHashes:pages.map(digest),bars,prices:bars.map(b=>[b.date,b.close])};
}
function upsert(existing,incoming){
    if(existing.id!==incoming.id||existing.provider!==incoming.provider||existing.symbol!==incoming.symbol)throw Error('Cross-provider/series upsert forbidden');
    if(JSON.stringify(existing.session)!==JSON.stringify(incoming.session))throw Error('Session contract changed');
    const map=new Map(existing.bars.map(b=>[b.date,b]));let inserted=0,updated=0;
    for(const b of incoming.bars){const old=map.get(b.date);if(!old)inserted++;else if(JSON.stringify(old)!==JSON.stringify(b))updated++;map.set(b.date,b);}
    const bars=[...map.values()].sort((a,b)=>a.date.localeCompare(b.date));return{bars,inserted,updated,received:incoming.bars.length,rejected:0};
}
async function bootstrap(root,key,{request,clock=()=>Date.now()}={}){
    root=artifactRoot(root);if(!pilot.includes(key))throw Error('Only four pilot pairs permitted until live pilot passes');
    const folder=path.join(root,key);fs.mkdirSync(folder,{recursive:true});const stateFile=path.join(folder,'checkpoint.json'),state=fs.existsSync(stateFile)?read(stateFile):{key,provider:'Twelve Data',pages:[],earliest:null,endDate:new Date(clock()).toISOString().slice(0,10),done:false};
    if(state.key!==key||state.provider!=='Twelve Data')throw Error('Checkpoint identity mismatch');
    if(!request){const qf=path.join(root,'budget.json'),qs=fs.existsSync(qf)?read(qf):{};request=client({clock,reserve:n=>{quota(qs,n);save(qf,qs);}});}
    const symbol=key.slice(0,3)+'/'+key.slice(3);
    if(!state.earliest){const file=path.join(folder,'earliest.json'),exists=fs.existsSync(file),e=exists?read(file):await request('earliest_timestamp',{symbol,interval:'1day'}),d=e.payload.datetime;
        if(e.provider!=='Twelve Data'||e.endpoint!=='earliest_timestamp'||e.params.symbol!==symbol||typeof d!=='string')throw Error('Earliest timestamp identity missing');date(d.slice(0,10));state.earliest=d;if(!exists)saveEvidence(file,e);save(stateFile,state);}
    // One page per invocation; resumable, quota capped and no blocking sleeps.
    if(!state.done){const filename='page-'+state.pages.length+'.json',file=path.join(folder,filename),exists=fs.existsSync(file),e=exists?read(file):await request('time_series',{symbol,interval:'1day',outputsize:'5000',order:'desc',end_date:state.endDate});
        if(e.params.end_date!==state.endDate)throw Error('Evidence checkpoint window mismatch');
        if(e.payload.status!=='ok'||!Array.isArray(e.payload.values)||!e.payload.values.length)throw Error('Empty history before advertised earliest date');
        const ds=e.payload.values.map(r=>date(r.datetime)).sort(),first=ds[0];if(ds.at(-1)>state.endDate||first>state.endDate)throw Error('Paging window ignored');
        validatePages(key,[...state.pages.map(f=>read(path.join(folder,f))),e],state.earliest,new Date(clock()).toISOString());
        if(!exists)saveEvidence(file,e);state.pages.push(filename);state.done=first<=state.earliest.slice(0,10);state.endDate=previous(first);save(stateFile,state);
    }
    if(state.done){const pages=state.pages.map(f=>read(path.join(folder,f))),series=validatePages(key,pages,state.earliest,new Date(clock()).toISOString());if(!series.maximumHistoryConfirmed)throw Error('History truncated');save(path.join(folder,'series.json'),series);}
    return {key,provider:'Twelve Data',pages:state.pages.length,historyFetchComplete:state.done,activationAllowed:false};
}
module.exports={pilot,client,quota,validatePages,bootstrap,upsert,redact,previous};
if(require.main===module)bootstrap(process.argv[2],process.argv[3]).then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e.message);process.exitCode=1;});
