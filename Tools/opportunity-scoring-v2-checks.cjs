const assert=require('node:assert/strict'),v2=require('../wwwroot/js/opportunity-scoring-v2.js'),m=require('../wwwroot/js/daily-opportunities.js');
const stats=(k,n,median=1)=>({count:n,successes:k,median,medianAdverse:1,q25:0,q75:2});
const input={older:stats(8,12),recent:stats(6,8),magnitude:stats(14,20),similar:stats(6,8),other:stats(9,12),olderBaseline:.5,recentBaseline:.5,direction:'up'};
const r=v2.calculate(input);assert.equal(r.components.C,.5,'Equal frequencies add no COT information');
assert.equal(v2.calculate({...input,similar:stats(0,0)}).components.C,.5,'Missing COT neutral');
assert.equal(v2.calculate({...input,quality:{proxy:true}}).rawScore,r.rawScore,'Quality cannot alter raw score');
assert.equal(v2.calculate({...input,similar:stats(1,1),other:stats(0,1)}).lambda,1/9,'Tiny sample is regularized only for noisy uplift estimate');
const zero=v2.calculate({...input,magnitude:{...stats(0,20,0),medianAdverse:0,q25:0,q75:0}});assert.ok(Number.isFinite(zero.rawScore));
const prices=[];for(let year=1990;year<2027;year++)for(let d=0;d<365;d++)prices.push({date:new Date(Date.UTC(year,0,1)+d*86400000).toISOString().slice(0,10),close:100+5*Math.sin(d/15)});
const a=m.analyzeAsset(prices,[],'2026-10-10');
for(const c of a.candidates){
    const score=v2.prepare(m,prices,{assetClass:'forex'},c,'2026-10-10');
    assert.ok(score.samples.older<=12&&score.samples.recent<=8);
    assert.ok(score.value>=0&&score.value<=10);
    assert.deepEqual(score,v2.prepare(m,[...prices,{date:'2030-01-01',close:1e9}],{assetClass:'forex'},c,'2026-10-10'));
}
const exposure=require('../wwwroot/js/opportunity-exposures.js');
const rows=['QQQ','NDX'].map(key=>({a:{key,assetClass:'etf'},c:{direction:'up'},r:{value:7}}));
assert.equal(exposure.exposures(rows[0].a,rows[0].c)[0].group,exposure.exposures(rows[1].a,rows[1].c)[0].group);
assert.equal(exposure.warnings(rows).length,1);assert.equal(exposure.diversified(rows)[1].r.value,7);
assert.equal(exposure.exposures({key:'GBPCAD',assetClass:'forex'},{direction:'up'})[0].sign,1);
assert.equal(exposure.exposures({key:'GBPAUD',assetClass:'forex'},{direction:'down'})[0].sign,-1);
console.log('V2: neutral incremental COT, separated confidence, zero denominators, future price invariance and directional exposure passed.');
