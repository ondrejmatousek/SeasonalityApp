(function(root,factory){
    if(typeof module==='object'&&module.exports)module.exports=factory(require('./cot-availability.js'));
    else root.FxRelativeCot=factory(root.CotAvailability);
}(typeof globalThis==='object'?globalThis:this,function(availability){
    const config=Object.freeze({lookback:52,tolerance:.2,usdReference:0});
    function currency(reports,evaluationDate,{historical=false}={}){
        const known=(historical?availability.positionsKnown:availability.known)(reports,evaluationDate),latest=known.at(-1);
        if(!latest||availability.cutoff(evaluationDate)-availability.cutoff(latest.date)>21*86400000)return null;
        const window=known.filter(r=>r.date<=latest.date).slice(-config.lookback);
        if(window.length<config.lookback||window.some(r=>!(r.openInterest>0)||!Number.isFinite(r.commercial?.net)))return null;
        const values=window.map(r=>r.commercial.net/r.openInterest),x=values.at(-1);
        // Midrank percentile including current value; ties are neutral in a constant window.
        const percentile=(values.filter(v=>v<x).length+.5*values.filter(v=>v===x).length)/values.length;
        // The normalized state cannot be known before every input in its window.
        const availableAt=window.map(r=>r.availableAt).filter(Boolean).reduce((a,b)=>!a||availability.cutoff(b)>availability.cutoff(a)?b:a,null);
        return {u:2*percentile-1,x,date:latest.date,availableAt,
            availabilitySource:window.every(r=>r.availabilitySource==='verified-publication-day')?'verified-publication-day':latest.availabilitySource==='verified-publication-day'?'observed-upper-bound':latest.availabilitySource,
            lookback:window.length};
    }
    function state(pair,series,evaluationDate,options={}){
        if(!/^[A-Z]{6}$/.test(pair))throw Error('Expected base/quote currency pair');
        const base=pair.slice(0,3),quote=pair.slice(3),get=k=>k==='USD'?{u:0,date:null,availabilitySource:'usd-reference'}:currency(series[k]||[],evaluationDate,options);
        const b=get(base),q=get(quote);if(!b||!q)return null;
        if(b.date&&q.date&&b.date!==q.date)return null; // Do not silently mix asynchronous snapshots.
        return {relativeCot:(b.u-q.u)/2,base:b,quote:q,date:b.date||q.date,
            availableAt:[b.availableAt,q.availableAt].filter(Boolean).reduce((a,v)=>!a||availability.cutoff(v)>availability.cutoff(a)?v:a,null),
            availabilitySource:[b,q].every(v=>!v.date||v.availabilitySource==='verified-publication-day')?'verified-publication-day':'observed-upper-bound'};
    }
    function reports(pair,series,{historical=false}={}){
        const keys=[pair.slice(0,3),pair.slice(3)].filter(k=>k!=='USD');
        const events=[...new Set(keys.flatMap(k=>(series[k]||[]).map(r=>historical?r.date:availability.metadata(r).availableAt).filter(Boolean)))].sort();
        // For archive construction each currency needs only its preceding 52 reports.
        // Incremental cursors avoid rescanning decades for every weekly FX state.
        const ordered=historical?Object.fromEntries(keys.map(k=>[k,availability.positionsKnown(series[k]||[],events.at(-1)||'1900-01-01')])):null;
        const cursors=Object.fromEntries(keys.map(k=>[k,0]));
        const result=[];
        for(const date of events){let inputs=series;
            if(historical){inputs={};for(const k of keys){const rows=ordered[k];while(cursors[k]<rows.length&&rows[cursors[k]].date<=date)cursors[k]++;
                inputs[k]=rows.slice(Math.max(0,cursors[k]-config.lookback),cursors[k]);}}
            const r=state(pair,inputs,date,{historical});if(!r)continue;
            result.push({date:r.date,availableAt:r.availableAt,availabilitySource:r.availabilitySource,
                relativeCot:r.relativeCot,base:r.base,quote:r.quote,commercial:{index:50*(r.relativeCot+1)}});
        }
        return result;
    }
    return {currency,state,reports,config};
}));
