const assert=require('node:assert/strict'),crypto=require('node:crypto'),E=require('../wwwroot/js/h4-paper.js'),B=require('../wwwroot/js/h4-backtest.js'),sha=require('../wwwroot/js/backtest-sha256.js');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
for(const s of ['', 'abc', 'Žluťoučký kůň 😀', 'x'.repeat(100000)])assert.equal(sha(s),hash(s),'Browser SHA-256 must equal native crypto');
const t0=Date.parse('2026-01-05T01:00:00Z')/1000,iso=t=>new Date(t*1000).toISOString();
function bars(count,offset=0){let seed=173,previous=1000;return Array.from({length:count},(_,i)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;const t=t0+(i+offset)*14400,open=previous,close=open+(seed/4294967296-.5)*8;previous=close;return {date:iso(t),timestamp:t,endDate:iso(t+14400),open,close,low:Math.min(open,close)-.2,high:Math.max(open,close)+.2,volume:100+i%9};});}
const fixture=rows=>({asOf:'2026-04-01',prices:{TEST:{h4:{status:'ready',provider:'OANDA',symbol:'OANDA:TEST',timeframe:'H4',validation:'h4-d1-parity-v1',asOfUtc:rows.at(-1).endDate,bars:rows}}}}),rows=bars(360),snapshot=fixture(rows),path='/data/screener/zone-prices.'+'a'.repeat(20)+'.json',input={snapshot,path,sha256:hash(JSON.stringify(snapshot)),keys:['TEST']},before=JSON.stringify(snapshot);
const r=B.run(input);assert.equal(JSON.stringify(snapshot),before,'No source mutation');assert.equal(r.coverage[0].segments[0].checks,161);assert.equal(r.model,E.model);assert.deepEqual(r.config,E.config);assert.ok(r.setups.length>0);assert.ok(r.summary.closed>0);
// Direct parity with the unchanged prospective engine at every simulated close.
let state=null;for(let i=199;i<rows.length;i++){const b=rows[i],h=snapshot.prices.TEST.h4,price={status:'ready',provider:h.provider,symbol:h.symbol,timeframe:'H4',validation:h.validation,bars:rows.slice(0,i+1),asOfUtc:b.endDate,latestClose:b.close,latestDate:b.date};state=E.update(state,{asOf:b.endDate,revision:input.sha256,path,prices:{TEST:{h4:price}}},b.endDate,hash);}
assert.deepEqual(r.setups.map(({backtestSegment,backtestEndReason,...s})=>s),state.setups);assert.deepEqual(r.events.map(({backtestKey,backtestSegment,...e})=>e),state.events);
for(const s of r.setups){assert.ok(Date.parse(s.frozen.zone.confirmedAt)<=Date.parse(s.frozen.registeredAt));if(s.entryBarStart)assert.ok(Date.parse(s.entryBarStart)>=Date.parse(s.frozen.registeredAt),'No fill in detection candle');}
// Future rows may change arbitrarily without changing an earlier replay.
const to=rows[280].endDate.slice(0,10),cutoff=Date.parse(to+'T23:59:59.999Z'),mutated=structuredClone(input);for(const b of mutated.snapshot.prices.TEST.h4.bars)if(Date.parse(b.endDate)>cutoff)Object.assign(b,{open:999,close:998,low:997,high:1000});assert.deepEqual(B.run({...input,to}),B.run({...mutated,to}),'Future candle invariance');
const gap=B.run({...input,snapshot:fixture([...bars(360),...bars(260,400)])});assert.equal(gap.coverage[0].gaps.length,1);assert.equal(gap.coverage[0].segments[1].checks,61);assert.ok(gap.setups.filter(s=>s.backtestSegment===1).every(s=>Date.parse(s.frozen.registeredAt)>=Date.parse(bars(260,400)[199].endDate)),'Warm up anew beyond missing candles');assert.ok(gap.setups.filter(s=>s.backtestEndReason==='HISTORY_GAP').every(s=>s.status==='needs_data'));
assert.equal(B.run({...input,snapshot:fixture(bars(100))}).setups.length,0);assert.equal(B.run({...input,from:'2027-01-01'}).setups.length,0);assert.throws(()=>B.run({...input,from:'2026-02-30'}));assert.throws(()=>B.run({...input,from:'2026-03-01',to:'2026-01-01'}));assert.throws(()=>B.run({...input,keys:['TEST','TEST']}));
const bad=structuredClone(input);bad.snapshot.prices.TEST.h4.bars[10].high=0;assert.throws(()=>B.run(bad),/Neplatné/);const duplicate=structuredClone(input);duplicate.snapshot.prices.TEST.h4.bars.push({...rows[20]});assert.throws(()=>B.run(duplicate),/Duplicit/);
assert.deepEqual(B.run(input),r,'Deterministic replay');console.log(JSON.stringify({checks:'PASS exact engine parity, native SHA, no future leakage/fill, segmentation, warmup, unresolved ends, bad data rejection, immutable sources and deterministic replay',setups:r.setups.length,closed:r.summary.closed}));
// Recompute each target from candles, including subsequent admissions.
const outcomes=[];for(const rr of [1,2,2.5,3]){
 const variant=B.run({...input,rr}),engine=E.forBacktest(rr);outcomes.push(JSON.stringify(variant.summary));
 assert.equal(variant.config.rr,rr);assert.equal(variant.selection.rr,rr);assert.ok(variant.setups.length>0);
 for(const s of variant.setups){const f=s.frozen;assert.equal(f.config.rr,rr);assert.ok(Math.abs(Math.abs(f.tp-f.entry)/f.risk-rr)<1e-10);if(s.status==='tp')assert.ok(Math.abs(s.grossR-rr)<1e-10);}
 for(const type of ['supply','demand']){const p=engine.plan({type,lower:100,upper:105});assert.ok(Math.abs(Math.abs(p.tp-p.entry)/p.risk-rr)<1e-10);}
 if(rr!==2)assert.throws(()=>E.update(engine.empty(rows[199].endDate),{},rows[199].endDate,hash),/methodology changed/,'Backtest model cannot overwrite live ledger');
}
assert.ok(new Set(outcomes).size>1,'RRR must change execution results, not just labels');
for(const rr of [0,-1,1.5,4,'2',null,NaN])assert.throws(()=>B.run({...input,rr}),/RRR/);
assert.deepEqual(B.run({...input,rr:2}),r);assert.equal(E.config.rr,2);assert.equal(E.model,'fm-h4-touch-2r-v1');
// Frozen complete-state digest from deployed 1182945, generated with identical inputs.
assert.equal(hash(JSON.stringify(state)),'cacdf7a568a84e9e864806899bc01ec74e27d2386ad1164f6201040e5e046f21','Original live states/events remain exactly unchanged');
console.log('PASS fixed RRR 1/2/2.5/3, real exits, both directions, frozen audit, model isolation, invalid target rejection and exact deployed 2R ledger parity');
