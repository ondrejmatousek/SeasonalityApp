const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const candles = require('../wwwroot/js/market-candles.js');
const registry = require('./dukascopy-instruments.json');
const { saveManifest } = require('./apply-market-sources.cjs');
const hash = value => createHash('sha256').update(value).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const nyDate = timestamp => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York' }).format(new Date(timestamp * 1000));
const iso = timestamp => new Date(timestamp * 1000).toISOString();
const quote = row => ({ timestamp: row.timestamp, open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume });

function overlay(site, source) {
    site = path.resolve(site);
    assert.ok(site.startsWith(path.resolve('artifacts') + path.sep));
    assert.equal(source.provider, 'Dukascopy');
    assert.equal(source.priceSide, 'BID');
    assert.equal(source.rule, 'dukascopy-bid-ny17-h1-v1');
    assert.ok(Number.isFinite(Date.parse(source.builtAt)) && Date.parse(source.builtAt) <= Date.now() + 60000);
    const manifest = read(path.join(site, 'data/manifest.json'));
    const snapshot = read(path.join(site, manifest.zonePrices.path.slice(1)));
    const asOf = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague' }).format(new Date(source.builtAt));
    const groups = new Map();
    for (const row of source.rows) {
        assert.ok(Number.isSafeInteger(row.timestamp) && row.timestamp > 0);
        assert.ok(candles.valid({ ...row, date: '2000-01-01' }));
        assert.match(row.receiptId, /^[a-f0-9]{64}$/);
        const id = row.key + ':' + row.interval;
        if (!groups.has(id)) groups.set(id, []);
        const rows = groups.get(id);
        assert.ok(!rows.length || row.timestamp > rows.at(-1).timestamp);
        assert.ok((row.timestamp + (row.interval === 'H4' ? 14400 : 86400)) * 1000 <= Date.parse(source.builtAt) - 60000);
        rows.push(row);
    }
    const keys = [...registry.fx, ...Object.keys(registry.cfd)];
    for (const key of keys) {
        const targetKey = key === 'XAGUSD' ? 'SILVER' : key;
        const isFx = registry.fx.includes(key);
        const symbol = 'DUKASCOPY:' + (isFx ? key.slice(0, 3) + '-' + key.slice(3) : registry.cfd[key]);
        const daily = groups.get(key + ':D1') || [];
        const hourly = groups.get(key + ':H4') || [];
        assert.ok(daily.length >= 100 && hourly.length >= 100, 'Insufficient independent Dukascopy history for ' + key);
        const bars = daily.map(row => ({ ...quote(row), date: isFx ? nyDate(row.timestamp + 86400) : iso(row.timestamp).slice(0, 10) }));
        assert.ok(bars.every(bar => bar.date < asOf));
        assert.ok(Date.parse(asOf) - Date.parse(bars.at(-1).date) <= 7 * 86400000, 'Stale Dukascopy D1 ' + key);
        const h4Bars = hourly.slice(-2200).map(row => ({ ...quote(row), date: iso(row.timestamp), endDate: iso(row.timestamp + 14400) }));
        const latest = bars.at(-1);
        const previous = snapshot.prices[targetKey];
        snapshot.prices[targetKey] = {
            status: 'ready', provider: 'Dukascopy', symbol, timezone: isFx ? 'America/New_York' : 'UTC',
            observedAt: source.builtAt, sourceIdentity: 'dukascopy-bid:' + symbol,
            priceSeriesId: 'dukascopy-bid:' + symbol, contextCompatible: false,
            priceType: isFx ? 'Dukascopy BID FX' : 'Dukascopy BID CFD',
            review: 'Independent Dukascopy series. Seasonal and COT context retains its recorded source.',
            latestDate: latest.date, latestClose: latest.close, bars: bars.slice(-400),
            weekly: candles.weekly(bars, asOf).slice(-104),
            h4: {
                status: 'ready', provider: 'Dukascopy', symbol, timeframe: 'H4', timezone: 'UTC',
                sessionTimezone: 'America/New_York', validation: source.rule, contextCompatible: false,
                observedAt: source.builtAt, asOfUtc: source.builtAt, latestDate: h4Bars.at(-1).date,
                latestClose: h4Bars.at(-1).close, bars: h4Bars, weekly: [],
                validatedBarCount: hourly.length, dailyLifecycleBars: bars.slice(-400).map(bar => ({ ...bar, date: iso(bar.timestamp), endDate: iso(bar.timestamp + 86400) })),
                note: 'Four original complete H1 source bars per H4. Missing source hours are excluded.'
            }
        };
        if (!snapshot.assets.some(asset => asset.key === targetKey)) {
            snapshot.assets.push({ key: targetKey, name: targetKey, mapping: { scope: 'research', status: 'price-zone-only', priceSeriesId: 'dukascopy-bid:' + symbol, chartSource: { provider: 'Dukascopy', symbol }, cotSources: [], cotMode: 'unavailable' } });
        }
        assert.ok(!previous?.h4 || snapshot.prices[targetKey].h4.provider === 'Dukascopy');
    }
    for (const [key, error] of Object.entries(registry.unavailable)) {
        if (snapshot.prices[key]) snapshot.prices[key] = { status: 'unavailable', provider: 'Dukascopy', bars: [], weekly: [], error };
    }
    snapshot.asOf = asOf;
    snapshot.builtAt = source.builtAt;
    snapshot.h4 = { provider: 'Dukascopy', source: 'Azure SQL dukascopy', validationRule: source.rule, live: { newestReceivedAt: source.builtAt }, scope: 'Independent Dukascopy FX/CFD zones' };
    const bytes = JSON.stringify(snapshot);
    const url = '/data/screener/zone-prices.' + hash(bytes).slice(0, 20) + '.json';
    fs.writeFileSync(path.join(site, url.slice(1)), bytes);
    manifest.zonePrices = { ...manifest.zonePrices, path: url, asOf, h4: snapshot.h4 };
    manifest.dukascopy = { provider: 'Dukascopy', priceSide: 'BID', observedAt: source.builtAt, rule: source.rule, instruments: keys.length, receiptIds: [...new Set(source.rows.map(row => row.receiptId))], unavailable: registry.unavailable, seasonalHistory: 'Independent source histories' };
    manifest.h4Publication = { status: 'verified', provider: 'Dukascopy', liveObservedAt: source.builtAt };
    saveManifest(site, manifest);
    console.log(JSON.stringify(manifest.dukascopy));
}

module.exports = { overlay };
if (require.main === module) overlay(process.argv[2], read(process.argv[3]));
