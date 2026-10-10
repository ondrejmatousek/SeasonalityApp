(function(root,factory){
    if(typeof module==='object'&&module.exports)module.exports=factory();
    else root.CotAnalogs=factory();
}(typeof globalThis==='object'?globalThis:this,function(){
    const day=86400000;
    const time=date=>Date.parse(date+'T00:00:00Z');
    function quantile(values,p){
        if(!values.length)return null;
        const sorted=[...values].sort((a,b)=>a-b),i=(sorted.length-1)*p,lo=Math.floor(i);
        return sorted[lo]+(sorted[Math.ceil(i)]-sorted[lo])*(i-lo);
    }
    function summarize(values){
        return {count:values.length,mean:values.length?values.reduce((a,b)=>a+b,0)/values.length:null,
            median:quantile(values,.5),q25:quantile(values,.25),q75:quantile(values,.75),
            min:values.length?Math.min(...values):null,max:values.length?Math.max(...values):null,
            positive:values.length?100*values.filter(v=>v>0).length/values.length:null};
    }
    function analyze(reports,prices,{group='commercial',mode='latest',tolerance=10,asOf}={}){
        if(!['commercial','nonCommercial','nonReportable'].includes(group)||!['latest','low','high'].includes(mode)
            ||!Number.isFinite(tolerance)||tolerance<0||tolerance>100||!Number.isFinite(time(asOf)))throw new Error('Invalid analog settings');
        const cutoff=time(asOf),ordered=reports.filter(r=>Number.isFinite(time(r.date))&&time(r.date)<=cutoff).sort((a,b)=>a.date.localeCompare(b.date));
        const latest=ordered.at(-1),target=latest?.[group]?.index;
        const range=mode==='low'?[0,20]:mode==='high'?[80,100]:Number.isFinite(target)?[Math.max(0,target-tolerance),Math.min(100,target+tolerance)]:null;
        const rows=prices.filter(r=>Number.isFinite(time(r.date))&&time(r.date)<=cutoff).sort((a,b)=>a.date.localeCompare(b.date));
        const firstAt=t=>{let lo=0,hi=rows.length;while(lo<hi){const mid=(lo+hi)>>1;if(time(rows[mid].date)<t)lo=mid+1;else hi=mid;}return lo;};
        const samples=[];let lastEnd=-Infinity,candidates=0;
        if(range)for(const report of ordered){
            const index=report[group]?.index;
            if(!Number.isFinite(index)||index<0||index>100||index<range[0]||index>range[1])continue;
            candidates++;
            // Publication timestamps are unavailable: this is a labeled 7-day approximation.
            const available=time(report.date)+7*day,startIndex=firstAt(available),entry=rows[startIndex];
            if(!entry||time(entry.date)-available>4*day||!(entry.close>0)||!Number.isFinite(entry.close)||time(entry.date)<=lastEnd)continue;
            const entryTime=time(entry.date),outcomes={};let valid=true,endIndex=startIndex;
            for(const weeks of [2,4,8]){
                const due=entryTime+weeks*7*day,i=firstAt(due),exit=rows[i];
                if(!exit||time(exit.date)-due>4*day||!(exit.close>0)||!Number.isFinite(exit.close)){valid=false;break;}
                outcomes[weeks]={date:exit.date,returnPct:(exit.close/entry.close-1)*100};endIndex=i;
            }
            if(!valid)continue;
            for(let i=startIndex+1;i<=endIndex;i++)if(time(rows[i].date)-time(rows[i-1].date)>7*day||!(rows[i].close>0)||!Number.isFinite(rows[i].close)){valid=false;break;}
            if(!valid)continue;
            samples.push({reportDate:report.date,index,entryDate:entry.date,entryPrice:entry.close,outcomes});
            lastEnd=time(outcomes[8].date);
        }
        return {range,target,referenceDate:latest?.date,candidates,samples,
            horizons:[2,4,8].map(weeks=>({weeks,...summarize(samples.map(s=>s.outcomes[weeks].returnPct))})),
            firstPriceDate:rows[0]?.date,lastPriceDate:rows.at(-1)?.date};
    }
    return {analyze,summarize};
}));
