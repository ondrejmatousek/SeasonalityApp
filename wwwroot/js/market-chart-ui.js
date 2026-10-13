(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.MarketChartUi = factory();
}(typeof globalThis === 'object' ? globalThis : this, function () {
    // Keep the data/index itself in 0–100; only give its visual axis breathing room.
    const indexRange = { min: -8, max: 108 };
    function todayPosition(now = new Date()) {
        const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
        const month=Number(date.slice(5,7)),day=Number(date.slice(8,10));
        // Same 365-day calendar as seasonality. Leap day lies between Feb 28 / Mar 1.
        return {date,day:month===2&&day===29?58.5:(Date.UTC(2001,month-1,day)-Date.UTC(2001,0,1))/86400000};
    }
    function drawTodayMarker(ctx,{xFor,top,bottom,left,right},now=new Date()) {
        const today=todayPosition(now),x=xFor(today.day);
        ctx.save();ctx.strokeStyle='#f59e0b';ctx.lineWidth=1;ctx.setLineDash([6,3,1,3]);
        ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();ctx.setLineDash([]);
        const labelX=Math.max(left,Math.min(x-21,right-42)),labelY=Math.max(2,top-21);
        ctx.fillStyle='#332415';ctx.fillRect(labelX,labelY,42,17);ctx.fillStyle='#fbbf24';ctx.font='bold 10px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('DNES',labelX+21,labelY+8.5);ctx.restore();
        return {...today,x};
    }
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
    return { indexRange, tooltipPosition, exportScale, pngFilename, todayPosition, drawTodayMarker };
}));
