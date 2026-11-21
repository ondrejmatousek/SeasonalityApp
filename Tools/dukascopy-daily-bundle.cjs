const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const registry = require('./dukascopy-instruments.json');
const sha = value => createHash('sha256').update(value).digest('hex');

function build(source, output) {
    assert.equal(source.provider, 'Dukascopy');
    assert.equal(source.priceSide, 'BID');
    const groups = new Map();
    for (const row of source.rows.filter(row => row.interval === 'D1')) {
        if (!groups.has(row.key)) groups.set(row.key, []);
        groups.get(row.key).push(row);
    }
    output = path.resolve(output);
    assert.ok(output.startsWith(path.resolve('artifacts') + path.sep));
    fs.mkdirSync(output, { recursive: true });
    const entries = [];
    const observedYear = Number(source.builtAt.slice(0, 4));
    for (const [key, rows] of groups) {
        const isFx = registry.fx.includes(key);
        const assetKey = key === 'XAGUSD' ? 'SILVER' : key;
        const code = isFx ? key.slice(0, 3) + '-' + key.slice(3) : registry.cfd[key];
        assert.ok(code);
        const bars = rows.map(row => ({ ...row, date: isFx
            ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York' }).format(new Date((row.timestamp + 86400) * 1000))
            : new Date(row.timestamp * 1000).toISOString().slice(0, 10), completionEvidence: source.rule }));
        const years = new Set(bars.filter(bar => Number(bar.date.slice(0, 4)) < observedYear).map(bar => bar.date.slice(0, 4)));
        assert.ok(years.size >= 5, 'Complete independent daily history is required before seasonal cutover: ' + key);
        const id = 'dukascopy-bid:DUKASCOPY:' + code;
        const metadata = {
            id, assetKey, provider: 'Dukascopy', providerSymbol: 'DUKASCOPY:' + code,
            sourceIdentity: id, status: 'daily-connected', instrumentKind: isFx ? 'spot-forex' : 'cfd',
            assetClass: isFx ? 'forex' : ['NDX', 'SPX'].includes(key) ? 'index' : 'commodity',
            timeframe: '1D', timezone: isFx ? 'America/New_York' : 'UTC',
            sessionContract: isFx ? 'NY17 session-end-date' : 'Dukascopy native UTC daily candle',
            priceType: 'BID', dailySource: 'Direct Dukascopy GitHub Actions collection',
            htfEnabled: true, review: 'Independent Dukascopy history; no cross-provider concatenation',
            count: bars.length, firstDate: bars[0].date, lastDate: bars.at(-1).date
        };
        const body = JSON.stringify({ ...metadata, bars, htfBars: bars, prices: bars.map(bar => [bar.date, bar.close]) });
        const file = key + '.' + sha(body).slice(0, 20) + '.json';
        fs.writeFileSync(path.join(output, file), body);
        entries.push({ ...metadata, file });
    }
    for (const [assetKey, error] of Object.entries(registry.unavailable))
        entries.push({ assetKey, status: 'unavailable', provider: 'Dukascopy', error });
    const bundle = { schemaVersion: 1, version: 'dukascopy-direct-bid-v1', builtAt: source.builtAt, entries,
        ingestion: { inputSha256: sha(JSON.stringify(source)), instruments: [] } };
    fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(bundle));
    console.log(JSON.stringify({ bundle: path.join(output, 'manifest.json'), instruments: groups.size }));
    return bundle;
}

module.exports = { build };
if (require.main === module) build(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), process.argv[3]);
