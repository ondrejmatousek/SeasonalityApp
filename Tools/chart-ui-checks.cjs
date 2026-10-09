const assert = require('node:assert/strict');
const { indexRange, tooltipPosition, exportScale, pngFilename } = require('../wwwroot/js/market-chart-ui.js');
const geometry = require('../wwwroot/js/seasonality-geometry.js');
const { createLookup } = require('../wwwroot/js/seasonality-year-trends.js');
const trendLookup = createLookup();
const trendRows = [
    { date: '2024-12-31', close: 90 }, { date: '2025-12-31', close: 110 },
    { date: '2024-01-01', close: 100 }, { date: '2025-01-01', close: 100 },
    { date: '2026-01-01', close: 100 }, { date: '2026-10-09', close: 100 }
];
for (const year of [2024, 2025, 2026, 2023]) {
    const values = trendRows.filter(row => new Date(row.date).getFullYear() === year)
        .sort((a, b) => a.date.localeCompare(b.date));
    const original = values.length && values.at(-1).close >= values[0].close ? 'bullish' : 'bearish';
    assert.equal(trendLookup(trendRows, year), original, 'Cached trends must preserve original rules');
}
let dateReads = 0;
const largeHistory = Array.from({length: 20000}, (_, i) => ({
    get date() { dateReads++; return `${1980 + Math.floor(i / 250)}-01-01`; }, close: i
}));
trendLookup(largeHistory, 1980);
const indexingReads = dateReads;
for (let i = 0; i < 20000; i++) trendLookup(largeHistory, 1980 + Math.floor(i / 250));
assert.equal(dateReads, indexingReads, 'Repeated trend lookups must not rescan history');
assert.ok(indexingReads <= largeHistory.length * 6, 'Indexing must be linear');
assert.equal(trendLookup([{date:'2025-01-01',close:100},{date:'2025-12-31',close:80}],2025),'bearish',
    'A newly loaded price array must not reuse stale ticker trends');
const seasonalPoints = [[0, 100], [182, 105.25], [364, 99.5]];
assert.equal(geometry.nearestPoint([], 100), null);
assert.deepEqual(geometry.nearestPoint(seasonalPoints, 0), seasonalPoints[0]);
assert.deepEqual(geometry.nearestPoint(seasonalPoints, 181), seasonalPoints[1]);
assert.deepEqual(geometry.nearestPoint(seasonalPoints, 364), seasonalPoints[2]);
for (const width of [280, 650, 1200]) {
    for (const point of seasonalPoints) {
        const day = geometry.dayForX(width, geometry.xFor(width, point[0]));
        assert.equal(day, point[0], 'Hover and interval selection must share the curve geometry');
        assert.deepEqual(geometry.nearestPoint(seasonalPoints, day), point);
    }
}
assert.ok(indexRange.min < 0 && indexRange.max > 100, 'Index extrema need visual padding, not data smoothing');
for (const viewport of [[1280, 720], [390, 844], [320, 568]]) {
    const [vw, vh] = viewport;
    for (const [x, y] of [[20, 30], [vw / 2, vh / 2], [vw - 15, vh - 20]]) {
        const width = Math.min(280, vw - 16), height = 145;
        const p = tooltipPosition(x, y, width, height, vw, vh);
        assert.ok(p.left >= 8 && p.top >= 8 && p.left + width <= vw - 8 && p.top + height <= vh - 8, 'Tooltip must fit the viewport');
        assert.ok(!(x >= p.left && x <= p.left + width && y >= p.top && y <= p.top + height), 'Tooltip must not cover the pointer');
    }
}
assert.ok(tooltipPosition(1100, 400, 280, 145, 1280, 720).left < 1100, 'Right edge must flip tooltip left');
assert.equal(exportScale(1200, 1800), 2);
const scale = exportScale(1440, 12000);
assert.ok(1440 * 12000 * scale * scale <= 12000001 && 12000 * scale <= 8192, 'PNG must respect memory/dimension limits');
assert.equal(pngFilename('XAU/USD', 'COT-GOLD', '2026-10-07'), 'XAU-USD-COT-GOLD-2026-10-07.png');
console.log('Chart UI checks passed: seasonality hover/curve alignment, index headroom, tooltip edge/cursor placement, PNG limits and safe filenames.');
