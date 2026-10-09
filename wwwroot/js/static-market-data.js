(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory;
    else {
        const manifest = document.getElementById('static-market-manifest');
        if (manifest) root.StaticMarketData = factory(JSON.parse(manifest.textContent), root.fetch.bind(root));
    }
}(typeof globalThis === 'object' ? globalThis : this, function (manifest, fetchJson) {
    if (manifest.schemaVersion !== 1) throw new Error('Unsupported static data version');
    const cache = new Map();
    async function read(path) {
        // Only the current export's same-origin, content-addressed files are allowed.
        if (!/^\/data\/(prices|cot|screener)\/[A-Za-z0-9_-]+\.[a-f0-9]{20}\.json$/.test(path))
            throw new Error('Invalid static data path');
        if (!cache.has(path)) {
            const request = (async () => {
                const response = await fetchJson(path, { headers: { Accept: 'application/json' } });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.json();
            })();
            cache.set(path, request);
            request.catch(() => { if (cache.get(path) === request) cache.delete(path); });
        }
        return cache.get(path);
    }
    function assetFor(key) {
        const asset = manifest.assets.find(item => item.key === key);
        if (!asset) throw new Error('Unknown asset');
        return asset;
    }
    function checkAbort(signal) {
        if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
    }
    return {
        exportedAt: manifest.exportedAt,
        async screener() {
            if (!manifest.screener) throw new Error('Screener snapshot unavailable');
            const payload = await read(manifest.screener.path);
            if (payload.schemaVersion !== 1 || !Array.isArray(payload.assets)) throw new Error('Invalid screener snapshot');
            return payload;
        },
        async prices(key) {
            const asset = assetFor(key);
            const payload = await read(asset.prices.path);
            if (payload.assetKey !== key || !Array.isArray(payload.prices)) throw new Error('Invalid prices snapshot');
            return { assetKey: key, prices: payload.prices.map(([date, close]) => ({ date, close })), isUpdating: false, error: null };
        },
        async cot(key, lookbackWeeks, signal) {
            if (![26, 52, 156].includes(lookbackWeeks)) throw new Error('Invalid COT lookback');
            checkAbort(signal);
            const asset = assetFor(key);
            const markets = await Promise.all(asset.cot.markets.map(async market => {
                const payload = await read(manifest.contracts[market.contractCode].files[String(lookbackWeeks)]);
                if (payload.contractCode !== market.contractCode || payload.lookbackWeeks !== lookbackWeeks || !Array.isArray(payload.reports))
                    throw new Error('Invalid COT snapshot');
                return { ...market, reports: payload.reports };
            }));
            checkAbort(signal);
            return { assetKey: key, assetName: asset.name, reportType: 'CFTC Legacy · Futures Only', lookbackWeeks, note: asset.cot.note, markets };
        }
    };
}));
