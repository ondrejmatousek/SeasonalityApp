(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.SeasonalityYearTrends = factory();
}(typeof globalThis === 'object' ? globalThis : this, function () {
    function createLookup() {
        // Price loads replace the array. Cache by its identity, not ticker name,
        // so fresh data invalidates the index and old arrays can be collected.
        const cache = new WeakMap();
        return function yearTrend(rows, year) {
            let trends = cache.get(rows);
            if (!trends) {
                const bounds = new Map();
                for (const row of rows) {
                    const rowYear = new Date(row.date).getFullYear();
                    const range = bounds.get(rowYear);
                    if (!range) bounds.set(rowYear, { first: row, last: row });
                    else {
                        if (row.date < range.first.date) range.first = row;
                        if (row.date >= range.last.date) range.last = row;
                    }
                }
                trends = new Map([...bounds].map(([key, range]) =>
                    [key, range.last.close >= range.first.close ? 'bullish' : 'bearish']));
                cache.set(rows, trends);
            }
            return trends.get(year) || 'bearish';
        };
    }
    return { createLookup };
}));
