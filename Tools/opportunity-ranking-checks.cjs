const assert=require('node:assert/strict'),ranking=require('../wwwroot/js/opportunity-ranking.js');
const asOf='2026-10-10',stats=(k,n,median=1)=>({successes:k,count:n,median}),empty=stats(0,0,null);
const asset={lastDate:'2026-10-09'};
function candidate(s=stats(8,10),v=stats(6,8),cot=stats(7,8),baseline=stats(8,10)){
    return {direction:'up',cotReference:{date:'2026-09-29',index:80},validation:v,
        histories:{10:{seasonal:s,cot,baseline}}};
}
const rank=c=>ranking.rank(asset,c,{asOf});
assert.equal(Object.values(ranking.weights).reduce((a,b)=>a+b),100);
const base=rank(candidate());assert.ok(base.value>=7&&base.value<=10);assert.equal(base.capped,false);
assert.deepEqual(rank(candidate()),base,'Deterministic fixed-weight calculation');
assert.equal(base.components.length,4);
const calculated=1+9*base.components.reduce((a,b)=>a+b.contribution,0)/100;
assert.equal(base.value,Math.round(calculated*10)/10);
assert.ok(rank(candidate(stats(9,10))).value>=base.value,'Higher frequency cannot reduce support at fixed sample');
assert.ok(rank(candidate(stats(8,10),stats(6,8),stats(3,3))).value<base.value,'Three successes must not beat supported larger sample');
assert.ok(rank(candidate(stats(8,10),stats(6,8),empty)).value<=7,'No similar cases cannot get top score');
assert.ok(rank(candidate(stats(10,10),stats(8,8),stats(1,1))).value<rank(candidate(stats(10,10),stats(8,8),stats(6,6))).value,'Gradual ceiling must distinguish one from six similar years');
assert.ok(rank(candidate(stats(8,10),stats(6,8),stats(2,3,-1))).value<=7);
assert.ok(rank(candidate(stats(10,10),stats(4,8,-1),stats(8,8))).value<=5.5,'Validation conflict caps score');
assert.ok(rank(candidate(stats(10,10),stats(8,8),stats(3,8,-1))).value<=6.5,'Sufficient adverse COT must limit ranking');
assert.ok(rank(candidate(stats(4,10,-1),stats(8,8),stats(8,8))).value<=5.5,'Seasonal conflict cannot earn strong score');
const missing=candidate();missing.cotReference=null;assert.ok(rank(missing).value<=6);
const unavailable=candidate();unavailable.cotReference.date='2026-10-06';assert.ok(!rank(unavailable).currentCot,'No future/unpublished reference');
const stale=candidate();stale.cotReference.date='2026-09-01';assert.ok(!rank(stale).currentCot);
assert.ok(ranking.rank({lastDate:'2026-09-20'},candidate(),{asOf}).value<=5);
assert.ok(ranking.rank(asset,candidate(),{asOf,today:'2026-10-13'}).value<=5);
assert.equal(rank(candidate(empty,empty,empty,empty)).value,1);
assert.ok(rank(candidate(stats(3,3),stats(3,3),stats(3,3),stats(3,3))).value<=5);
assert.ok(rank(candidate(stats(0,10,-1),stats(0,8,-1),stats(0,8,-1))).value<4);
const down=candidate(stats(8,10,-1),stats(6,8,-1),stats(7,8,-1));down.direction='down';assert.equal(rank(down).value,base.value);
assert.throws(()=>rank(candidate(stats(11,10))),/Invalid ranking counts/);
for(const history of [5,10,20])for(let n=0;n<=history;n++)for(let k=0;k<=n;k++){
    const c=candidate(stats(k,n,k>n/2?1:-1));c.histories[history]=c.histories[10];
    const r=ranking.rank(asset,c,{asOf,history});assert.ok(Number.isFinite(r.value)&&r.value>=1&&r.value<=10);
    assert.ok(r.components.every(p=>p.value>=0&&p.value<=100&&Number.isFinite(p.contribution)));
}
// Score uses one pre-selected report and only aggregates already chosen windows. It never changes their selection.
const untouched=candidate(),before=JSON.stringify(untouched);rank(untouched);assert.equal(JSON.stringify(untouched),before);
console.log('Opportunity ranking checks passed: fixed weights, damping, caps, missing/stale data, direction parity, range and no mutation.');
