// Build-time analysis only: visitors download the small summary, never all price histories.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {summarize} = require('../wwwroot/js/screener-metrics.js');
const dir = path.resolve(process.argv[2]);
const manifestPath = path.join(dir, 'data/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const asOf = new Intl.DateTimeFormat('sv-SE', {timeZone:'Europe/Prague'}).format(new Date(manifest.exportedAt));
const contracts = new Map();
function latestCot(market) {
    if (!contracts.has(market.contractCode)) {
        const file = manifest.contracts[market.contractCode].files['52'];
        const reports = JSON.parse(fs.readFileSync(path.join(dir, file))).reports;
        contracts.set(market.contractCode, reports.filter(r => r.date <= asOf).at(-1));
    }
    const report = contracts.get(market.contractCode);
    return {key:market.key,name:market.name,isQuoteCurrency:market.isQuoteCurrency,isDollarIndex:market.isDollarIndex,
        date:report?.date || null,index:report?.commercial.index ?? null,change:report?.commercial.change ?? null};
}
const assets = manifest.assets.map(asset => {
    const prices = JSON.parse(fs.readFileSync(path.join(dir, asset.prices.path))).prices;
    const windows = {};
    for (const days of [14,30,60]) for (const lookback of ['10','20','all'])
        windows[`${days}:${lookback}`] = summarize(prices, asOf, days, lookback);
    return {key:asset.key,name:asset.name,aliases:asset.aliases,lastDate:asset.prices.lastDate,windows,cot:asset.cot.markets.map(latestCot),cotNote:asset.cot.note};
});
const payload = JSON.stringify({schemaVersion:1,asOf,exportedAt:manifest.exportedAt,assets});
const hash = crypto.createHash('sha256').update(payload).digest('hex').slice(0,20);
const url = `/data/screener/summary.${hash}.json`;
fs.mkdirSync(path.join(dir,'data/screener'),{recursive:true});
fs.writeFileSync(path.join(dir,url),payload);
manifest.screener = {path:url,asOf};
const safeManifest = JSON.stringify(manifest).replace(/[<>&\u2028\u2029]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
fs.writeFileSync(manifestPath,safeManifest);
const htmlPath = path.join(dir,'index.html');
const html = fs.readFileSync(htmlPath,'utf8');
if (!html.includes('id="static-market-manifest"')) throw Error('Missing embedded manifest');
fs.writeFileSync(htmlPath,html.replace(/(<script id="static-market-manifest" type="application\/json">)[\s\S]*?(<\/script>)/,
    (_,start,end)=>start+safeManifest+end));
console.log(`Screener ready: ${assets.length} instruments, ${asOf}, ${(Buffer.byteLength(payload)/1024).toFixed(0)} KiB`);
