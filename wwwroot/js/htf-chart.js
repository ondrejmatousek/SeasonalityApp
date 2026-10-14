// Lightweight Charts 5.2.0; rendering only. Provider OHLC and analytical results are immutable.
(() => {
    const iso=t=>typeof t==='string'?t:typeof t==='number'?new Date(t*1000).toISOString().slice(0,10):`${t.year}-${String(t.month).padStart(2,'0')}-${String(t.day).padStart(2,'0')}`;
    const day=s=>Date.parse(s+'T00:00:00Z'),fmt=s=>new Date(day(s)).toLocaleDateString('cs-CZ');
    window.HtfPriceChart={create(container,tip,{price,zone,candidate,resolution}){
        const L=window.LightweightCharts;if(!L)throw Error('Knihovna cenového grafu není dostupná');
        const bars=resolution==='W1'?price.weekly:price.bars;
        const precision=price.latestClose<10?5:price.latestClose<1000?3:2;
        const number=v=>new Intl.NumberFormat('cs-CZ',{minimumFractionDigits:precision,maximumFractionDigits:precision}).format(v);
        const seasonal=candidate?.direction==='up'
            ? {fill:'#22c55e22',line:'#22c55ebb',text:'#86efac',label:'Sezonní růst'}
            : {fill:'#ef444422',line:'#ef4444bb',text:'#fca5a5',label:'Sezonní pokles'};
        const chart=L.createChart(container,{
            autoSize:true,layout:{background:{type:L.ColorType.Solid,color:'#101416'},textColor:'#aebbc3',fontSize:12,attributionLogo:true},
            grid:{vertLines:{color:'#20272b'},horzLines:{color:'#20272b'}},
            rightPriceScale:{borderColor:'#344047',scaleMargins:{top:.12,bottom:.12}},
            timeScale:{borderColor:'#344047',timeVisible:false,minBarSpacing:2,rightOffset:8},
            crosshair:{mode:L.CrosshairMode.Normal,vertLine:{labelBackgroundColor:'#43515a'},horzLine:{labelBackgroundColor:'#43515a'}},
            localization:{locale:'cs-CZ',priceFormatter:number,timeFormatter:t=>fmt(iso(t))},
            handleScroll:{mouseWheel:false,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},
            handleScale:{mouseWheel:true,pinch:true,axisPressedMouseMove:{time:true,price:true},axisDoubleClickReset:{time:true,price:true}}
        });
        const series=chart.addSeries(L.CandlestickSeries,{upColor:'#26a69a',downColor:'#ef5350',wickUpColor:'#26a69a',wickDownColor:'#ef5350',borderVisible:false,priceFormat:{type:'price',precision,minMove:10**-precision}});
        const data=bars.map(b=>({time:b.date,open:b.open,high:b.high,low:b.low,close:b.close}));
        // Future whitespace locates the seasonal interval; never invent future candles.
        const cursor=new Date(day(bars.at(-1).date));let extra=0;
        while(extra<8||cursor.toISOString().slice(0,10)<(candidate?.endDate||bars.at(-1).date)){
            cursor.setUTCDate(cursor.getUTCDate()+(resolution==='W1'?7:1));
            if(resolution==='W1'||![0,6].includes(cursor.getUTCDay())){data.push({time:cursor.toISOString().slice(0,10)});extra++;}
            if(extra>260)break;
        }
        // Keep our immutable ISO-date axis: the library normalizes data.time internally.
        const dates=data.map(b=>iso(b.time));
        series.setData(data);container.dataset.candleCount=bars.length;
        const x=date=>{
            let n=dates.findIndex(d=>d>=date);if(n<0)n=dates.length-1;
            let p=n;if(n>0&&dates[n]!==date)p=n-1+(day(date)-day(dates[n-1]))/(day(dates[n])-day(dates[n-1]));
            // Future whitespace has no price data. Extend the real trading-bar spacing,
            // rather than relying on the library's whitespace-index coordinate lookup.
            const last=bars.length-1,anchor=chart.timeScale().timeToCoordinate(bars[last].date),previous=chart.timeScale().timeToCoordinate(bars[Math.max(0,last-1)].date);
            return anchor===null||previous===null?null:anchor+(p-last)*(anchor-previous);
        };
        const renderer={draw(target){target.useMediaCoordinateSpace(({context:ctx,mediaSize:{width,height}})=>{
            const start=candidate?x(candidate.startDate):null,end=candidate?x(candidate.endDate):null,base=x(zone.baseDate),upper=series.priceToCoordinate(zone.upper),lower=series.priceToCoordinate(zone.lower);
            container.dataset.seasonalStart=String(start);container.dataset.seasonalEnd=String(end);
            ctx.save();ctx.beginPath();ctx.rect(0,0,width,height);ctx.clip();
            if(start!==null&&end!==null){ctx.fillStyle=seasonal.fill;ctx.fillRect(start,0,end-start,height);ctx.strokeStyle=seasonal.line;ctx.setLineDash([4,5]);for(const xx of[start,end]){ctx.beginPath();ctx.moveTo(xx,0);ctx.lineTo(xx,height);ctx.stroke();}ctx.setLineDash([]);ctx.fillStyle=seasonal.text;ctx.font='11px sans-serif';ctx.fillText(seasonal.label,Math.max(6,start+6),height-12);}
            if(upper!==null&&lower!==null){const left=Math.max(0,base??0);ctx.fillStyle=zone.type==='demand'?'#26a69a30':'#ef535025';ctx.strokeStyle=zone.type==='demand'?'#26a69a99':'#ef535099';ctx.fillRect(left,upper,width-left,lower-upper);ctx.strokeRect(left,upper,width-left,lower-upper);ctx.fillStyle='#aebbc3';ctx.font='11px sans-serif';ctx.fillText(`${zone.timeframe} ${zone.type}`,left+6,upper-6);}
            ctx.restore();
        });}};
        series.attachPrimitive({paneViews:()=>[{zOrder:()=> 'bottom',renderer:()=>renderer}]});
        function recordRange(){const r=chart.timeScale().getVisibleLogicalRange();if(r){container.dataset.visibleFrom=r.from;container.dataset.visibleTo=r.to;}}
        chart.timeScale().subscribeVisibleLogicalRangeChange(recordRange);
        const reset=()=>{chart.priceScale('right').applyOptions({autoScale:true});chart.timeScale().setVisibleLogicalRange({from:Math.max(0,bars.length-(resolution==='W1'?65:130)),to:data.length-1});tip.hidden=true;};
        const zoom=factor=>{const r=chart.timeScale().getVisibleLogicalRange();if(r){const mid=(r.from+r.to)/2,half=Math.max(6,(r.to-r.from)*factor/2);chart.timeScale().setVisibleLogicalRange({from:mid-half,to:mid+half});}};
        chart.subscribeCrosshairMove(p=>{
            if(!p.point||!p.time||p.point.x<0||p.point.y<0){tip.hidden=true;return;}
            const b=p.seriesData.get(series),value=series.coordinateToPrice(p.point.y);
            tip.textContent=`${fmt(iso(p.time))} · cena ${number(value)}${b?.open!==undefined?`\nO ${number(b.open)} · H ${number(b.high)}\nL ${number(b.low)} · C ${number(b.close)}`:'\nBez svíčky · budoucí sezonní období'}`;
            tip.hidden=false;
            const box=container.getBoundingClientRect(),pos=window.MarketChartUi.tooltipPosition(p.point.x,p.point.y,tip.offsetWidth,tip.offsetHeight,box.width,box.height);
            tip.style.left=pos.left+'px';tip.style.top=pos.top+'px';
        });
        const key=e=>{if(['+','=','-','0','ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();if(e.key==='0')reset();else if(e.key==='ArrowLeft'||e.key==='ArrowRight'){const r=chart.timeScale().getVisibleLogicalRange(),move=(r.to-r.from)*.1*(e.key==='ArrowLeft'?-1:1);chart.timeScale().setVisibleLogicalRange({from:r.from+move,to:r.to+move});}else zoom(e.key==='-'?1.25:.8);}};
        container.addEventListener('keydown',key);reset();
        return {reset,zoom,fit:()=>{chart.priceScale('right').applyOptions({autoScale:true});chart.timeScale().fitContent();},destroy:()=>{container.removeEventListener('keydown',key);chart.remove();tip.hidden=true;}};
    }};
})();
