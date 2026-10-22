(function(root,factory){
    if(typeof module==='object'&&module.exports)module.exports=factory(require('./seasonality-confluence.js'),require('./opportunity-confidence.js'));
    else root.OpportunityScoringV2=factory(root.SeasonalityConfluence,root.OpportunityConfidence);
}(typeof globalThis==='object'?globalThis:this,function(stats,confidence){
    const weights=Object.freeze({S:.30,R:.25,M:.25,C:.20}),clamp=n=>Math.max(0,Math.min(1,n));
    const frequency=s=>s?.count?s.successes/s.count:null;
    const edge=(s,b)=>frequency(s)!==null&&Number.isFinite(b)?clamp(.5+frequency(s)-b):.5;
    function calculate({older,recent,magnitude,similar,other,olderBaseline,recentBaseline,direction,quality={}}){
        const S=edge(older,olderBaseline),R=edge(recent,recentBaseline),sign=direction==='up'?1:-1;
        const m=Math.max(0,sign*(magnitude.median||0)),a=Math.max(0,magnitude.medianAdverse||0),d=Math.max(0,(magnitude.q75-magnitude.q25)/2||0);
        // Not trading R:R: descriptive close-based movements without stops, costs or intraday extremes.
        const ratio=v=>m+v>0?m/(m+v):0;
        const M=magnitude.count ? .5*ratio(a)+.5*ratio(d) : .5;
        const size=Math.min(similar.count,other.count),lambda=size/(size+8);
        const delta=size?frequency(similar)-frequency(other):0,C=clamp(.5+lambda*delta);
        const components={S,R,M,C},rawScore=10*Object.entries(weights).reduce((sum,[k,w])=>sum+w*components[k],0);
        return {version:'research-priority-v2-experimental',rawScore,value:Math.round(rawScore*10)/10,components,weights,
            delta,lambda,baselines:{older:olderBaseline,recent:recentBaseline},
            samples:{older:older.count,recent:recent.count,magnitude:magnitude.count,similar:similar.count,other:other.count},
            confidence:confidence.assess({seasonal:older.count,recent:recent.count,similar:similar.count,other:other.count,...quality})};
    }
    function prepare(model,prices,asset,candidate,asOf){
        const year=Number(asOf.slice(0,4)),boundary=year-8,cutoff=`${boundary}-01-01`;
        const samples=candidate.histories[20].cases;
        const olderCases=samples.filter(s=>s.year<boundary&&s.end<cutoff),recentCases=samples.filter(s=>s.year>=boundary&&s.start>=cutoff);
        const baseline=cases=>{
            const fractions=[];
            for(const sample of cases){
                const startYear=Number(sample.start.slice(0,4)),values=[];
                for(let month=0;month<12;month++){
                    const start=new Date(Date.UTC(year,month,1)),end=new Date(+start+candidate.days*86400000);
                    const row=model.historySamples(prices,asOf,start.toISOString().slice(0,10),end.toISOString().slice(0,10),[startYear])[0];
                    if(!row||row.end>=asOf||cases===olderCases&&row.end>=cutoff||cases===recentCases&&row.start<cutoff)continue;
                    values.push(candidate.direction==='up'?row.returnPct>0:row.returnPct<0);
                }
                if(values.length)fractions.push(values.filter(Boolean).length/values.length);
            }
            return fractions.length?fractions.reduce((a,b)=>a+b,0)/fractions.length:null;
        };
        const covered=samples.filter(s=>s.reportDate),similar=covered.filter(s=>s.matched),other=covered.filter(s=>!s.matched);
        const summarize=rows=>stats.summarize(rows,candidate.direction);
        return calculate({older:summarize(olderCases),recent:summarize(recentCases),magnitude:summarize([...olderCases,...recentCases]),
            similar:summarize(similar),other:summarize(other),olderBaseline:baseline(olderCases),recentBaseline:baseline(recentCases),direction:candidate.direction,
            quality:{currentCot:!!candidate.cotReference,completePrices:samples.length===20,
                verifiedPublications:covered.length>0&&covered.every(s=>s.availabilitySource==='verified-publication-day')&&candidate.cotReference?.availabilitySource==='verified-publication-day',
                proxy:asset.assetClass!=='forex',priceProvenance:false,
                pricesFresh:!!prices.filter(p=>p.date<=asOf).at(-1)&&Date.parse(asOf)-Date.parse(prices.filter(p=>p.date<=asOf).at(-1).date)<=7*86400000}});
    }
    return {calculate,prepare,weights};
}));
