// Canonical, versioned mapping registry. Consumed by the offline builder and browser.
(function(root,factory){
    if(typeof module==='object'&&module.exports)module.exports=factory();
    else root.CoreMarkets=factory();
}(typeof globalThis==='object'?globalThis:this,function(){
    const version='core-markets-v1';
    const currencies={EUR:'099741',GBP:'096742',JPY:'097741',CHF:'092741',CAD:'090741',AUD:'232741',NZD:'112741'};
    const pairs=['EURUSD','GBPUSD','USDJPY','USDCHF','AUDUSD','NZDUSD','USDCAD','EURGBP','EURJPY','EURCHF','EURAUD','EURCAD','EURNZD','GBPJPY','GBPCHF','GBPAUD','GBPCAD','GBPNZD','AUDJPY','AUDNZD','AUDCAD','AUDCHF','NZDJPY','NZDCAD','NZDCHF','CADJPY','CADCHF','CHFJPY'];
    const entries={};
    const cotCurrency=k=>k==='USD'?{key:k,kind:'neutral-reference',contractCode:null}:{key:k,kind:'currency-futures',contractCode:currencies[k]};
    for(const key of pairs){const base=key.slice(0,3),quote=key.slice(3);
        entries[key]={version,tradingInstrument:key,priceKey:key,priceSeriesId:'fx-spot:'+key,priceKind:'fx-spot',
            chartSource:{provider:'Yahoo Finance',symbol:({USDJPY:'JPY=X',USDCAD:'CAD=X'})[key]||key+'=X'},
            cotSources:[cotCurrency(base),cotCurrency(quote)],cotMode:'relative-cot-state-v1',base,quote,
            proxyRelationship:'Relative currency futures positioning; USD is a neutral reference, not DXY',exposureFamily:'FX',
            scope:'core',status:'validated-ranking-ready',executionKind:'spot-or-cfd'};
    }
    for(const [family,priceKeys,profiles,code,root,name] of [
        ['Nasdaq',['NDX','QQQ'],['NQ','MNQ'],'209742','NDX','Nasdaq-100 futures (NQ)'],
        ['S&P500',['SPX','SPY'],['ES','MES'],'13874A','SPX','S&P 500 futures (ES)']]){
        for(const key of [...priceKeys,...profiles]){const profile=profiles.includes(key),priceKey=profile?priceKeys[0]:key;
            entries[key]={version,tradingInstrument:key,priceKey,priceSeriesId:(priceKey===priceKeys[0]?'cash-index:':'etf:')+priceKey,
                chartSource:{provider:'Yahoo Finance',symbol:({NDX:'^NDX',SPX:'^GSPC',QQQ:'QQQ',SPY:'SPY'})[priceKey]},
                priceKind:priceKey===priceKeys[0]?'cash-index':'etf',cotSources:[{key:root,contractCode:code,name,kind:'index-futures'}],
                cotMode:'legacy-commercial-index-52',proxyRelationship:'Futures positioning proxy; reference price return is not execution P&L',
                exposureFamily:family,scope:'core',status:'validated-ranking-ready',executionKind:profile?'futures-profile':'cash-or-etf',
                tradingViewSymbol:profile?'CME_MINI:'+key+'1!':null};
        }
    }
    entries.XAUUSD={version,tradingInstrument:'XAUUSD',priceKey:'XAUUSD',priceSeriesId:'legacy:XAUUSD-GC-mixed',
        futureSpotSeriesId:'gold-spot:XAUUSD:v1',priceKind:'legacy-unverified',cotSources:[{key:'GOLD',contractCode:'088691',name:'COMEX Gold futures',kind:'gold-futures'}],
        cotMode:'legacy-commercial-index-52',proxyRelationship:'Blocked: legacy GC=F / spot fallback is not validated gold spot',
        exposureFamily:'Gold',scope:'research',status:'data-source-not-validated',executionKind:'spot-or-cfd'};
    function get(key){return entries[key]||null;}
    function resolve(asset){const known=get(asset.key);if(known&&(known.executionKind!=='futures-profile'||asset.isTradingProfile))return known;
        return {version,tradingInstrument:asset.key,priceKey:asset.key,priceSeriesId:'legacy:'+asset.key,priceKind:'legacy-unverified',
            cotSources:(asset.cot?.markets||[]).map(m=>({...m,kind:'legacy-proxy'})),cotMode:'legacy-commercial-index-52',
            proxyRelationship:'Research only / unsupported for validated ranking',exposureFamily:asset.key,
            scope:'research',status:asset.assetClass==='commodity'?'research-only':'descriptive-ready',executionKind:'legacy'};
    }
    const labels={'validated-ranking-ready':'Core · jasná datová identita (ne potvrzení ziskovosti)',
        'descriptive-ready':'Mimo core scope · pouze popisná analýza','research-only':'Research only / unsupported for validated ranking',
        unavailable:'Cenová data nejsou dostupná','data-source-not-validated':'Neověřený cenový zdroj · blokováno','COT-unavailable':'Chybí použitelný COT'};
    function visible(asset,research=false){return asset.dataStatus==='validated-ranking-ready'||research;}
    function sourceText(mapping){return `Seasonality: ${mapping.priceKey} (${mapping.priceKind}) · COT: ${mapping.cotSources.map(s=>s.kind==='neutral-reference'?'USD reference':s.name||s.key+' futures').join(' + ')} · Exposure: ${mapping.exposureFamily} · Trading profile: ${mapping.tradingInstrument}`;}
    // Prevent accidental mutation of canonical mappings by callers.
    function freeze(o){for(const v of Object.values(o))if(v&&typeof v==='object')freeze(v);return Object.freeze(o);}
    freeze(entries);freeze(currencies);Object.freeze(pairs);
    return {version,pairs,entries,get,resolve,visible,labels,sourceText};
}));
