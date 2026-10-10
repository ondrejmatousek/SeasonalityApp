const assert=require('node:assert/strict'),model=require('../wwwroot/js/daily-opportunities.js');
const prices=[],reports=[];
for(let year=1995;year<=2026;year++){
    for(let date=new Date(Date.UTC(year,0,1));date.getUTCFullYear()===year;date=new Date(+date+86400000)){
        const d=(Date.UTC(2001,date.getUTCMonth(),date.getUTCDate())-Date.UTC(2001,0,1))/86400000;
        prices.push({date:date.toISOString().slice(0,10),close:100+10*Math.cos(2*Math.PI*d/40)});
    }
    for(let date=new Date(Date.UTC(year,0,3));date.getUTCFullYear()===year;date=new Date(+date+7*86400000))
        reports.push({date:date.toISOString().slice(0,10),commercial:{index:50}});
}
const asOf='2026-10-10',result=model.analyzeAsset(prices,reports,asOf);
assert.equal(result.validationStart,2018);assert.equal(result.trainingYears.length,20);
assert.ok(result.trainingYears.every(y=>y<2018));assert.equal(result.candidates.length,2);
for(const c of result.candidates){
    assert.ok(c.startsIn>=0&&c.startsIn<=60&&c.days>=14&&c.days<=60);
    assert.ok(c.training.count>=10&&c.validation.count===8);
    assert.ok(c.cases.filter(s=>!s.validation).every(s=>s.end<'2018-01-01'));
    assert.ok(c.cases.filter(s=>s.validation).every(s=>s.year>=2018&&s.year<2026));
    assert.ok(c.cases.every(s=>!s.reportDate||Date.parse(s.reportDate)+7*86400000<=Date.parse(s.signalDate)));
    assert.equal(c.cot.count,c.cotBaseline.count,'Constant COT yields the same covered history');
    for(const years of [5,10,20]){
        const h=c.histories[years];
        assert.equal(h.from,2026-years);assert.equal(h.to,2025);
        assert.equal(h.seasonal.count,years);assert.equal(h.cot.count,years);
        assert.ok(h.cases.every(s=>s.year>=2026-years&&s.year<=2025));
        if(c.startDay<c.endDay){
            const manual=require('../wwwroot/js/seasonality-confluence.js').analyze(reports,prices,
                {startDay:c.startDay,endDay:c.endDay,asOf,direction:c.direction,historyYears:years,comparison:'snapshot'});
            assert.deepEqual(manual.seasonal,h.seasonal,'Chart and screener use identical price samples');
            assert.deepEqual(manual.conditional,h.cot,'Chart and screener use identical COT timing and calendar range');
        }
    }
}
const changed=model.analyzeAsset(prices.map(r=>r.date>='2018-01-01'?{...r,close:200-r.close}:r),reports,asOf);
assert.deepEqual(changed.curve,result.curve,'Validation prices cannot change discovery curve');
assert.deepEqual(changed.candidates.map(c=>[c.startDate,c.endDate,c.direction,c.score]),result.candidates.map(c=>[c.startDate,c.endDate,c.direction,c.score]),'Validation outcomes cannot select endpoints or directions');
assert.ok(changed.candidates.some(c=>c.warnings.includes('validation-disagrees')));
const future=model.analyzeAsset([...prices,{date:'2030-01-01',close:1}],reports,asOf);
assert.deepEqual(future,result,'Future quotes are never used');
assert.deepEqual(model.analyzeAsset(prices,[...reports,{date:'2030-01-01',commercial:{index:0}}],asOf),result,'Future COT is never used');
const newCot=model.analyzeAsset(prices,reports.map(r=>({...r,commercial:{index:r.date>='2026-01-01'?0:100}})),asOf);
assert.deepEqual(newCot.candidates.map(c=>[c.startDate,c.endDate,c.direction,c.score]),result.candidates.map(c=>[c.startDate,c.endDate,c.direction,c.score]),'COT cannot cherry-pick endpoints');
const gap=prices.filter(r=>r.date<'2020-10-01'||r.date>'2020-11-30');
assert.equal(model.historySamples(gap,asOf,'2026-10-01','2026-12-01',[2020]).length,0,'Long price gaps exclude an outcome');
assert.equal(model.cotAt([{date:'2020-10-01',commercial:{index:50}},{date:'2020-10-02',commercial:{index:null}}],'2020-10-10'),null,'Missing latest index cannot fall back to an older report');
const noCot=model.analyzeAsset(prices,[],asOf);
assert.ok(noCot.candidates.every(c=>c.warnings.includes('no-current-cot')&&c.cot.count===0));
const short=model.analyzeAsset(prices.filter(r=>r.date>='2010-01-01'),reports,asOf);
assert.equal(short.reason,'short-history');assert.equal(short.candidates.length,0);
const flat=model.analyzeAsset(prices.map(r=>({...r,close:100})),reports,asOf);
assert.equal(flat.candidates.length,0,'No manufactured extrema for a flat seasonal curve');
const cross=model.historySamples(prices,'2026-12-20','2026-12-27','2027-01-20',[2017,2018,2025,2026]);
assert.equal(cross.length,3);assert.equal(cross.at(-1).end,'2026-01-20');
assert.equal(cross[0].signalDate,'2017-12-20');
const early=[{date:'2020-10-01',commercial:{index:10}},{date:'2020-10-06',commercial:{index:90}}];
assert.equal(model.cotAt(early,'2020-10-10').commercial.index,10,'Do not use an entry-date report for a forecast made earlier');
assert.equal(model.cotAt(early,'2020-11-01'),null,'Stale report excluded');
assert.throws(()=>model.analyzeAsset([],[],'bad'));
console.log('Daily opportunity checks passed: training-only extrema/selection, fixed separated validation, no future quotes or COT, forecast lead time, cross-year windows, short history and flat curves.');
