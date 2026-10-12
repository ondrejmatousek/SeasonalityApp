// Proposed multi-provider registry. Not imported by production or browser code.
const core=require('../wwwroot/js/core-market-registry.js');
function proposed(inventory){return {version:'price-sources-twelve-pilot-v1',activationAllowed:false,entries:inventory.rows.filter(r=>r.scope==='core'&&r.oandaProbe).map(r=>{
    const fx=core.pairs.includes(r.key);return{key:r.key,assetClass:r.assetClass,status:'active-legacy',activeSeriesId:r.seasonalitySource.seriesId,activeProvider:'legacy-export',declaredPrimaryProvider:r.seasonalitySource.primaryProvider,activeSymbol:r.yahooSymbol,
        legacy:{...r.seasonalitySource,status:'legacy / rollback reference retained',composition:'Historical Yahoo/Stooq composition not exported'},
        candidate:fx?{canonicalSeriesId:`fx-spot:${r.key}:twelve-provider-daily-unverified:v1`,provider:'Twelve Data',providerSymbol:r.key.slice(0,3)+'/'+r.key.slice(3),sessionContract:{status:'unverified',timezone:null,cutoff:null},seasonalitySource:'same canonical candidate OHLC.close',htfSource:'same canonical candidate OHLC',status:'blocked-pending-pilot'}:null,
        seasonalitySource:r.seasonalitySource,htfSource:r.htfSource};}),profiles:['NQ','MNQ','ES','MES'].map(key=>({key,priceKey:core.get(key).priceKey}))};}
module.exports={proposed};
