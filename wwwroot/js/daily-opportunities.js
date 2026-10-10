(function(root,factory){
    if(typeof module==='object'&&module.exports)module.exports=factory(require('./seasonality-confluence.js'));
    else root.DailyOpportunities=factory(root.SeasonalityConfluence);
}(typeof globalThis==='object'?globalThis:this,function(confluence){
    const day=86400000,config=Object.freeze({validationYears:8,minTrainingYears:10,maxTrainingYears:20,
        entryHorizon:60,minDuration:14,maxDuration:60,smoothRadius:3,extremeRadius:7,cotTolerance:10,cotLookback:52});
    const iso=d=>d.toISOString().slice(0,10),time=s=>Date.parse(s+'T00:00:00Z');
    const calendar=s=>{const d=new Date(time(s));return Math.round((Date.UTC(2001,d.getUTCMonth(),d.getUTCDate())-Date.UTC(2001,0,1))/day);};
    const anniversary=(s,year)=>{const d=new Date(time(s)),n=new Date(Date.UTC(year,d.getUTCMonth(),d.getUTCDate()));if(n.getUTCMonth()!==d.getUTCMonth())n.setUTCDate(0);return iso(n);};
    const lowerBound=(rows,date)=>{let lo=0,hi=rows.length;while(lo<hi){const mid=(lo+hi)>>>1;if(rows[mid].date<date)lo=mid+1;else hi=mid;}return lo;};

    function seasonalCurve(rows,asOf){
        const validationStart=Number(asOf.slice(0,4))-config.validationYears,groups=new Map();
        for(const r of rows){const year=Number(r.date.slice(0,4));if(year>=validationStart)continue;
            if(!groups.has(year))groups.set(year,[]);groups.get(year).push(r);}
        const complete=[];
        for(const [year,group] of groups){
            if(time(group[0].date)-Date.UTC(year,0,1)>7*day||Date.UTC(year,11,31)-time(group.at(-1).date)>7*day)continue;
            if(group.some((r,i)=>!(r.close>0)||!Number.isFinite(r.close)||(i&&time(r.date)-time(group[i-1].date)>7*day)))continue;
            const base=group[0].close,quotes=group.filter(r=>!r.date.endsWith('02-29')).map(r=>[calendar(r.date),100*r.close/base]);
            if(quotes.length<2)continue;
            const values=[];let index=0;
            for(let d=0;d<365;d++){
                while(index+1<quotes.length&&quotes[index+1][0]<=d)index++;
                const a=quotes[index],b=quotes[index+1];
                values.push(d<a[0]?a[1]:b?a[1]+(b[1]-a[1])*(d-a[0])/(b[0]-a[0]):a[1]);
            }
            complete.push({year,values});
        }
        complete.sort((a,b)=>a.year-b.year);
        const selected=complete.slice(-config.maxTrainingYears),years=selected.map(s=>s.year);
        if(years.length<config.minTrainingYears)return {years,validationStart,curve:null};
        const mean=Array.from({length:365},(_,d)=>selected.reduce((sum,s)=>sum+s.values[d],0)/selected.length);
        // Carry the average annual change through Dec/Jan, rather than inventing a reset extremum.
        const factor=mean[364]/mean[0];
        const at=d=>mean[((d%365)+365)%365]*Math.pow(factor,Math.floor(d/365));
        const smooth=Array.from({length:365},(_,d)=>{
            let sum=0;for(let i=-config.smoothRadius;i<=config.smoothRadius;i++)sum+=at(d+i);
            return sum/(2*config.smoothRadius+1);
        });
        return {years,validationStart,curve:smooth,factor};
    }

    function candidates(rows,asOf){
        const training=seasonalCurve(rows,asOf);
        if(!training.curve)return {...training,windows:[]};
        const {curve,factor}=training,at=d=>curve[((d%365)+365)%365]*Math.pow(factor,Math.floor(d/365));
        const kind=d=>{
            const value=at(d);let min=true,max=true;
            for(let i=-config.extremeRadius;i<=config.extremeRadius;i++){
                if(!i)continue;min&&=value<=at(d+i);max&&=value>=at(d+i);
            }
            // A flat plateau gets a single earliest extremum, not one per day.
            return min&&value<at(d-1)?'min':max&&value>at(d-1)?'max':null;
        };
        const windows=[];
        for(let offset=0;offset<=config.entryHorizon;offset++){
            const startDate=iso(new Date(time(asOf)+offset*day)),startDay=calendar(startDate);
            const extendedStart=startDay+365*(Number(startDate.slice(0,4))-Number(asOf.slice(0,4)));
            const type=kind(extendedStart);if(!type)continue;
            for(let length=config.minDuration;length<=config.maxDuration;length++){
                const endDate=iso(new Date(time(startDate)+length*day));
                const endDay=calendar(endDate)+365*(Number(endDate.slice(0,4))-Number(asOf.slice(0,4)));
                if(kind(endDay)!==(type==='min'?'max':'min'))continue;
                const direction=type==='min'?'up':'down',move=(at(endDay)/at(extendedStart)-1)*100;
                if(direction==='up'?move<=0:move>=0)continue;
                windows.push({startDate,endDate,direction,days:length,startsIn:offset,startDay,endDay:endDay%365});
                break; // First eligible opposite extremum, not the best endpoint among all dates.
            }
        }
        return {...training,windows};
    }

    function historySamples(rows,asOf,startDate,endDate,years){
        const anchorYear=Number(asOf.slice(0,4)),startYear=Number(startDate.slice(0,4)),endYear=Number(endDate.slice(0,4)),result=[];
        for(const year of years){
            const start=anniversary(startDate,year+startYear-anchorYear),end=anniversary(endDate,year+endYear-anchorYear);
            if(end>asOf||year>=anchorYear)continue;
            const first=lowerBound(rows,start);let last=lowerBound(rows,end);
            if(last===rows.length||rows[last].date!==end)last--;
            if(first>=last||!rows[first]||!rows[last])continue;
            if(time(rows[first].date)-time(start)>7*day||time(end)-time(rows[last].date)>7*day)continue;
            const base=rows[first].close;let maxRise=0,maxDrop=0,valid=true;
            for(let i=first;i<=last;i++){
                if(!(rows[i].close>0)||!Number.isFinite(rows[i].close)||(i>first&&time(rows[i].date)-time(rows[i-1].date)>7*day)){valid=false;break;}
                const move=(rows[i].close/base-1)*100;maxRise=Math.max(maxRise,move);maxDrop=Math.min(maxDrop,move);
            }
            if(valid)result.push({year,signalDate:anniversary(asOf,year),start:rows[first].date,end:rows[last].date,
                returnPct:(rows[last].close/base-1)*100,maxRise,maxDrop});
        }
        return result;
    }

    function cotAt(reports,date){
        let lo=0,hi=reports.length;
        while(lo<hi){const mid=(lo+hi)>>>1;if(time(reports[mid].date)+7*day<=time(date))lo=mid+1;else hi=mid;}
        const r=reports[lo-1];
        if(!r||time(date)-time(r.date)>21*day||!Number.isFinite(r.commercial?.index)||r.commercial.index<0||r.commercial.index>100)return null;
        return r;
    }

    function analyzeAsset(prices,reports,asOf){
        if(!Number.isFinite(time(asOf)))throw Error('Invalid snapshot date');
        const rows=prices.filter(r=>Number.isFinite(time(r.date))&&r.date<=asOf).sort((a,b)=>a.date.localeCompare(b.date));
        const cot=reports.filter(r=>Number.isFinite(time(r.date))&&r.date<=asOf).sort((a,b)=>a.date.localeCompare(b.date));
        const discovered=candidates(rows,asOf),selected=[];
        if(!discovered.curve)return {trainingYears:discovered.years,validationStart:discovered.validationStart,curve:null,candidates:[],reason:'short-history'};
        const validationYears=Array.from({length:config.validationYears},(_,i)=>discovered.validationStart+i);
        const cutoff=`${discovered.validationStart}-01-01`;
        // Selection sees ONLY training statistics. No COT or validation outcomes affect endpoints, direction or ranking.
        for(const direction of ['up','down']){
            const choices=[];
            for(const window of discovered.windows.filter(w=>w.direction===direction)){
                const samples=historySamples(rows,asOf,window.startDate,window.endDate,discovered.years).filter(s=>s.end<cutoff);
                const stats=confluence.summarize(samples,direction),sign=direction==='up'?1:-1;
                if(stats.count<config.minTrainingYears||!(sign*stats.median>0))continue;
                const sorted=samples.map(s=>sign*s.returnPct).sort((a,b)=>a-b);
                const trimmed=sorted.slice(1,-1).reduce((a,b)=>a+b,0)/(sorted.length-2);
                if(!(trimmed>0))continue;
                choices.push({window,samples,stats,score:stats.uncertainty[0],tie:sign*stats.median/(stats.medianAdverse+.25)});
            }
            choices.sort((a,b)=>b.score-a.score||b.tie-a.tie||a.window.startsIn-b.window.startsIn);
            const best=choices[0];if(!best)continue;
            const validation=historySamples(rows,asOf,best.window.startDate,best.window.endDate,validationYears);
            const all=[...best.samples,...validation],reference=cotAt(cot,asOf);
            const range=reference?[Math.max(0,reference.commercial.index-config.cotTolerance),Math.min(100,reference.commercial.index+config.cotTolerance)]:null;
            const covered=[],matched=[];
            for(const sample of all){
                const report=cotAt(cot,sample.signalDate);if(!report)continue;
                const index=report.commercial.index,isMatch=!!range&&index>=range[0]&&index<=range[1];
                const row={...sample,index,reportDate:report.date,matched:isMatch,validation:sample.year>=discovered.validationStart};
                covered.push(row);if(isMatch)matched.push(row);
            }
            const validationStats=confluence.summarize(validation,direction),cotStats=confluence.summarize(matched,direction);
            const cotBaseline=confluence.summarize(covered,direction),sign=direction==='up'?1:-1;
            // Display windows share a fixed calendar-year range, not a count of matching COT reports.
            const recent=historySamples(rows,asOf,best.window.startDate,best.window.endDate,
                Array.from({length:20},(_,i)=>Number(asOf.slice(0,4))-20+i));
            const recentCovered=recent.flatMap(sample=>{
                const report=cotAt(cot,sample.signalDate);if(!report)return [];
                const index=report.commercial.index;
                return [{...sample,index,reportDate:report.date,matched:!!range&&index>=range[0]&&index<=range[1]}];
            });
            const histories=Object.fromEntries([5,10,20].map(years=>{
                const from=Number(asOf.slice(0,4))-years;
                const samples=recent.filter(s=>s.year>=from),available=recentCovered.filter(s=>s.year>=from);
                return [years,{from,to:Number(asOf.slice(0,4))-1,seasonal:confluence.summarize(samples,direction),
                    cot:confluence.summarize(available.filter(s=>s.matched),direction),
                    baseline:confluence.summarize(available,direction),years:samples.map(s=>s.year),
                    cases:samples.map(s=>available.find(r=>r.year===s.year)||{...s,index:null,reportDate:null,matched:false})}];
            }));
            const warnings=[];
            if(validationStats.count<config.validationYears)warnings.push('incomplete-validation');
            if(validationStats.count&&(!(sign*validationStats.median>0)||validationStats.rate<=50))warnings.push('validation-disagrees');
            if(!reference)warnings.push('no-current-cot');
            else if(cotStats.count<8)warnings.push('small-cot-sample');
            else if(!(sign*cotStats.median>0)||cotStats.rate<=50)warnings.push('cot-disagrees');
            selected.push({...best.window,histories,training:best.stats,trainingYears:best.samples.map(s=>s.year),validation:validationStats,
                validationYears:validation.map(s=>s.year),cot:cotStats,cotBaseline,cotValidation:confluence.summarize(matched.filter(s=>s.validation),direction),
                cotReference:reference?{date:reference.date,index:reference.commercial.index}:null,cotRange:range,
                score:best.score,warnings,cases:all.map(s=>covered.find(c=>c.year===s.year)||{...s,index:null,reportDate:null,matched:false,validation:s.year>=discovered.validationStart})});
        }
        return {trainingYears:discovered.years,validationStart:discovered.validationStart,curve:discovered.curve.map(v=>Math.round(v*10000)/10000),
            candidates:selected,reason:selected.length?null:'no-window'};
    }
    return {config,analyzeAsset,seasonalCurve,candidates,historySamples,cotAt};
}));
