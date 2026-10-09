const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const factory = require('../wwwroot/js/static-market-data.js');

async function adapterChecks() {
    const pricePath = '/data/prices/EURUSD.' + 'a'.repeat(20) + '.json';
    const cotPath = '/data/cot/099741-52.' + 'b'.repeat(20) + '.json';
    const market = { key: 'EUR', name: 'Euro', contractCode: '099741', isQuoteCurrency: false, isDollarIndex: false };
    const manifest = { schemaVersion: 1, assets: [
        { key: 'EURUSD', name: 'EUR/USD', prices: { path: pricePath }, cot: { markets: [market], note: 'FX' } },
        { key: 'EURGBP', name: 'EUR/GBP', prices: { path: pricePath }, cot: { markets: [market], note: 'Cross' } },
        { key: 'AAPL', name: 'Apple', cot: { markets: [], note: null } }
    ], contracts: { '099741': { files: { '52': cotPath } } } };
    const requests = [];
    const client = factory(manifest, async url => {
        requests.push(url);
        return { ok: true, json: async () => url === pricePath ? { assetKey: 'EURUSD', prices: [['2026-01-02', 1.05]] }
            : { contractCode: '099741', lookbackWeeks: 52, reports: [{ date: '2026-01-06' }] } };
    });
    assert.equal(requests.length, 0, 'Constructing the frontend must not fetch all tickers');
    const prices = await client.prices('EURUSD');
    assert.deepEqual(prices.prices, [{ date: '2026-01-02', close: 1.05 }]);
    await client.prices('EURUSD');
    assert.equal(requests.length, 1, 'Prices must be reused');
    const first = await client.cot('EURUSD', 52);
    const second = await client.cot('EURGBP', 52);
    assert.equal(first.markets[0].reports, second.markets[0].reports, 'A shared futures contract must be fetched once');
    assert.equal(requests.length, 2);
    assert.equal((await client.cot('AAPL', 52)).markets.length, 0);
    assert.equal(requests.length, 2, 'Unsupported COT must not fetch an unrelated report');
    await assert.rejects(client.cot('EURUSD', 156, { aborted: true }), { name: 'AbortError' });
    await assert.rejects(client.prices('INVALID'), /Unknown asset/);
    await assert.rejects(client.cot('EURUSD', 25), /Invalid COT lookback/);
    let attempts = 0;
    const retry = factory(manifest, async () => ({ ok: ++attempts > 1, status: 503, json: async () => ({ assetKey: 'EURUSD', prices: [] }) }));
    await assert.rejects(retry.prices('EURUSD'), /503/);
    await retry.prices('EURUSD');
    assert.equal(attempts, 2, 'Failed requests must not poison the cache');
    const unsafe = factory({ ...manifest, assets: [{ key: 'BAD', prices: { path: 'https://example.com/data.json' } }] }, () => assert.fail('External fetch'));
    await assert.rejects(unsafe.prices('BAD'), /Invalid static data path/);
    console.log('Static adapter checks passed: lazy reads, shared-contract cache, payload conversion, cancellation, retry and same-origin paths.');
}

function exportChecks(directory) {
    const root = path.resolve(directory);
    const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative.replace(/^\//, '')), 'utf8'));
    const manifest = read('data/manifest.json');
    assert.equal(manifest.schemaVersion, 1);
    assert.ok(Number.isFinite(Date.parse(manifest.exportedAt)));
    const seen = new Set();
    function checkHash(url) {
        assert.match(url, /^\/data\/(prices|cot|screener)\/[A-Za-z0-9_-]+\.[a-f0-9]{20}\.json$/);
        const bytes = fs.readFileSync(path.join(root, url.slice(1)));
        assert.ok(url.includes('.' + crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 20) + '.json'));
        seen.add(url);
        return JSON.parse(bytes);
    }
    let totalPrices = 0, supported = 0;
    if (manifest.screener) {
        const screener=checkHash(manifest.screener.path);
        assert.equal(screener.schemaVersion,1);
        assert.equal(screener.assets.length,manifest.assets.length);
        assert.equal(screener.asOf,manifest.screener.asOf);
        assert.equal(screener.exportedAt,manifest.exportedAt);
        const {summarize}=require('../wwwroot/js/screener-metrics.js');
        for (let i=0;i<screener.assets.length;i++) {
            const asset=screener.assets[i],catalog=manifest.assets[i];
            assert.equal(asset.key,catalog.key);
            const prices=read(catalog.prices.path).prices;
            for(const days of [14,30,60])for(const years of ['10','20','all'])
                assert.deepEqual(asset.windows[`${days}:${years}`],summarize(prices,screener.asOf,days,years));
            for(const cot of asset.cot) {
                const market=catalog.cot.markets.find(m=>m.key===cot.key);
                assert.ok(market);
                const latest=read(manifest.contracts[market.contractCode].files['52']).reports.filter(r=>r.date<=screener.asOf).at(-1);
                assert.equal(cot.index,latest?.commercial.index ?? null);
                assert.equal(cot.change,latest?.commercial.change ?? null);
            }
        }
    }
    for (const asset of manifest.assets) {
        const payload = checkHash(asset.prices.path);
        assert.equal(payload.assetKey, asset.key);
        assert.equal(payload.prices.length, asset.prices.count);
        let previous = '';
        for (const [date, close] of payload.prices) {
            assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
            assert.ok(date > previous && Number.isFinite(close), 'Prices must be unique, sorted and numeric');
            previous = date;
        }
        assert.equal(asset.prices.lastDate, previous || null);
        totalPrices += payload.prices.length;
        if (asset.cot.markets.length) supported++;
        for (const market of asset.cot.markets) assert.ok(manifest.contracts[market.contractCode]);
    }
    for (const [code, contract] of Object.entries(manifest.contracts)) {
        for (const weeks of [26, 52, 156]) {
            const payload = checkHash(contract.files[weeks]);
            assert.equal(payload.contractCode, code);
            assert.equal(payload.lookbackWeeks, weeks);
            assert.equal(payload.reports.length, contract.count);
            let previous = '';
            payload.reports.forEach((report, i) => {
                assert.ok(report.date > previous);
                previous = report.date;
                for (const key of ['commercial', 'nonCommercial', 'nonReportable']) {
                    const group = report[key];
                    assert.equal(group.net, group.long - group.short);
                    if (i + 1 < weeks) assert.equal(group.index, null);
                    else {
                        const window = payload.reports.slice(i + 1 - weeks, i + 1).map(row => row[key].net);
                        const min = Math.min(...window), max = Math.max(...window);
                        if (min === max) assert.equal(group.index, null);
                        else assert.ok(Math.abs(group.index - 100 * (group.net - min) / (max - min)) <= .00501, 'Index must match the original formula');
                    }
                    const prior = payload.reports[i - 1];
                    const weekly = prior && Date.parse(report.date) - Date.parse(prior.date) === 7 * 86400000;
                    assert.equal(group.change, weekly ? group.net - prior[key].net : null);
                }
            });
            assert.equal(contract.lastDate, previous);
        }
    }
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.ok(html.includes('id="static-market-manifest"'));
    assert.ok(!html.includes('@Url.') && !html.includes('@Model.') && !html.includes('asp-append-version='), 'HTML must be fully rendered');
    assert.ok(!html.includes('/Seasonality/Data') && !html.includes('/Seasonality/CotData'), 'No live API endpoint may be required');
    for (const match of html.matchAll(/(?:src|href)="(\/(?:js|css|lib)\/[^"?]+)(?:\?[^"]*)?"/g))
        assert.ok(fs.existsSync(path.join(root, match[1].slice(1))), 'Missing frontend asset: ' + match[1]);
    const embedded = html.match(/<script id="static-market-manifest" type="application\/json">([\s\S]*?)<\/script>/);
    assert.deepEqual(JSON.parse(embedded[1]), manifest, 'HTML and data must share exactly one snapshot');
    function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => item.isDirectory() ? files(path.join(dir, item.name)) : [path.join(dir, item.name)]); }
    const exported = files(root);
    const bytes = exported.reduce((sum, file) => sum + fs.statSync(file).size, 0);
    assert.ok(bytes < 240 * 1024 * 1024 && exported.length <= 15000, 'Export must fit Azure Free limits');
    assert.ok(!exported.some(file => /appsettings|\.dll$|\.cshtml$|\.pdb$/i.test(file)), 'No server configuration/binaries may be published');
    console.log(`Static export checks passed: ${manifest.assets.length} tickers, ${totalPrices} prices, ${supported} COT-supported assets, ${Object.keys(manifest.contracts).length} contracts, ${(bytes / 1048576).toFixed(2)} MiB; hashes, index/weekly parity, HTML and local assets validated.`);
}
adapterChecks().then(() => { if (process.argv[2]) exportChecks(process.argv[2]); }).catch(error => { console.error(error); process.exitCode = 1; });
