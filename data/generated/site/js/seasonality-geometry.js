(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.SeasonalityChartGeometry = factory();
}(typeof globalThis === 'object' ? globalThis : this, function () {
    const leftPad = 42;
    const rightPad = leftPad * 1.4;
    const lastDay = 364;

    function forWidth(width) {
        const right = Math.max(leftPad + 1, width - rightPad);
        return { left: leftPad, right, span: right - leftPad, lastDay };
    }

    function xFor(width, day) {
        const plot = forWidth(width);
        return plot.left + Math.max(0, Math.min(plot.lastDay, day)) / plot.lastDay * plot.span;
    }

    function dayForX(width, x) {
        const plot = forWidth(width);
        const boundedX = Math.max(plot.left, Math.min(plot.right, x));
        return Math.round((boundedX - plot.left) / plot.span * plot.lastDay);
    }

    function nearestPoint(points, day) {
        return points.reduce((nearest, point) =>
            !nearest || Math.abs(point[0] - day) < Math.abs(nearest[0] - day) ? point : nearest, null);
    }

    return { forWidth, xFor, dayForX, nearestPoint };
}));
