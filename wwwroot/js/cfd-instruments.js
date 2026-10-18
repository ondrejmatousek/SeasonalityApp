(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.CfdInstruments=factory();})(typeof globalThis==='object'?globalThis:this,function(){
 const extraFx=['USDHKD','EURNOK','EURPLN','EURSEK','USDMXN','USDNOK','USDPLN','USDSEK','USDZAR','SGDJPY','USDSGD'];
 const crypto={BTCUSD:'BTC-USD',ETHUSD:'ETH-USD',SOLUSD:'SOL-USD',XRPUSD:'XRP-USD',BNBUSD:'BNB-USD'};
 const keys=['AUDCAD','AUDCHF','AUDJPY','AUDNZD','CADCHF','CADJPY','CHFJPY','EURCAD','EURCHF','EURAUD','EURGBP','EURJPY','EURNZD','GBPAUD','GBPCAD','GBPCHF','GBPJPY','GBPNZD','NZDCAD','NZDCHF','NZDJPY','NZDUSD','AUDUSD','EURUSD','GBPUSD','USDCAD','USDCHF','USDJPY',...extraFx,'BRENT','NATGAS','WTI','SILVER','XAUUSD','PLATINUM',...Object.keys(crypto)];
 const aliases={NGAS:'NATGAS',XAGUSD:'SILVER',XPTUSD:'PLATINUM'};
 return Object.freeze({version:'cfd-watchlist-v1',extraFx:Object.freeze(extraFx),crypto:Object.freeze(crypto),keys:Object.freeze(keys),aliases:Object.freeze(aliases),resolve:key=>aliases[key]||key});
});
