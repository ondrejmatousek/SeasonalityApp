const assert=require('node:assert/strict'),fs=require('node:fs');
const categories=require('../wwwroot/js/asset-categories.js');
const assets=[
    {key:'EURUSD',assetClass:'forex',commodityGroup:null},
    {key:'DXY',assetClass:'index',commodityGroup:null},
    {key:'NDX',assetClass:'index',commodityGroup:null},
    {key:'QQQ',assetClass:'etf',commodityGroup:null},
    {key:'GLD',assetClass:'etf',commodityGroup:null},
    {key:'LIVECATTLE',assetClass:'commodity',commodityGroup:'livestock'},
    {key:'FEEDERCATTLE',assetClass:'commodity',commodityGroup:'livestock'},
    {key:'LEANHOGS',assetClass:'commodity',commodityGroup:'livestock'},
    {key:'MILK',assetClass:'commodity',commodityGroup:'dairy'},
    {key:'XAUUSD',assetClass:'commodity',commodityGroup:'metals'},
    {key:'BTCUSD',assetClass:'crypto',commodityGroup:null},
    {key:'AAPL',assetClass:'equity',commodityGroup:null}
];
const keys=(type,group)=>assets.filter(a=>categories.matches(a,type,group)).map(a=>a.key);
assert.equal(keys('all','livestock').length,assets.length,'Hidden subgroup cannot filter all markets');
assert.deepEqual(keys('index'),['DXY','NDX'],'ETF proxies are not indices');
assert.deepEqual(keys('forex'),['EURUSD'],'Gold and crypto are not FX pairs');
assert.deepEqual(keys('commodity','livestock'),['LIVECATTLE','FEEDERCATTLE','LEANHOGS']);
assert.deepEqual(keys('commodity','dairy'),['MILK']);
assert.equal(keys('commodity').length,5);
assert.equal(categories.label('commodity','livestock'),'Komodity · Maso a dobytek');
assert.equal(categories.label('forex','livestock'),'Forex');
assert.equal(categories.matches({key:'UNKNOWN'},'index'),false,'Missing metadata cannot silently invent a category');
const html=fs.readFileSync('Views/Seasonality/Index.cshtml','utf8');
for(const [value,label] of Object.entries(categories.classes))assert.ok(html.includes(`value="${value}">${label}</option>`),`Missing class option ${value}`);
for(const group of Object.keys(categories.groups))assert.ok(html.includes(`value="${group}"`),`Missing subgroup ${group}`);
assert.ok(html.indexOf('id="screener-asset-class"')<html.indexOf('id="screener-auto-view"'),'Shared filter outside both modes');
for(const file of ['screener.js','opportunities-ui.js']){
    const source=fs.readFileSync('wwwroot/js/'+file,'utf8');
    assert.ok(source.includes('AssetCategories.matches')&&source.includes('screener-market-filter-change'),`Both modes use identical filtering: ${file}`);
}
const auto=fs.readFileSync('wwwroot/js/opportunities-ui.js','utf8');
for(const id of ['seasonality-years','seasonality-monthly-years','confluence-history','opportunity-history','screener-lookback']){
    const select=html.match(new RegExp(`<select[^>]*id="${id}"[^>]*>([\\s\\S]*?)</select>`));
    assert.ok(select,`Missing history control ${id}`);
    assert.match(select[1],/<option value="20" selected>/,`Default history must be 20 years: ${id}`);
    assert.doesNotMatch(select[1],/<option value="10" selected>/);
}
assert.match(auto,/history:'20'/,'Best-preset must keep the 20-year default');
const preset=auto.slice(auto.indexOf("byId('opportunity-best')"));
assert.ok(!preset.includes("byId('screener-asset-class').value="),'Best-preset must preserve chosen market');
console.log('Asset-category checks passed: exclusive classes, food subgroups, hidden-group behavior, shared modes and preset preservation.');
