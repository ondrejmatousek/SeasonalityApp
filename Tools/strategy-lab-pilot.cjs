// Explicit offline research build. Never imports SQL, changes jobs or publishes signals.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
function build(rawDir,site){
 const manifest=read(path.join(site,'data/manifest.json')),snapshotBytes=fs.readFileSync(path.join(site,manifest.zonePrices.path)),snapshot=JSON.parse(snapshotBytes),meta=read(path.join(rawDir,'captures.json')),instruments=[];
 assert.equal(meta.schemaVersion,1);
 for(const capture of meta.captures){
  assert.match(capture.rawFile,/^[A-Z]{6}-15m\.raw\.json$/);const bytes=fs.readFileSync(path.join(rawDir,capture.rawFile)),raw=JSON.parse(bytes),key=capture.symbol.replace('OANDA:',''),price=snapshot.prices[key];
  assert.equal(raw.success,true);assert.equal(raw.symbol,capture.symbol);assert.equal(raw.interval,'15m');assert.equal(raw.format,'columns');assert.equal(price.provider,'OANDA');assert.equal(price.symbol,capture.symbol);assert.ok(['h4-d1-parity-v1','zone-provider-boundary-v1'].includes(price.h4.validation));
  for(const k of ['t','o','h','l','c','v'])assert.equal(raw.bars[k].length,raw.count);
  const toBar=b=>({t:b.timestamp,end:Date.parse(b.endDate)/1000,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume??null});
  const ny=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',hourCycle:'h23'});
  const h4=price.h4.bars.map(toBar),d1=price.bars.filter(b=>b.timestamp&&b.completionEvidence).map(b=>{
   const end=b.sessionEnd?Date.parse(b.sessionEnd)/1000:b.timestamp+86400;
   assert.equal(ny.format(new Date(b.timestamp*1000)),'17');assert.equal(ny.format(new Date(end*1000)),'17');
   return {t:b.timestamp,end,sessionDate:b.date,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume??null};
  });
  const groups=new Map(),excluded=[];const archivedAt=Date.parse(capture.recordedAt)/1000;
  for(let i=0;i<raw.count;i++){
   const b={t:raw.bars.t[i],end:raw.bars.t[i]+900,open:raw.bars.o[i],high:raw.bars.h[i],low:raw.bars.l[i],close:raw.bars.c[i],volume:raw.bars.v[i]};
   assert.ok(!i||b.t>raw.bars.t[i-1]);assert.ok(b.t%900===0&&b.end<=archivedAt+900);assert.ok(['open','high','low','close'].every(k=>Number.isFinite(b[k])&&b[k]>0));assert.ok(b.low<=Math.min(b.open,b.close)&&b.high>=Math.max(b.open,b.close));
   const parent=h4.find(h=>b.t>=h.t&&b.end<=h.end);
   if(!parent){excluded.push({t:b.t,reason:'NO_ACCEPTED_H4_PARENT'});continue;}
   if(!groups.has(parent.t))groups.set(parent.t,[]);groups.get(parent.t).push(b);
  }
  const m15=[];
  for(const [t,rows]of groups){const parent=h4.find(b=>b.t===t);let reason=null;
   if(rows.length!==16||rows.some((b,i)=>b.t!==t+i*900))reason='INCOMPLETE_H4_GROUP';
   else if(parent.end>archivedAt-60)reason='NOT_ELAPSED';
   else if(rows[0].open!==parent.open||rows.at(-1).close!==parent.close||Math.max(...rows.map(b=>b.high))!==parent.high||Math.min(...rows.map(b=>b.low))!==parent.low)reason='H4_OHLC_MISMATCH';
   if(reason)rows.forEach(b=>excluded.push({t:b.t,reason}));else m15.push(...rows);
  }
  m15.sort((a,b)=>a.t-b.t);assert.ok(m15.length>=100,'Insufficient exact-parity M15 pilot');
  const end=m15.at(-1).end;
  instruments.push({provider:'OANDA',symbol:capture.symbol,timeframe:'M15',validation:'m15-h4-exact-v1',h4Validation:price.h4.validation,rawSha256:sha(bytes),recordedAt:capture.recordedAt,providerHasMore:raw.has_more,providerCount:raw.count,first:new Date(m15[0].t*1000).toISOString(),last:new Date(end*1000).toISOString(),excluded:excluded.length,exclusions:excluded.reduce((a,x)=>(a[x.reason]=(a[x.reason]||0)+1,a),{}),m15,h4:h4.filter(b=>b.end<=end),d1:d1.filter(b=>b.end<=end)});
 }
 return {schemaVersion:1,modelVersion:'strategy-lab-pilot-v1',builtAt:new Date().toISOString(),sourceSnapshotSha256:sha(snapshotBytes),engineSha256:sha(fs.readFileSync('wwwroot/js/strategy-lab.js')),detectorSha256:sha(fs.readFileSync('wwwroot/js/trade-zones.js')),researchOnly:true,selectionEligible:false,warning:'Krátká M15 historie a pouze tři předem vybrané páry. Bez nedotčeného holdoutu a bez brokerových nákladů nelze určit obchodovatelnou vítěznou strategii.',instruments};
}
module.exports={build};
if(require.main===module){const result=build(process.argv[2],process.argv[3]);const output=process.argv[4];if(!output)throw Error('Output required');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result));console.log(JSON.stringify({output,instruments:result.instruments.map(x=>({symbol:x.symbol,m15:x.m15.length,first:x.first,last:x.last,excluded:x.excluded,exclusions:x.exclusions})),selectionEligible:false}));}
