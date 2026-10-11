const assert=require('node:assert/strict'),v3=require('../wwwroot/js/opportunity-scoring-v3.js');
for(const [p,value] of v3.knots)assert.equal(v3.transform(p),value);
assert.equal(v3.transform(87),8.7);assert.equal(v3.transform(NaN),null);
assert.equal(v3.percentile(5,[5,5,5]),50);assert.equal(v3.percentile(5,[5]),50);
assert.equal(v3.percentile(1,[1,2,3]),0);assert.equal(v3.percentile(3,[1,2,3]),100);
assert.equal(v3.percentile(2,[1,2,2,3]),50);
const asset=(key,raw,kind='spot',status='validated-ranking-ready')=>({key,dataStatus:status,mapping:{status,executionKind:kind},
    candidates:[{direction:'up',startsIn:0,scoringV2:{rawScore:raw,components:{S:.3,R:.4,M:.5,C:.5},weights:{S:.3,R:.25,M:.25,C:.2},confidence:{level:'nízká'}}}]});
const assets=[asset('a',3),asset('b',6),asset('c',7),asset('NQ',7,'futures-profile'),asset('gold',10,'spot','data-source-not-validated')];
const before=JSON.stringify(assets.map(a=>a.candidates[0].scoringV2)),cal=v3.calibrate(assets);
assert.deepEqual(cal.reference,[3,6,7]);assert.equal(assets[3].candidates[0].scoringV3.displayScore,10);
assert.equal(assets[4].candidates[0].scoringV3,null);assert.equal(JSON.stringify(assets.map(a=>a.candidates[0].scoringV2)),before);
assert.equal(assets[0].candidates[0].scoringV3.displayScore,1);assert.equal(assets[1].candidates[0].scoringV3.displayScore,5.5);
const tracking=require('./v3-live-tracking.cjs'),ledger={runs:[]},snapshot={exportedAt:'2026-10-11',asOf:'2026-10-11',calibrationV3:cal,assets:[]};
tracking.capture(snapshot,ledger,'2026-10-11T12:00:00Z');tracking.capture(snapshot,ledger,'2026-10-11T13:00:00Z');assert.equal(ledger.runs.length,1);
const r={direction:'down',entryWindow:{start:'2026-10-01',end:'2026-10-03'}},prices=[['2026-10-01',100],['2026-10-02',110],['2026-10-03',90]];
assert.equal(tracking.outcome(r,prices,'2026-10-03'),null);const result=tracking.outcome(r,prices,'2026-10-04');
assert.ok(Math.abs(result.directionalReturn-10)<1e-9);assert.ok(Math.abs(result.MAE-10)<1e-9);assert.ok(Math.abs(result.MFE-10)<1e-9);assert.equal(result.winLoss,'win');
console.log('V3 passed: knots, ties, constant cohorts, aliases, scope, untouched V2, idempotent tracking, pending/completed short outcomes.');
