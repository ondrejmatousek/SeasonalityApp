const assert=require('node:assert/strict'),{createHash}=require('node:crypto'),R=require('./h4-paper-research.cjs'),S=require('./h4-paper-research-engine.cjs');
const hash=x=>createHash('sha256').update(x).digest('hex'),copy=x=>JSON.parse(JSON.stringify(x)),t0=Date.parse('2026-01-01T00:00:00Z')/1000,iso=t=>new Date(t*1000).toISOString();
function ledger(setups=[],revision=1){return {revision,stateSha256:hash(JSON.stringify(setups)),state:{model:R.plan.baseline,setups}};}
function trade(i,gross=2,day=i){return {id:hash('trade'+i),frozen:{registeredAt:iso(t0+day*86400+60),zone:{bos:{state:i%2?'yes':'no'},volume:{state:i%3?'high':'normal'}}},status:gross>0?'tp':'sl',enteredAt:iso(t0+day*86400+120),resolvedAt:iso(t0+day*86400+3600),grossR:gross,costR:.1,netR:gross-.1};}
const empty=ledger(),start=iso(t0),sources={prices:{}},init=R.update(null,empty,sources,start,hash);
assert.equal(init.report.progress,0);assert.equal(init.report.availability.sfp15.status,'missing_data');
const old=trade(-1);let state=R.update(init,ledger([old],2),sources,iso(t0+100),hash);assert.equal(state.report.progress,0);assert.equal(state.report.exploratory[0].n,1);
const rows=Array.from({length:100},(_,i)=>trade(i+1)),baseline=ledger(rows,3),before=JSON.stringify(baseline);
state=R.update(state,baseline,sources,iso(t0+200*86400),hash);
assert.equal(JSON.stringify(baseline),before,'Research cannot change baseline');assert.equal(state.report.progress,100);assert.equal(state.checkpoints.length,1);assert.ok(state.checkpoints[0].candidateId);assert.equal(state.checkpoints[0].groups[0].n,100);
const frozenCheckpoint=JSON.stringify(state.checkpoints[0]);state=R.update(state,baseline,sources,iso(t0+201*86400),hash);assert.equal(JSON.stringify(state.checkpoints[0]),frozenCheckpoint,'Checkpoint saved once');assert.equal(state.checkpoints.length,1);
const lateOld=trade(999);lateOld.frozen.registeredAt=iso(t0+10);lateOld.enteredAt=iso(t0+200);lateOld.resolvedAt=iso(t0+202*86400);
const validation=Array.from({length:100},(_,i)=>trade(1000+i,2,210+i));
state=R.update(state,ledger([...rows,lateOld,...validation],4),sources,iso(t0+400*86400),hash);
assert.equal(state.report.validation[0].n,100,'Older registered trades closing later are not holdout');assert.equal(state.checkpoints.length,2);assert.equal(state.checkpoints[1].passed,true);assert.equal(JSON.stringify(state.checkpoints[0]),frozenCheckpoint);
assert.throws(()=>R.update(state,ledger([],1),sources,iso(t0+401*86400),hash),/revision/);
assert.throws(()=>R.update(state,ledger([],4),sources,iso(t0+401*86400),hash),/identity/);
assert.throws(()=>R.update(init,ledger([trade(9999)],2),sources,iso(t0+1),hash),/Future/);
const changed=copy(init);changed.plan.minGroup=1;assert.throws(()=>R.update(changed,empty,sources,start,hash),/plan/);
const invalid=trade(10);invalid.costR=undefined;assert.equal(R.stats([invalid],'test').n,0);assert.equal(R.stats([invalid],'test').invalidClosed,1);
const sameDay=Array.from({length:100},(_,i)=>trade(i,2,1));assert.equal(R.stats(sameDay,'test').mean95,null,'100 correlated observations on one day are not 100 independent samples');
assert.deepEqual(R.stats(rows,'test'),R.stats([...rows].reverse(),'test'),'Deterministic uncertainty and conservative ties');
const summary=R.stats([trade(1,2),trade(2,-1)],'test');assert.equal(summary.n,2);assert.ok(Math.abs(summary.meanR-.4)<1e-12);assert.equal(summary.drawdownR,1.1);assert.ok(summary.profitFactor>1);assert.equal(R.stats([trade(1)],'x').profitFactor,null);
function bar(t,o,h,l,c,d=14400){return {timestamp:t,date:iso(t),endDate:iso(t+d),open:o,high:h,low:l,close:c};}
const b0=bar(t0,105,107,103,105);
function source(bars){return {prices:{TEST:{h4:{status:'ready',provider:'OANDA',symbol:'OANDA:TEST',asOfUtc:bars.at(-1).endDate,bars}}}};}
function waiting(side='long'){return {id:hash(side),status:'waiting',frozen:{key:'TEST',symbol:'OANDA:TEST',provider:'OANDA',side,registeredAt:b0.endDate,zone:{type:side==='long'?'demand':'supply',lower:side==='long'?95:110,upper:side==='long'?100:115,bos:{state:'no'},volume:{state:'normal'}}}};}
function shadow(sides=['long']){const s={startedAt:b0.endDate,plan:R.plan,simulations:[],events:[]};S.update(s,ledger(sides.map(waiting)),source([b0]),b0.endDate,hash);return s;}
let sim=shadow();assert.equal(sim.simulations.length,2);assert.equal(sim.simulations.find(s=>s.frozen.variant==='tp3r').frozen.tp,115.75);assert.equal(sim.simulations.find(s=>s.frozen.variant==='sl10').frozen.sl,94.5);
const b1=bar(t0+14400,105,112,99,111);S.update(sim,ledger([waiting()]),source([b0,b1]),b1.endDate,hash);
assert.equal(sim.simulations.find(s=>s.frozen.variant==='tp3r').status,'open');assert.equal(sim.simulations.find(s=>s.frozen.variant==='sl10').status,'tp','Separate geometry gives a different outcome');
const b2=bar(t0+28800,111,117,109,116);S.update(sim,ledger([waiting()]),source([b0,b1,b2]),b2.endDate,hash);assert.equal(sim.simulations.find(s=>s.frozen.variant==='tp3r').status,'tp');const events=JSON.stringify(sim.events);S.update(sim,ledger([waiting()]),source([b0,b1,b2]),b2.endDate,hash);assert.equal(JSON.stringify(sim.events),events,'No double fills');
let gap=shadow();S.update(gap,ledger([waiting()]),source([b0,bar(t0+28800,105,112,99,111)]),iso(t0+43200),hash);assert.ok(gap.simulations.every(s=>s.status==='needs_data'));
let revised=shadow();S.update(revised,ledger([waiting()]),source([{...b0,open:106},b1]),b1.endDate,hash);assert.ok(revised.simulations.every(s=>s.reason==='PREVIOUS_BAR_REVISED'));
let oco=shadow(['long','short']);S.update(oco,ledger([waiting(),waiting('short')]),source([b0,b1]),b1.endDate,hash);assert.ok(oco.simulations.every(s=>s.status==='ambiguous'));
// SFP is a separate next-open model, and refuses unverified M15.
const m15=Array.from({length:5},(_,i)=>bar(t0+i*900,101,103,i===2?98:99,101,900));
m15.push(bar(t0+4500,101,103,99,101,900),bar(t0+5400,101,102,97,100.5,900),bar(t0+6300,101,104,100,103,900));
const make15=bars=>({prices:{TEST:{m15:{status:'ready',provider:'OANDA',symbol:'OANDA:TEST',timeframe:'M15',asOfUtc:bars.at(-1).endDate,rawSha256:hash('synthetic-only'),validation:{providerBoundaryValidated:true,completedOnly:true,rule:'oanda-m15-boundary-v1'},bars}}}});
const parent=waiting();parent.frozen.registeredAt=m15[4].endDate;const sfp={startedAt:m15[4].endDate,plan:R.plan,simulations:[],events:[]};S.update(sfp,ledger([parent]),make15(m15.slice(0,5)),m15[4].endDate,hash);assert.equal(sfp.simulations.length,1);
S.update(sfp,ledger([parent]),make15(m15),m15.at(-1).endDate,hash);assert.equal(sfp.simulations[0].status,'open');assert.equal(sfp.simulations[0].fill.entry,101);assert.equal(sfp.events.filter(e=>e.kind==='SFP_CONFIRMED').length,1);
const unverified=make15(m15);unverified.prices.TEST.m15.validation.providerBoundaryValidated=false;assert.equal(S.series(unverified.prices.TEST,S.variants[2],m15.at(-1).endDate),null);
console.log('PASS independent research: frozen baseline, pre-registration, 100/next-100 reports, holdout registration boundary, clustered uncertainty, same-class groups, 3R/wider-stop independent OCO/fills, gaps/revisions, M15 verified-only SFP next-open and idempotency.');
module.exports={init,state,sim,ledger,source,hash,trade,start,t0,iso};
