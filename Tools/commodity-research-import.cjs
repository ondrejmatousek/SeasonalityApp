// Audited, one-provider research history; no SQL, core-universe changes or price repairs.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const definitions=[['WHEAT','CBOT:ZW1!','CBOT'],['LIVECATTLE','CME:LE1!','CME'],['SOYBEANS','CBOT:ZS1!','CBOT']];
function valid(b){return Number.isSafeInteger(b.timestamp)&&['open','high','low','close'].every(k=>Number.isFinite(b[k])&&b[k]!==0)&&b.low<=b.open&&b.open<=b.high&&b.low<=b.close&&b.close<=b.high;}
function build(root='data/commodity-research'){
 fs.mkdirSync(path.join(root,'validated'),{recursive:true});const entries=[],audit=[];
 for(const [key,symbol,provider]of definitions){
  const files=fs.readdirSync(path.join(root,'raw')).filter(f=>new RegExp('^'+key+'-\\d+\\.json$').test(f)).sort();
  if(!files.length)throw Error('Missing TradingView evidence '+key);
  let rows=[],previous=null;const evidence=[];
  for(const file of files){
   const bytes=fs.readFileSync(path.join(root,'raw',file)),page=JSON.parse(bytes),r=page.response;
   if(!r.success||r.symbol!==symbol||r.interval!=='1D'||r.format!=='columns'||page.params.symbol!==symbol)throw Error('Provider identity mismatch '+file);
   if(previous&&(!previous.response.has_more||page.params.date_to!==previous.response.next_date_to))throw Error('Paging discontinuity '+file);
   const cols=r.bars;if(!['t','o','h','l','c','v'].every(k=>Array.isArray(cols[k])&&cols[k].length===r.count))throw Error('Column length mismatch '+file);
   for(let i=0;i<r.count;i++)rows.push({timestamp:cols.t[i],date:new Date(cols.t[i]*1000).toISOString().slice(0,10),open:cols.o[i],high:cols.h[i],low:cols.l[i],close:cols.c[i],volume:cols.v[i]});
   evidence.push({file:'raw/'+file,sha256:sha(bytes),count:r.count,fetchedAt:page.fetchedAt,request:page.params,notice:r.notice});previous=page;
  }
  if(previous.response.has_more)throw Error('History pagination incomplete '+key);
  rows.sort((a,b)=>a.timestamp-b.timestamp);const accepted=[],rejected=[],timestamps=new Set(),dates=new Set();let duplicates=0;
  const cutoff=Date.parse('2026-10-13T00:00:00Z');
  for(const b of rows){
   if(timestamps.has(b.timestamp)||dates.has(b.date)){duplicates++;throw Error('Duplicate provider timestamp/date '+key+' '+b.date);}
   timestamps.add(b.timestamp);dates.add(b.date);
   if(!valid(b)||b.timestamp*1000>=cutoff){rejected.push({bar:b,reason:valid(b)?'current/uncompleted calendar day':'strict OHLC invalid'});continue;}
   accepted.push(b);
  }
  if(accepted.length<1000)throw Error('Insufficient accepted research history '+key);
  const gaps=accepted.slice(1).map((b,i)=>({before:accepted[i].date,after:b.date,days:(Date.parse(b.date)-Date.parse(accepted[i].date))/86400000})).filter(g=>g.days>7);
  const outliers=accepted.slice(1).map((b,i)=>({date:b.date,before:accepted[i].close,after:b.close,changePct:(b.close/accepted[i].close-1)*100})).filter(b=>Math.abs(b.changePct)>10);
  const years=[...new Set(accepted.map(b=>Number(b.date.slice(0,4))))].filter(y=>y<2026).filter(y=>{const a=accepted.filter(b=>b.date.startsWith(y+'-'));return a.length>=200&&a[0].date<=y+'-01-15'&&a.at(-1).date>=y+'-12-15';});
  const source={schemaVersion:1,assetKey:key,logicalSymbol:key,id:`commodity:${key}:${symbol}:tv-research:v1`,provider,providerSymbol:symbol,sourceIdentity:provider+'_TRADINGVIEW_RESEARCH',
   timeframe:'1D',assetClass:'commodity',instrumentKind:'continuous futures',status:'research-only',review:true,
   historicalSource:'data/commodity-research/validated/'+key+'.json',dailySource:'Not configured: historical TradingView backfill only',dailyStatus:'historical-only',
   timezone:'America/Chicago',sessionContract:'TradingView regular-session D1; exact continuous roll and back-adjustment settings not verified',dateContract:'Original provider timestamp UTC date; no time shift',
   lastFetchedAt:previous.fetchedAt,completeYears:years,seasonalityFrom:years[0]+'-01-01',prices:accepted.filter(b=>b.date>=years[0]+'-01-01').map(b=>[b.date,b.close]),bars:accepted,htfBars:[],htfEnabled:false,
   reason:'Research only / unsupported for validated ranking. Continuous roll gaps may affect seasonality; no contract-aware reconstruction. Daily refresh is not configured.',
   evidence,rejected};
  const body=JSON.stringify(source),file=key+'.json';fs.writeFileSync(path.join(root,'validated',file),body);
  entries.push({assetKey:key,file:'validated/'+file,sha256:sha(body),provider,providerSymbol:symbol,id:source.id,status:source.status});
  audit.push({assetKey:key,provider,providerSymbol:symbol,kind:source.instrumentKind,received:rows.length,accepted:accepted.length,rejected:rejected.length,duplicates,firstDate:accepted[0].date,lastDate:accepted.at(-1).date,completeYears:years,gapsOver7Days:gaps,outliersOver10Pct:outliers,evidence});
 }
 fs.writeFileSync(path.join(root,'source-registry.json'),JSON.stringify({schemaVersion:1,version:'commodity-research-v1',entries},null,2));
 fs.writeFileSync(path.join(root,'audit.json'),JSON.stringify({schemaVersion:1,cutoff:'2026-10-13T00:00:00Z',scope:'Research only; no core ranking or HTF activation; raw evidence unchanged',instruments:audit},null,2));
 console.log(JSON.stringify(audit.map(a=>({key:a.assetKey,accepted:a.accepted,rejected:a.rejected,first:a.firstDate,last:a.lastDate,years:a.completeYears.length})),null,2));return audit;
}
module.exports={build,valid};if(require.main===module)build();
