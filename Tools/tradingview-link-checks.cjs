const assert=require('node:assert/strict'),fs=require('node:fs');
const {chart}=require('../wwwroot/js/tradingview-links.js');
for(const [key,symbol] of Object.entries({EURUSD:'OANDA:EURUSD',GBPJPY:'OANDA:GBPJPY',NDX:'NASDAQ:NDX',QQQ:'NASDAQ:QQQ',
    XAUUSD:'OANDA:XAUUSD',CORN:'CBOT:ZC1!',CORNETF:'AMEX:CORN',MILK:'CME:DC1!',BUTTER:'CME:CB1!',CHEESE:'CME:CSC1!',SOYBETF:'AMEX:SOYB'})){
    const result=chart(key),url=new URL(result.url);
    assert.equal(result.symbol,symbol);assert.equal(url.origin,'https://www.tradingview.com');
    assert.equal(url.pathname,'/chart/');assert.equal(url.searchParams.get('symbol'),symbol);
    assert.match(result.title,/nové záložce/);
}
for(const key of [null,undefined,'toString','__proto__','USDUSD','UNKNOWN','EURUSD&symbol=EVIL','<script>'])assert.equal(chart(key),null);
assert.match(chart('LUMBER').title,/ukončený/);
const ui=fs.readFileSync('wwwroot/js/opportunities-ui.js','utf8');
assert.match(ui,/actions.append\(button\)/);assert.match(ui,/actions.append\(link\)/);
assert.match(ui,/link.target='_blank'/);assert.match(ui,/link.rel='noopener noreferrer'/);
const layout=fs.readFileSync('Views/Shared/_Layout.cshtml','utf8');
assert.ok(layout.indexOf('tradingview-links.js')<layout.indexOf('opportunities-ui.js'));
if(process.argv[2]){
    const snapshot=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
    for(const asset of snapshot.assets)assert.ok(chart(asset.key),`Missing TradingView link: ${asset.key}`);
}
console.log('TradingView links: symbol mappings, ETF/futures distinction, safe URLs and new-tab actions passed.');
