// The same report construction is used for screening and detail; no base-only FX fallback.
(function(root,factory){
    if(typeof module==='object'&&module.exports)module.exports=factory(require('./fx-relative-cot.js'));
    else root.CoreCot=factory(root.FxRelativeCot);
}(typeof globalThis==='object'?globalThis:this,function(fx){
    function observedReports(reports,observedAt){
        // Export proves observation by this timestamp, NOT original publication or original vintage.
        // Never backdate these values into historical forecasts.
        return reports.map(r=>r.availableAt||r.availabilitySource&&r.availabilitySource!=='unknown'||!observedAt||r.date>observedAt.slice(0,10)?r:
            {...r,availableAt:observedAt,availabilitySource:'observed-upper-bound'});
    }
    function market(mapping,markets,observedAt){
        markets=markets.map(m=>({...m,reports:observedReports(m.reports||[],observedAt)}));
        if(mapping.cotMode==='relative-cot-state-v1'){
            const series=Object.fromEntries(markets.filter(m=>mapping.cotSources.some(s=>s.contractCode&&s.contractCode===m.contractCode)).map(m=>[m.key,m.reports||[]]));
            return {key:mapping.tradingInstrument,name:`Relative COT ${mapping.base}/${mapping.quote} · commercial net/OI percentile 52`,
                reports:fx.reports(mapping.tradingInstrument,series),isRelative:true};
        }
        const code=mapping.cotSources[0]?.contractCode;
        return markets.find(m=>m.contractCode===code)||{key:mapping.tradingInstrument,name:'COT unavailable',reports:[]};
    }
    return {market,observedReports};
}));
