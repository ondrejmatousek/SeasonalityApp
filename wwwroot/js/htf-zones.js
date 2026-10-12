(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.HtfZones=factory();
}(typeof globalThis==='object'?globalThis:this,function(){
    const config=Object.freeze({version:'htf-base-departure-v1-experimental',atr:14,baseMax:3,departureMax:3,baseRangeAtr:1,bodyFraction:.5,departureAtr:1.5,structure:20,nearAtr:.5,maxVisits:1,maxAgeDays:365,entryHorizon:30});
    const ms=86400000,day=s=>Date.parse(s+'T00:00:00Z');
    function valid(b){return /^\d{4}-\d{2}-\d{2}$/.test(b.date)&&[b.open,b.high,b.low,b.close].every(v=>Number.isFinite(v)&&v>0)&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)&&b.high>=b.low;}
    function weekly(bars,asOf){
        const groups=new Map();
        for(const b of bars.filter(b=>b.date<asOf&&valid(b))){const d=new Date(day(b.date));d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);const key=d.toISOString().slice(0,10);
            if(day(key)+7*ms>day(asOf))continue; // Never use an incomplete current week.
            if(!groups.has(key))groups.set(key,[]);groups.get(key).push(b);}
        return [...groups].sort((a,b)=>a[0].localeCompare(b[0])).filter(([,g])=>g.length>=3).map(([date,g])=>({date,open:g[0].open,high:Math.max(...g.map(b=>b.high)),low:Math.min(...g.map(b=>b.low)),close:g.at(-1).close,endDate:g.at(-1).date}));
    }
    function atrs(bars){return bars.map((b,i)=>{if(i<config.atr)return null;return bars.slice(i-config.atr,i).reduce((sum,v,j)=>{const previous=bars[i-config.atr+j-1]?.close??v.open;return sum+Math.max(v.high-v.low,Math.abs(v.high-previous),Math.abs(v.low-previous));},0)/config.atr;});}
    function detect(input,timeframe,asOf){
        const daily=input.filter(b=>b.date<asOf&&valid(b)).sort((a,b)=>a.date.localeCompare(b.date));
        const bars=timeframe==='W1'?weekly(daily,asOf):daily,atr=atrs(bars),zones=[],dedup=new Set();
        for(let start=config.structure;start<bars.length-1;start++)for(let count=1;count<=config.baseMax&&start+count<bars.length;count++){
            const base=bars.slice(start,start+count),a=atr[start];if(!(a>0))continue;
            const high=Math.max(...base.map(b=>b.high)),low=Math.min(...base.map(b=>b.low));
            if(high-low>a*config.baseRangeAtr||base.some(b=>Math.abs(b.close-b.open)>(b.high-b.low)*config.bodyFraction))continue;
            const prior=bars.slice(start-config.structure,start),priorHigh=Math.max(...prior.map(b=>b.high)),priorLow=Math.min(...prior.map(b=>b.low));
            for(let k=0;k<config.departureMax&&start+count+k<bars.length;k++){
                const segment=bars.slice(start-config.structure,start+count+k+1);
                if(segment.some((v,i)=>i&&day(v.date)-day(segment[i-1].date)>(timeframe==='W1'?10:7)*ms))break;
                const confirmation=start+count+k,b=bars[confirmation],type=b.close>=high+config.departureAtr*a&&b.close>priorHigh?'demand':b.close<=low-config.departureAtr*a&&b.close<priorLow?'supply':null;
                if(!type)continue;
                const lower=type==='demand'?low:Math.min(...base.flatMap(b=>[b.open,b.close])),upper=type==='demand'?Math.max(...base.flatMap(b=>[b.open,b.close])):high;
                if(!(upper>lower))break;
                const id=`${timeframe}:${base[0].date}:${type}`,knownAt=b.endDate||b.date;
                if(dedup.has(id)||day(asOf)-day(knownAt)>config.maxAgeDays*ms)break;
                let invalid=false,visits=0,inside=false;
                // A closed daily candle can invalidate a weekly zone before the week closes.
                for(const later of daily.filter(v=>v.date>knownAt)){
                    if(type==='demand'?later.close<lower:later.close>upper){invalid=true;break;}
                    const touch=later.low<=upper&&later.high>=lower;if(touch&&!inside)visits++;inside=touch;
                }
                if(!invalid&&visits<=config.maxVisits){dedup.add(id);zones.push({id,timeframe,type,lower,upper,baseDate:base[0].date,confirmedAt:knownAt,atr:a,visits,fresh:visits===0});}
                break;
            }
        }
        return zones.sort((a,b)=>b.confirmedAt.localeCompare(a.confirmedAt));
    }
    function cotState(c){const v=c.scoringV2;if(!c.cotReference||!v||v.samples.similar<8||v.samples.other<8)return 'insufficient';return v.components.C>.5?'confirms':v.components.C<.5?'against':'neutral';}
    function match(zones,candidates,price,asOf){
        const result=[];
        for(const zone of zones){const distance=Math.max(zone.lower-price,price-zone.upper,0),near=distance<=config.nearAtr*zone.atr;
            for(const c of candidates){const s=c.histories?.[20]?.seasonal,sign=c.direction==='up'?1:-1;
                if((zone.type==='demand')!==(c.direction==='up')||!s||s.count<8||s.rate<=50||!(sign*s.median>0)||c.endDate<asOf||c.startDate>new Date(day(asOf)+config.entryHorizon*ms).toISOString().slice(0,10))continue;
                result.push({zoneId:zone.id,candidate:c,distance,distanceAtr:distance/zone.atr,priceState:distance===0?'inside':near?'near':'far',seasonalState:c.startDate<=asOf?'active':'upcoming',cotState:cotState(c)});
            }
        }
        return result.sort((a,b)=>a.distanceAtr-b.distanceAtr||b.candidate.scoringV2.rawScore-a.candidate.scoringV2.rawScore);
    }
    return {config,valid,weekly,detect,match,cotState};
}));
