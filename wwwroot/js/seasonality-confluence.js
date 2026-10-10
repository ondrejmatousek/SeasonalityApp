(function(root,factory){
    if(typeof module==='object'&&module.exports)module.exports=factory(require('./seasonality-reliability.js'));
    else root.SeasonalityConfluence=factory(root.SeasonalityReliability);
}(typeof globalThis==='object'?globalThis:this,function(reliability){
    const day=86400000,z=1.959963984540054;
    const time=date=>Date.parse(date+'T00:00:00Z');
    const validIndex=value=>Number.isFinite(value)&&value>=0&&value<=100;

    // Binomial Wilson interval: sampling uncertainty, NOT a prediction interval.
    function wilson(successes,count){
        if(!Number.isInteger(count)||!Number.isInteger(successes)||count<0||successes<0||successes>count)
            throw new Error('Invalid binomial counts');
        if(!count)return null;
        const p=successes/count,denominator=1+z*z/count;
        const center=(p+z*z/(2*count))/denominator;
        const radius=z*Math.sqrt(p*(1-p)/count+z*z/(4*count*count))/denominator;
        return [100*Math.max(0,center-radius),100*Math.min(1,center+radius)];
    }

    function summarize(samples,direction){
        const returns=samples.map(s=>s.returnPct),count=samples.length;
        const successes=returns.filter(v=>direction==='up'?v>0:v<0).length;
        const adverse=samples.map(s=>direction==='up'?-s.maxDrop:s.maxRise);
        return {count,successes,flat:returns.filter(v=>v===0).length,rate:count?100*successes/count:null,
            uncertainty:wilson(successes,count),mean:count?returns.reduce((a,b)=>a+b,0)/count:null,
            median:reliability.quantile(returns,.5),q25:reliability.quantile(returns,.25),q75:reliability.quantile(returns,.75),
            medianAdverse:reliability.quantile(adverse,.5),worstAdverse:count?Math.max(...adverse):null};
    }

    function analyze(reports,prices,{startDay,endDay,asOf,group='commercial',direction='up',tolerance=10,historyYears=null}={}){
        if(!['commercial','nonCommercial','nonReportable'].includes(group)||!['up','down'].includes(direction)
            ||!Number.isFinite(tolerance)||tolerance<0||tolerance>100||!Number.isFinite(time(asOf))
            ||!Number.isInteger(startDay)||!Number.isInteger(endDay)||startDay<0||endDay>364||startDay>=endDay
            ||!(historyYears===null||(Number.isInteger(historyYears)&&historyYears>0)))throw new Error('Invalid confluence settings');
        const cutoff=time(asOf),year=Number(asOf.slice(0,4));
        // Never reference a report not yet available under the publication approximation.
        const ordered=reports.filter(r=>Number.isFinite(time(r.date))&&time(r.date)+7*day<=cutoff)
            .sort((a,b)=>a.date.localeCompare(b.date));
        const latest=ordered.at(-1),target=latest?.[group]?.index;
        const reference=latest?{date:latest.date,index:target,ageDays:(cutoff-time(latest.date))/day}:null;
        const referenceUsable=!!reference&&reference.ageDays<=21&&validIndex(target);
        const range=referenceUsable?[Math.max(0,target-tolerance),Math.min(100,target+tolerance)]:null;
        const seasonal=reliability.samples(prices,startDay,endDay,asOf).filter(s=>historyYears===null||s.year>=year-historyYears);
        const covered=[],matched=[];
        let missing=0,stale=0,missingIndex=0;
        for(const sample of seasonal){
            // Latest estimated-known report at this year's actual entry close, never inside the outcome window.
            const entry=time(sample.start);let lo=0,hi=ordered.length;
            while(lo<hi){const mid=(lo+hi)>>>1;if(time(ordered[mid].date)+7*day<=entry)lo=mid+1;else hi=mid;}
            const report=ordered[lo-1];
            if(!report){missing++;continue;}
            if(entry-time(report.date)>21*day){stale++;continue;}
            const index=report[group]?.index;
            // Do not substitute an older index if the latest report has no valid index.
            if(!validIndex(index)){missingIndex++;continue;}
            const row={...sample,reportDate:report.date,index,matched:!!range&&index>=range[0]&&index<=range[1]};
            covered.push(row);if(row.matched)matched.push(row);
        }
        const baseline=summarize(covered,direction),conditional=summarize(matched,direction);
        const recentYear=year-5;
        return {reference,referenceUsable,range,seasonal:summarize(seasonal,direction),baseline,conditional,
            delta:baseline.count&&conditional.count?conditional.rate-baseline.rate:null,
            missing,stale,missingIndex,cases:covered,
            recentYear,older:summarize(matched.filter(s=>s.year<recentYear),direction),
            recent:summarize(matched.filter(s=>s.year>=recentYear),direction)};
    }
    return {analyze,summarize,wilson};
}));
