(function(root,factory){
    if(typeof module==='object'&&module.exports)module.exports=factory();
    else root.OpportunityConfidence=factory();
}(typeof globalThis==='object'?globalThis:this,function(){
    function assess(input){
        const {seasonal=0,recent=0,similar=0,other=0,verifiedPublications=false,completePrices=false,
            proxy=false,currentCot=false,priceProvenance=false,pricesFresh=false}=input,reasons=[];
        if(seasonal<10)reasons.push('Méně než 10 sezonálních případů');
        if(recent<5)reasons.push('Méně než 5 recent případů');
        if(!currentCot)reasons.push('COT neověřeno — chybí dostupná současná reference');
        if(similar<8)reasons.push(`COT omezený vzorek: ${similar} podobných případů`);
        if(other<8)reasons.push(`COT omezená kontrola: ${other} ostatních případů`);
        if(!verifiedPublications)reasons.push('Neúplná skutečná publikační historie / pouze observed upper bound');
        if(!completePrices)reasons.push('Neúplný cenový vzorek');
        if(!pricesFresh)reasons.push('Čerstvost cen není doložená / ceny starší než 7 dní');
        if(!priceProvenance)reasons.push('Neověřené historické úpravy cen a datové vintage');
        if(proxy)reasons.push('COT futures je proxy obchodovaného instrumentu');
        const low=seasonal<10||recent<5||!currentCot||similar<5||other<5||!verifiedPublications||!completePrices||!pricesFresh;
        const higher=!low&&seasonal>=12&&recent>=8&&similar>=8&&other>=8&&!proxy&&priceProvenance;
        return {level:low?'nízká':higher?'vyšší':'střední',reasons,samples:{seasonal,recent,similar,other}};
    }
    return {assess};
}));
