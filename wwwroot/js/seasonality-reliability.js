(function(root,factory){
    if(typeof module==='object'&&module.exports)module.exports=factory();
    else root.SeasonalityReliability=factory();
}(typeof globalThis==='object'?globalThis:this,function(){
    const dayMs=86400000,cache=new WeakMap();
    const quantile=(values,p)=>{
        const sorted=[...values].sort((a,b)=>a-b);
        if(!sorted.length)return null;
        const index=(sorted.length-1)*p,lo=Math.floor(index),hi=Math.ceil(index);
        return sorted[lo]+(sorted[hi]-sorted[lo])*(index-lo);
    };
    function summarize(samples){
        const values=samples.map(s=>s.returnPct).filter(Number.isFinite).sort((a,b)=>a-b),count=values.length;
        const mean=v=>v.length?v.reduce((a,b)=>a+b,0)/v.length:null;
        return {count,mean:mean(values),median:quantile(values,.5),q25:quantile(values,.25),q75:quantile(values,.75),
            trimmed:count>=3?mean(values.slice(1,-1)):null,
            positive:values.filter(v=>v>0).length,negative:values.filter(v=>v<0).length,
            best:count?values.at(-1):null,worst:count?values[0]:null};
    }
    function samples(rows,startDay,endDay,asOf){
        if(!Number.isInteger(startDay)||!Number.isInteger(endDay)||startDay<0||endDay>364||startDay>=endDay)return [];
        const anchor=new Date(asOf+'T00:00:00Z');
        if(!Number.isFinite(anchor.getTime()))return [];
        let entry=cache.get(rows);
        if(!entry){
            const groups=new Map();
            for(const row of rows){const year=Number(row.date.slice(0,4));if(!groups.has(year))groups.set(year,[]);groups.get(year).push(row);}
            for(const group of groups.values())group.sort((a,b)=>a.date.localeCompare(b.date));
            entry={groups,windows:new Map()};cache.set(rows,entry);
        }
        const key=`${startDay}:${endDay}:${asOf}`;
        if(entry.windows.has(key))return entry.windows.get(key);
        const result=[];
        const monthDay=d=>new Date(Date.UTC(2001,0,1+d));
        const a=monthDay(startDay),b=monthDay(endDay);
        for(const [year,group] of entry.groups){
            if(year>=anchor.getUTCFullYear())continue;
            const start=new Date(Date.UTC(year,a.getUTCMonth(),a.getUTCDate()));
            const end=new Date(Date.UTC(year,b.getUTCMonth(),b.getUTCDate()));
            const startIso=start.toISOString().slice(0,10),endIso=end.toISOString().slice(0,10);
            function lowerBound(date){let lo=0,hi=group.length;while(lo<hi){const mid=(lo+hi)>>>1;if(group[mid].date<date)lo=mid+1;else hi=mid;}return lo;}
            const first=lowerBound(startIso);let last=lowerBound(endIso);
            if(last===group.length||group[last].date!==endIso)last--;
            if(first>=last||!group[first]||!group[last])continue;
            if(Date.parse(group[first].date)-start>7*dayMs||end-Date.parse(group[last].date)>7*dayMs)continue;
            const base=group[first].close;let min=0,max=0,valid=true;
            for(let i=first;i<=last;i++){
                const close=group[i].close;
                if(!(close>0)||!Number.isFinite(close)||(i>first&&Date.parse(group[i].date)-Date.parse(group[i-1].date)>7*dayMs)){valid=false;break;}
                const value=(close/base-1)*100;min=Math.min(min,value);max=Math.max(max,value);
            }
            if(valid)result.push({year,start:group[first].date,end:group[last].date,returnPct:(group[last].close/base-1)*100,maxRise:max,maxDrop:min});
        }
        result.sort((a,b)=>a.year-b.year);
        if(entry.windows.size>=32)entry.windows.clear();
        entry.windows.set(key,result);return result;
    }
    function assess(selected,comparisons){
        if(selected.count<8)return {kind:'caution',label:'Malý vzorek',reason:'Méně než 8 dokončených období. Z těchto dat nelze rozumně posoudit opakovatelnost.'};
        const direction=Math.sign(selected.median);
        const sensitivity=direction===0||Math.sign(selected.mean)!==direction||Math.sign(selected.trimmed)!==direction;
        if(sensitivity)return {kind:'caution',label:'Výsledek je citlivý na extrémy',reason:'Průměr, medián nebo průměr bez dvou extrémních roků nemají stejný směr.'};
        const usable=comparisons.filter(s=>s.count>=4);
        if(usable.some(s=>Math.sign(s.median)!==direction))return {kind:'caution',label:'Směr se mění s délkou historie',reason:'Novější a delší historická období se neshodují ve znaménku mediánu.'};
        const matching=direction>0?selected.positive:selected.negative;
        if(matching/selected.count<.7)return {kind:'neutral',label:'Výsledky jsou smíšené',reason:'Méně než 70 % sledovaných let mělo stejný směr jako medián.'};
        if(usable.length<3)return {kind:'caution',label:'Chybí delší historie',reason:'Směr ve vybraných letech drží, ale nelze jej porovnat ve všech oknech 5/10/20 let.'};
        return {kind:'consistent',label:'Historický směr drží v těchto kontrolách',reason:'Medián, průměr i průměr bez extrémů mají stejný směr a porovnání 5/10/20 let mu neodporuje. To není záruka budoucího výsledku.'};
    }
    return {samples,summarize,quantile,assess};
}));
