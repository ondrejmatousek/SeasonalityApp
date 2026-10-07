const assert = require('node:assert/strict');
const { indexRange, tooltipPosition, exportScale, pngFilename } = require('../wwwroot/js/market-chart-ui.js');
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
console.log('Chart UI checks passed: index headroom, tooltip edge/cursor placement, PNG limits and safe filenames.');
