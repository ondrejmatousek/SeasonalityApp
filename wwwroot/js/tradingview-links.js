(function(root,factory){
    const api=factory();
    if(typeof module==='object'&&module.exports)module.exports=api;
    else root.TradingViewLinks=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
    // Map the price instrument, never its COT proxy (e.g. QQQ must not open NDX).
    const symbols={
        DXY:'TVC:DXY',SPX:'SP:SPX',NDX:'NASDAQ:NDX',DJI:'DJ:DJI',RUT:'TVC:RUT',VIX:'CBOE:VIX',NIKKEI225:'TVC:NI225',
        XAUUSD:'OANDA:XAUUSD',SILVER:'COMEX:SI1!',COPPER:'COMEX:HG1!',PLATINUM:'NYMEX:PL1!',PALLADIUM:'NYMEX:PA1!',
        WTI:'NYMEX:CL1!',BRENT:'NYMEX:BZ1!',NATGAS:'NYMEX:NG1!',GASOLINE:'NYMEX:RB1!',HEATINGOIL:'NYMEX:HO1!',
        CORN:'CBOT:ZC1!',WHEAT:'CBOT:ZW1!',KCWHEAT:'CBOT:KE1!',SOYBEANS:'CBOT:ZS1!',OATS:'CBOT:ZO1!',RICE:'CBOT:ZR1!',
        SOYBEANOIL:'CBOT:ZL1!',SOYBEANMEAL:'CBOT:ZM1!',COFFEE:'ICEUS:KC1!',SUGAR:'ICEUS:SB1!',COTTON:'ICEUS:CT1!',
        COCOA:'ICEUS:CC1!',ORANGEJUICE:'ICEUS:OJ1!',LIVECATTLE:'CME:LE1!',FEEDERCATTLE:'CME:GF1!',LEANHOGS:'CME:HE1!',
        MILK:'CME:DC1!',BUTTER:'CME:CB1!',CHEESE:'CME:CSC1!',LUMBER:'CME:LBS1!',
        BTCUSD:'BITSTAMP:BTCUSD',ETHUSD:'BITSTAMP:ETHUSD',SOLUSD:'COINBASE:SOLUSD',XRPUSD:'COINBASE:XRPUSD',
        QQQ:'NASDAQ:QQQ',TLT:'NASDAQ:TLT',IEF:'NASDAQ:IEF',CORNETF:'AMEX:CORN',SOYBETF:'AMEX:SOYB'
    };
    for(const key of ['SPY','DIA','IWM','EFA','EEM','GLD','SLV','USO','UNG','CPER','WEAT','CANE','XLE','XLF','XLK','XLV','XLY','XLP','XLI','XLU','XLB'])symbols[key]='AMEX:'+key;
    const currencies=new Set(['EUR','GBP','USD','JPY','CHF','AUD','NZD','CAD']);
    function chart(key){
        if(typeof key!=='string')return null;
        let symbol=Object.hasOwn(symbols,key)?symbols[key]:null;
        if(!symbol&&key.length===6&&currencies.has(key.slice(0,3))&&currencies.has(key.slice(3))&&key.slice(0,3)!==key.slice(3))symbol='OANDA:'+key;
        if(!symbol)return null; // Do not silently send unknown assets to an unrelated ticker.
        const kind=symbol.endsWith('1!')?'Průběžný futures kontrakt. ':symbol.startsWith('OANDA:')?'Spotový graf OANDA. ':'';
        const warning=key==='LUMBER'?'Historický ukončený kontrakt LBS, nikoli nový Lumber LBR. ':'';
        return {symbol,url:'https://www.tradingview.com/chart/?symbol='+encodeURIComponent(symbol),
            title:`Otevřít ${key} v TradingView (${symbol}) v nové záložce. ${warning}${kind}Zdroj cen se může lišit od aplikace.`};
    }
    return {chart};
});
