const assert=require('node:assert/strict'),L=require('../wwwroot/js/strategy-lab.js'),Z=require('../wwwroot/js/trade-zones.js');
assert.equal(L.matrix().length,24);assert.equal(L.matrix('ema').length,8);
assert.ok(L.matrix().every(c=>!Object.hasOwn(c,'fast')));assert.throws(()=>L.settings({fast:20}),/EMA/);assert.throws(()=>L.settings({futureFilter:true}));
const t=Date.parse('2026-10-06T08:00Z')/1000;
const bar=(i,extra={})=>({t:t+i*900,end:t+(i+1)*900,open:100,high:100.4,low:99.6,close:100,...extra});
const source=(signalAt=0,stop=99,direction=1)=>({next:i=>({signal:i===signalAt?{known:t+(i+1)*900,stop,direction,reference:{test:true}}:null})});
let bars=[bar(0),bar(1),bar(2,{high:103})];
let r=L.simulate(bars,{entryLagBars:1,spreadBps:0,slippageBps:0},source());assert.equal(r.trades[0].enteredAt,bars[2].t);assert.equal(r.trades[0].grossR,2);
r=L.simulate([bar(0),bar(1,{high:103,low:98})],{entryLagBars:0,spreadBps:0,slippageBps:0},source());assert.equal(r.trades[0].grossR,-1);assert.match(r.trades[0].exitReason,/SL i TP/);
r=L.simulate([bar(0),bar(1),bar(2,{open:95,high:96,low:94,close:95})],{entryLagBars:0,spreadBps:0,slippageBps:0},source());assert.equal(r.trades[0].grossR,-5,'Stop gap filled at adverse open, never ideal stop');
r=L.simulate([bar(0),bar(1),bar(3,{high:103})],{entryLagBars:0},source());assert.equal(r.trades.length,0);assert.equal(r.unresolved.length,1);assert.equal(r.audit.gaps,1);
r=L.simulate(bars,{entryLagBars:0,spreadBps:10,commissionBps:2,slippageBps:1},source());assert.ok(r.trades[0].netR<r.trades[0].grossR);assert.ok(Math.abs(r.trades[0].costR-.14)<1e-10);
r=L.simulate([bar(0),bar(1,{low:97,high:100.4})],{entryLagBars:0,spreadBps:0,slippageBps:0},source(0,101,-1));assert.equal(r.trades[0].grossR,2,'Short target symmetry');
const waiting=()=>({next:i=>({signal:i===0?{known:bar(0).end,stop:98.5,direction:1,zone:{type:'demand',lower:90,upper:100},reference:{test:true}}:null})});
r=L.simulate([bar(0),bar(1,{low:97.5}),bar(2)],{entryLagBars:1},waiting());assert.equal(r.trades.length,0);assert.equal(r.audit.cancelledEntries,1,'25% waiting wick cancels before future entry');
r=L.simulate([bar(0),bar(1),bar(2,{low:97.5})],{entryLagBars:1},waiting());assert.equal(r.trades.length,1);assert.equal(r.trades[0].grossR,-1,'Entry uses bar open, never its future invalidating wick');
assert.equal(L.penetration({type:'demand',lower:90,upper:100},{low:97.5}),.25);
assert.equal(L.penetration({type:'supply',lower:90,upper:100},{high:92.5}),.25);
assert.throws(()=>L.validate([bar(1),bar(0)],900));
const sampled=Array.from({length:25},(_,i)=>bar(i,{open:102,high:103,low:101.5,close:102}));
sampled[15]=bar(15,{open:102,high:103,low:100.5,close:102});sampled[18]=bar(18,{open:103,high:104,low:99,close:102});sampled[21]=bar(21,{open:102,high:110,low:101,close:108});
const zone={id:'test-h4',timeframe:'H4',known:sampled[18].t,baseStart:t,confirmedAt:new Date(sampled[18].t*1000).toISOString(),lower:90,upper:100,type:'demand',bos:{state:'yes'}};
const prepared={data:{m15:sampled},h4:[],zones:[zone],atr:L.atr(sampled)};
r=L.run(prepared,{model:'h4-sfp',spreadBps:0,slippageBps:0});assert.equal(r.trades.length,1,'Known swing + first valid zone return emits trade');assert.equal(r.trades[0].reference.swingKnownAt,new Date(sampled[18].t*1000).toISOString());
const broken=structuredClone(prepared);broken.data.m15[18].low=97.5;
assert.equal(L.run(broken,{model:'h4-sfp'}).trades.length,0,'25% trigger wick invalidates before signal');
const noBos=structuredClone(prepared);noBos.zones[0].bos.state='unknown';assert.equal(L.run(noBos,{model:'h4-sfp',bos:true}).trades.length,0);
const future=structuredClone(prepared);future.zones[0].known=sampled[19].t;assert.equal(L.run(future,{model:'h4-sfp'}).trades.length,0,'Future HTF zone cannot authorize earlier M15 sweep');
const consumed=structuredClone(prepared);consumed.zones[0].known=sampled[16].t;consumed.data.m15[17].low=99.8;assert.equal(L.run(consumed,{model:'h4-sfp'}).trades.length,0,'Earlier first touch is not reused');
assert.deepEqual(prepared.zones,[zone],'Replay does not mutate formation evidence');
if(process.argv[2]){
 const data=require(require('node:path').resolve(process.argv[2]));assert.equal(data.selectionEligible,false);
 for(const instrument of data.instruments){
  const pristine=JSON.stringify(instrument),p=L.prepare(instrument),cut=instrument.m15[Math.floor(instrument.m15.length*.6/16)*16-1].end;
  const tampered=structuredClone(instrument);tampered.m15[0].high=tampered.h4.find(b=>b.t===tampered.m15[0].t).high+.001;assert.throws(()=>L.prepare(tampered),/M15\/H4/,'Worker independently rechecks normalized parity');
  const prefix={...instrument,m15:instrument.m15.filter(b=>b.end<=cut),h4:instrument.h4.filter(b=>b.end<=cut),d1:instrument.d1.filter(b=>b.end<=cut)};
  const q=L.prepare(prefix);
  assert.deepEqual(p.zones.filter(z=>z.known<=cut),q.zones,'Historical formations do not depend on later candles or survival');
  for(const cfg of [...L.matrix().filter((_,i)=>i%8===0),L.matrix('ema')[0]]){
   const full=L.run(p,cfg),partial=L.run(q,cfg);assert.deepEqual(full.trades.filter(x=>x.exitedAt<=cut),partial.trades,'Prefix replay matches full-history decisions');
   for(const trade of full.trades){assert.ok(trade.enteredAt>=trade.signalAt+900);if(trade.reference.zoneKnownAt)assert.ok(Date.parse(trade.reference.zoneKnownAt)/1000<=trade.signalAt);}
  }
  assert.equal(JSON.stringify(instrument),pristine);
 }
}
console.log('PASS: isolated EMA, 24 zone / 8 EMA variants, causal formations, confirmed SFP, strict 25% mitigation, entry delay, adverse fills, costs, gaps, immutable inputs and prefix/no-lookahead replay.');
