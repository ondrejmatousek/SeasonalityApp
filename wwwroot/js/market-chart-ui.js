(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.MarketChartUi = factory();
}(typeof globalThis === 'object' ? globalThis : this, function () {
    // Keep the data/index itself in 0–100; only give its visual axis breathing room.
    const indexRange = { min: -8, max: 108 };
    function tooltipPosition(x, y, width, height, viewportWidth, viewportHeight) {
        const margin = 8, gap = 24;
        const clamp = (value, max) => Math.max(margin, Math.min(value, Math.max(margin, max)));
        const top = clamp(y - height - gap, viewportHeight - height - margin);
        // Prefer above/right. Near the right edge move the whole box to the left;
        // do not clamp a right-hand box over the crosshair.
        if (x + gap + width <= viewportWidth - margin) return { left: x + gap, top };
        if (x - gap - width >= margin) return { left: x - gap - width, top };
        // Narrow screens: place above/below instead of overlapping the pointer.
        return {
            left: clamp(x - width / 2, viewportWidth - width - margin),
            top: y - gap - height >= margin ? y - gap - height
                : clamp(y + gap, viewportHeight - height - margin)
        };
    }
    function exportScale(width, height) {
        return Math.min(2, 8192 / Math.max(1, width, height), Math.sqrt(12000000 / Math.max(1, width * height)));
    }
    function pngFilename(assetKey, view, date) {
        const safe = value => String(value).replace(/[^a-zA-Z0-9_-]/g, '-');
        return `${safe(assetKey)}-${safe(view)}-${safe(date)}.png`;
    }
    return { indexRange, tooltipPosition, exportScale, pngFilename };
}));
