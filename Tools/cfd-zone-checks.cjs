const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const universe=require('../wwwroot/js/cfd-instruments.js'),projection=require('./cfd-zone-snapshot.cjs'),zones=require('../wwwroot/js/trade-zones.js'),candles=require('../wwwroot/js/market-candles.js');
assert.equal(universe.keys.length,50);assert.equal(new Set(universe.keys).size,50);assert.equal(universe.extraFx.length,11);
for(const [alias,key]of Object.entries(universe.aliases))assert.equal(universe.resolve(alias),key);
const at=Date.parse('2026-10-18T12:00Z'),start=Date.parse('2026-10-15T21:00Z')/1000;
assert.ok(projection.dailyComplete('OANDA:USDHKD',start,null,at));assert.ok(!projection.dailyComplete('OANDA:USDHKD',start-86400,null,at));assert.ok(!projection.allowed('OANDA:EURUSD','1D'));assert.ok(!projection.allowed('CRYPTO:BTCUSD','4h'));
function source(){const raw={success:true,symbol:'OANDA:USDHKD',interval:'1D',format:'rows',count:2,bars:[{t:start-86400,o:7.75,h:7.8,l:7.7,c:7.75,v:null},{t:start,o:7.75,h:7.8,l:7.7,c:7.75,v:100}]},payload=JSON.stringify({schemaVersion:1,fetchedAt:new Date(at).toISOString(),captures:[{capturedAt:new Date(at).toISOString(),rawJson:JSON.stringify(raw)}]}),id=crypto.createHash('sha256').update(payload).digest('hex');return {schemaVersion:1,source:'Azure SQL market_zones',rule:'zone-provider-boundary-v1',builtAt:new Date(at).toISOString(),receipts:[{receiptId:id,payload,receivedAt:new Date(at).toISOString()}],rows:raw.bars.map(b=>({symbol:raw.symbol,interval:'1D',timestamp:b.t,open:b.o,high:b.h,low:b.l,close:b.c,volume:b.v,receiptId:id}))};}
assert.equal(projection.validate(source()).get('OANDA:USDHKD1D').length,2);
{const s=source();s.receipts[0].recoveryValidatedAt=s.receipts[0].receivedAt;s.receipts[0].recoverySourceSha256=s.receipts[0].receiptId;s.receipts[0].receivedAt='2026-10-22T12:00:00Z';assert.equal(projection.validate(s).get('OANDA:USDHKD1D').length,2);s.receipts[0].recoverySourceSha256='0'.repeat(64);assert.throws(()=>projection.validate(s));}
{const s=source();s.receipts[0].receivedAt='2026-10-22T12:00:00Z';assert.throws(()=>projection.validate(s),'Normal live freshness must remain enforced');}
for(const mutate of [s=>s.rows[0].close=7.76,s=>s.receipts[0].payload+=' ',s=>s.rows[0].symbol='OANDA:EURUSD',s=>s.rows.push(s.rows[0])]){const s=source();mutate(s);assert.throws(()=>projection.validate(s));}
if(process.argv[2]){
 const site=path.resolve(process.argv[2]),read=p=>JSON.parse(fs.readFileSync(path.join(site,p.replace(/^\//,'')),'utf8')),manifest=read('data/manifest.json'),snapshot=read(manifest.zonePrices.path);assert.equal(snapshot.cfdCoverage.version,universe.version);
 const result=[];for(const key of universe.keys){const p=snapshot.prices[key];assert.ok(p,'Every requested key must be reported, including unavailable');if(p.status!=='ready'){result.push({key,status:'unavailable',reason:p.error});continue;}
  assert.ok(p.bars.length>=100&&p.bars.every(b=>candles.valid(b)&&b.date<snapshot.asOf));assert.equal(new Set(p.bars.map(b=>b.date)).size,p.bars.length);
  if(Object.hasOwn(universe.crypto,key)){assert.equal(p.provider,'Yahoo Finance');assert.equal(p.symbol,universe.crypto[key]);}
  if(universe.extraFx.includes(key)||key==='PLATINUM'){assert.equal(p.provider,'OANDA');assert.equal(p.contextCompatible,false);}
  const d=zones.detect(p,'D1',snapshot.asOf),w=zones.detect(p,'W1',snapshot.asOf),h=p.h4?.status==='ready'?zones.detect(p.h4,'H4',p.h4.asOfUtc):[];
  if(p.h4?.validation==='zone-provider-boundary-v1')assert.ok(p.h4.bars.every(b=>b.timestamp+14400<=Date.parse(p.h4.asOfUtc)/1000));
  result.push({key,status:'evaluated',D1:d.length,W1:w.length,H4:h.length,provider:p.provider,symbol:p.symbol});
 }
 console.log(JSON.stringify({watchlist:50,evaluated:result.filter(r=>r.status==='evaluated').length,instruments:result}));
}
console.log('PASS CFD watchlist uniqueness, aliases, provider separation, exact raw SQL evidence, boundary checks and opportunity detection. No minimum number of zones is manufactured.');
