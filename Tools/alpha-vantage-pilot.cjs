// Isolated evidence collector. No production imports, writes or activation.
const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {pack}=require('./twelve-pilot-bundle.cjs');
const pairs=['EURUSD','GBPUSD','USDCAD','USDCHF'];
function inspect(payload,today){
 const series=payload['Time Series FX (Daily)'];
 if(!series)return {status:'NO_SERIES',message:payload.Information||payload.Note||payload['Error Message']||'No daily series'};
 const entries=Object.entries(series).sort(([a],[b])=>a.localeCompare(b));
 const bars=entries.map(([date,r])=>({date,...Object.fromEntries(['open','high','low','close'].map((k,i)=>[k,Number(r[`${i+1}. ${k}`])]))}));
 const invalid=bars.filter(b=>!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||!['open','high','low','close'].every(k=>Number.isFinite(b[k])&&b[k]>0)||b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close));
 const completed=bars.filter(b=>b.date<today),years=Object.fromEntries(Array.from({length:20},(_,i)=>[2006+i,completed.filter(b=>b.date.startsWith(String(2006+i))).length]));
 return {status:invalid.length?'INVALID_OHLC':completed.length<=100?'INSUFFICIENT_FREE_HISTORY':'HISTORY_RECEIVED',firstDate:bars[0]?.date,lastReceivedDate:bars.at(-1)?.date,lastConservativelyCompletedDate:completed.at(-1)?.date,totalBars:bars.length,completedBars:completed.length,excludedCurrentOrFuture:bars.length-completed.length,invalidBars:invalid.length,years,covers2006to2025:Object.values(years).every(n=>n>=240),metadata:payload['Meta Data'],session:'PROVIDER_DAILY_CUTOFF_UNVERIFIED',bars:completed,invalid};
}
async function main(){
 if(process.argv.includes('--check')){
  assert.equal(inspect({Information:'premium'},'2026-10-12').status,'NO_SERIES');
  const p={'Time Series FX (Daily)':{'2026-10-09':{'1. open':'1','2. high':'2','3. low':'0.5','4. close':'1.5'},'2026-10-12':{'1. open':'1','2. high':'2','3. low':'0.5','4. close':'1'}}};
  assert.equal(inspect(p,'2026-10-12').completedBars,1);assert.equal(inspect(p,'2026-10-12').excludedCurrentOrFuture,1);
  p['Time Series FX (Daily)']['2026-10-09']['4. close']='3';assert.equal(inspect(p,'2026-10-12').invalidBars,1);
  console.log('Parser, incomplete-bar exclusion and fail-closed checks PASS');return;
 }
 const key=process.env.ALPHA_VANTAGE_API_KEY;if(!key)throw Error('Missing repository secret ALPHA_VANTAGE_API_KEY');
 const root='artifacts/alpha-vantage-pilot',out='artifacts/alpha-vantage-encrypted';fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out,{recursive:true});
 const results=[];
 for(const pair of pairs){
  const url=new URL('https://www.alphavantage.co/query');url.search=new URLSearchParams({function:'FX_DAILY',from_symbol:pair.slice(0,3),to_symbol:pair.slice(3),outputsize:'full',apikey:key,datatype:'json'});
  const requestedAt=new Date().toISOString();let result;
  try{
   const response=await fetch(url,{signal:AbortSignal.timeout(45000),redirect:'error'}),body=await response.text();
   // Never persist echoed credentials, including inside provider messages.
   const safe=body.split(key).join('[REDACTED]');
   let payload;try{payload=JSON.parse(safe);}catch{payload={'Error Message':'Non-JSON payload'};}
   fs.writeFileSync(`${root}/${pair}-response.txt`,safe);
   result={pair,requestedAt,httpStatus:response.status,contentType:response.headers.get('content-type'),bytes:Buffer.byteLength(body),sha256:crypto.createHash('sha256').update(body).digest('hex'),...inspect(payload,new Date().toISOString().slice(0,10))};
  }catch{result={pair,requestedAt,status:'ACCESS_ERROR',message:'Request failed or timed out (URL withheld)'};}
  fs.writeFileSync(`${root}/${pair}.json`,JSON.stringify(result,null,2));
  const {bars,invalid,...summary}=result;results.push(summary);
  // Respect the free per-second burst limit; no credential-bearing retries.
  if(pair!==pairs.at(-1))await new Promise(resolve=>setTimeout(resolve,1500));
 }
 const summary={results,productionChanged:false,activationAllowed:false,sessionCutoffVerified:false,requests:4};
 fs.writeFileSync(`${root}/summary.json`,JSON.stringify(summary,null,2));
 fs.writeFileSync(`${out}/evidence.encrypted.json`,JSON.stringify(pack(root,fs.readFileSync('.github/keys/twelve-pilot-public.pem'))));
 // Public log contains only counts/status, never provider messages or credentials.
 console.log(JSON.stringify(results.map(({pair,status,totalBars,firstDate,lastConservativelyCompletedDate,covers2006to2025,httpStatus})=>({pair,status,totalBars,firstDate,lastConservativelyCompletedDate,covers2006to2025,httpStatus}))));
}
module.exports={inspect};
if(require.main===module)main().catch(()=>{console.error('Pilot failed; sensitive error details withheld');process.exitCode=1;});
