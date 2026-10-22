(function(root,factory){
    if(typeof module==='object'&&module.exports)module.exports=factory(require('./core-market-registry.js'));
    else root.OpportunityExposures=factory(root.CoreMarkets);
}(typeof globalThis==='object'?globalThis:this,function(registry){
    const groups={QQQ:'Nasdaq',NDX:'Nasdaq',SPX:'S&P500',SPY:'S&P500',DJI:'Dow',DIA:'Dow',RUT:'Russell',IWM:'Russell'};
    function exposures(a,c){
        const sign=c.direction==='up'?1:-1;
        if(a.assetClass==='forex')return [{group:a.key.slice(0,3),sign},{group:a.key.slice(3),sign:-sign}];
        return [{group:a.mapping?.exposureFamily||registry?.get(a.key)?.exposureFamily||groups[a.key]||a.market?.key||a.key,sign}];
    }
    function warnings(rows){
        const top=rows.slice(0,5),counts=new Map();
        for(const {a,c} of top)for(const e of exposures(a,c)){
            const key=e.group+(e.sign>0?' long':' short');counts.set(key,(counts.get(key)||0)+1);
        }
        return [...counts].filter(([,n])=>n>=2).map(([key,n])=>`⚠ Koncentrace ${key}: ${n} z TOP ${top.length} kandidátů.`);
    }
    function diversified(rows){
        const picked=[],deferred=[],used=new Set();
        for(const row of rows){const keys=exposures(row.a,row.c).map(e=>e.group+':'+e.sign);
            if(keys.some(k=>used.has(k)))deferred.push(row);else {picked.push(row);keys.forEach(k=>used.add(k));}}
        return [...picked,...deferred]; // Raw scores are unchanged; not portfolio optimization.
    }
    return {exposures,warnings,diversified};
}));
