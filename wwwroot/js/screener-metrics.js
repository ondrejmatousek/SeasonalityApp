(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ScreenerMetrics = factory();
}(typeof globalThis === 'object' ? globalThis : this, function () {
    const day = 86400000;
    const iso = date => date.toISOString().slice(0, 10);
    const median = values => {
        const sorted = [...values].sort((a, b) => a - b), n = sorted.length;
        return n ? (sorted[Math.floor(n / 2)] + sorted[Math.floor((n - 1) / 2)]) / 2 : null;
    };
    function summarize(rows, asOf, days, lookback) {
        const anchor = new Date(asOf + 'T00:00:00Z');
        const samples = [];
        const firstYear = rows.length ? Number(rows[0][0].slice(0, 4)) : anchor.getUTCFullYear();
        const minYear = lookback === 'all' ? firstYear : Math.max(firstYear, anchor.getUTCFullYear() - Number(lookback));
        function lowerBound(date) {
            let lo = 0, hi = rows.length;
            while (lo < hi) { const mid = (lo + hi) >>> 1; if (rows[mid][0] < date) lo = mid + 1; else hi = mid; }
            return lo;
        }
        for (let year = minYear; year < anchor.getUTCFullYear(); year++) {
            const start = new Date(Date.UTC(year, anchor.getUTCMonth(), anchor.getUTCDate()));
            // Feb 29 does not exist in non-leap years; use Feb 28.
            if (start.getUTCMonth() !== anchor.getUTCMonth()) start.setUTCDate(0);
            const end = new Date(start.getTime() + days * day);
            if (end >= anchor) continue; // Never use unfinished windows or future prices.
            const startIndex = lowerBound(iso(start));
            let endIndex = lowerBound(iso(end));
            if (endIndex === rows.length || rows[endIndex][0] !== iso(end)) endIndex--;
            if (startIndex >= endIndex || !rows[startIndex] || !rows[endIndex]) continue;
            if (new Date(rows[startIndex][0]) - start > 7 * day || end - new Date(rows[endIndex][0]) > 7 * day) continue;
            const base = rows[startIndex][1];
            if (!(base > 0)) continue;
            let minimum = 0, maximum = 0, valid = true;
            for (let i = startIndex; i <= endIndex; i++) {
                const close = rows[i][1];
                if (!(close > 0) || !Number.isFinite(close)
                    || (i > startIndex && new Date(rows[i][0]) - new Date(rows[i - 1][0]) > 7 * day)) { valid = false; break; }
                const change = (close / base - 1) * 100;
                minimum = Math.min(minimum, change); maximum = Math.max(maximum, change);
            }
            if (valid) samples.push({year, value: (rows[endIndex][1] / base - 1) * 100, minimum, maximum});
        }
        const values = samples.map(item => item.value), count = samples.length;
        return {
            count, mean: count ? values.reduce((sum, v) => sum + v, 0) / count : null,
            median: median(values), winRate: count ? values.filter(v => v > 0).length / count * 100 : null,
            medianDrop: median(samples.map(item => item.minimum)), medianRise: median(samples.map(item => item.maximum)),
            best: count ? Math.max(...values) : null, worst: count ? Math.min(...values) : null,
            years: samples.map(item => item.year)
        };
    }
    return { summarize, median };
}));
