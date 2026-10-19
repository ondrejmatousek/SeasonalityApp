// Frozen research snapshot only. Never writes SQL, invokes providers or changes a schedule.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),F=require('../wwwroot/js/fm-order-blocks.js');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function prepare(raw,symbol,asOf){
 if(raw.success!==true||raw.symbol!==symbol||raw.interval!=='4h'||raw.format!=='columns'||!Number.isInteger(raw.count)||raw.count<2)throw Error('Provider shape/symbol/timeframe mismatch');
 for(const k of ['t','o','h','l','c','v'])if(!Array.isArray(raw.bars[k])||raw.bars[k].length!==raw.count)throw Error('Provider column lengths');
 const a=raw.bars,all=a.t.map((t,i)=>({t,end:Math.min(t+14400,a.t[i+1]??t+14400),open:a.o[i],high:a.h[i],low:a.l[i],close:a.c[i],volume:a.v[i]}));F.validate(all);
 // The provider explicitly warns that its last candle may still be forming.
 // Exclude it conservatively, regardless of an elapsed local timer.
 const bars=all.filter((b,i)=>i<all.length-1&&b.end<=asOf),excluded=all.length-bars.length;
 if(bars.length<96)throw Error('Insufficient closed H4 for ATR96');return {bars,excluded,rawCount:raw.count,formingExcluded:1,first:bars[0].t,lastClosedAt:bars.at(-1).end};
}
const references=[
 {id:'A',symbol:'OANDA:XAUUSD',type:'supply',originTime:Date.parse('2026-09-25T09:00:00Z')/1000,confirmationReported:'2026-09-27T21:00:00Z',lower:4289.610,upper:4315.795,ratio:2.32,origin:'classic',status:'reported-unverified'},
 {id:'B',symbol:'BITSTAMP:BTCUSD',type:'supply',originTime:Date.parse('2026-10-14T00:00:00Z')/1000,confirmationReported:'2026-10-14T12:00:00Z',lower:83093.57,upper:83879.98,ratio:2.91,origin:'range',status:'reported-unverified'},
 {id:'C',symbol:'CME_MINI:NQZ2026',type:'supply',originTime:Date.parse('2026-10-14T06:00:00Z')/1000,confirmationReported:'2026-10-14T10:00:00Z',lower:30705.25,upper:30861.75,ratio:2.27,origin:'range',status:'reported-unverified'}
];
function compare(reference,instruments){
 const item=instruments.find(x=>x.symbol===reference.symbol);
 if(!item)return {reference,comparable:false,reason:'Different/unavailable exact feed. Never transfer BITSTAMP levels to BYBIT.'};
 if(reference.origin==='range')return {reference,comparable:false,reason:'Range-breakout algorithm is not specified by the supplied Pine. No proxy substituted.'};
 if(!item.bars)return {reference,comparable:false,reason:'Source unavailable/invalid.'};
 const base=item.bars.find(b=>b.t===reference.originTime),result=F.run({symbol:item.symbol,timeframe:'H4',asOf:item.asOf,bars:item.bars});
 const matches=result.formations.filter(z=>z.kind==='classic'&&z.type===reference.type&&z.originTime===reference.originTime);
 return {reference,comparable:false,reason:'Original report lacks exact asOf, source OHLC hash/first loaded bar and confirmation start-vs-close semantics. Diagnostic comparison only.',base:base??null,baseBoundsEqual:base?base.low===reference.lower&&base.high===reference.upper:null,detected:matches.map(z=>({top:z.top,bot:z.bot,confirmedAt:z.confirmedAt,ratio:z.displacementRatio})),exactZoneFound:matches.some(z=>z.bot===reference.lower&&z.top===reference.upper)};
}
function build(rawDir,asOf,recordedAt){
 const instruments=[];for(const symbol of ['OANDA:EURUSD','OANDA:XAUUSD','CME_MINI:NQZ2026','BYBIT:BTCUSDT.P']){
  const file=path.join(rawDir,symbol.replace(/[^a-z0-9]/gi,'-')+'.raw.json'),bytes=fs.readFileSync(file);
  try{const raw=JSON.parse(bytes),p=prepare(raw,symbol,asOf);instruments.push({symbol,timeframe:'H4',asOf,recordedAt,rawSha256:sha(bytes),providerNotice:raw.notice,...p});}
  catch(e){instruments.push({symbol,timeframe:'H4',asOf,rawSha256:sha(bytes),status:'UNVERIFIED — NO TRADE',error:e.message});}
 }
 return {schemaVersion:1,engineVersion:F.version,engineSha256:sha(fs.readFileSync(path.join(__dirname,'../wwwroot/js/fm-order-blocks.js'))),pineSha256:sha(fs.readFileSync(path.join(__dirname,'../docs/research/market-structure-order-blocks-fm.pine'))),exportSha256:sha(fs.readFileSync(path.join(__dirname,'../docs/research/daily-outlook-work-export-2026-10-19.md'))),researchOnly:true,pineParityVerified:false,selectionEligible:false,asOf,recordedAt,completionPolicy:'Nominal H4 end or earlier next provider start; forming last excluded. No independent exchange-calendar verification.',assumptions:['Default Pine inputs, not independently confirmed user overrides.','Rightmost equal pivot extreme; TradingView golden output verification pending.','ATR seed, pivots and caps depend on the same loaded history start as Pine.','CME NQZ2026 is kept as the explicit contract, never rolled/spliced; expiry and provider RTH session calendar not independently validated.','No M15/M5/security-table replication, entry/SL/TP, range-breakout algorithm or Work ranking.'],instruments,references:references.map(r=>compare(r,instruments))};
}
module.exports={prepare,compare,build,references};
if(require.main===module){
 const [rawDir,output,asOfText,recordedAt]=process.argv.slice(2);const asOf=Date.parse(asOfText)/1000;
 if(!rawDir||!output||!Number.isSafeInteger(asOf)||!Number.isFinite(Date.parse(recordedAt)))throw Error('Usage: raw-dir new-output asOf-UTC recordedAt-UTC');
 const report=build(rawDir,asOf,recordedAt);fs.writeFileSync(output,JSON.stringify(report),{flag:'wx'});
 console.log(JSON.stringify({output,researchOnly:true,comparableReferences:report.references.filter(x=>x.comparable).length,instruments:report.instruments.map(i=>({symbol:i.symbol,bars:i.bars?.length??0,excluded:i.excluded,error:i.error}))}));
}
