// Lightweight Charts 5.2.0; rendering only. Provider OHLC and analytical results are immutable.
(() => {
    const iso=t=>typeof t==='string'?t:typeof t==='number'?new Date(t*1000).toISOString().slice(0,10):`${t.year}-${String(t.month).padStart(2,'0')}-${String(t.day).padStart(2,'0')}`;
    const day=s=>Date.parse(s.includes('T')?s:s+'T00:00:00Z'),fmt=s=>new Date(day(s)).toLocaleDateString('cs-CZ');
    window.ZonePriceChart={create(container,tip,{price,zone,zones=[],candidate,resolution,annotations=[]}){
        const L=window.LightweightCharts;if(!L)throw Error('Knihovna cenového grafu není dostupná');
        const shown=[zone,...zones].filter((z,i,a)=>a.findIndex(v=>v.type===z.type&&v.lower===z.lower&&v.upper===z.upper&&v.baseDate===z.baseDate)===i);
        const minZone=Math.min(...shown.map(z=>z.lower)),maxZone=Math.max(...shown.map(z=>z.upper));
        container.classList.add('zone-chart-surface');container.dataset.shownZones=JSON.stringify(shown.map(z=>({type:z.type,lower:z.lower,upper:z.upper,baseDate:z.baseDate})));
        const bars=resolution==='W1'?price.weekly:price.bars,intraday=resolution==='H4';
        const axisKey=t=>intraday?(typeof t==='number'?new Date(t*1000).toISOString():t):iso(t);
        const displayTime=t=>intraday?window.MarketChartTime.format(t):fmt(iso(t));
        container.dataset.displayTimeZone=window.MarketChartTime.timeZone;
        const precision=price.latestClose<10?5:price.latestClose<1000?3:2;
        const number=v=>new Intl.NumberFormat('cs-CZ',{minimumFractionDigits:precision,maximumFractionDigits:precision}).format(v);
        const seasonal=candidate?.direction==='up'
            ? {fill:'#22c55e22',line:'#22c55ebb',text:'#86efac',label:'Sezonní růst'}
            : {fill:'#ef444422',line:'#ef4444bb',text:'#fca5a5',label:'Sezonní pokles'};
        const host=document.createElement('div');host.className='zone-chart-canvas';container.append(host);
        const chart=L.createChart(host,{
            autoSize:true,layout:{background:{type:L.ColorType.Solid,color:'#101416'},textColor:'#aebbc3',fontSize:12,attributionLogo:true},
            grid:{vertLines:{color:'#20272b'},horzLines:{color:'#20272b'}},
            rightPriceScale:{borderColor:'#344047',scaleMargins:{top:.12,bottom:.12},alignLabels:true},
            timeScale:{borderColor:'#344047',timeVisible:intraday,secondsVisible:false,minBarSpacing:.001,rightOffset:8,lockVisibleTimeRangeOnResize:true,tickMarkFormatter:intraday?window.MarketChartTime.tick:undefined},
            crosshair:{mode:L.CrosshairMode.Normal,vertLine:{labelBackgroundColor:'#43515a'},horzLine:{labelBackgroundColor:'#43515a'}},
            localization:{locale:'cs-CZ',priceFormatter:number,timeFormatter:displayTime},
            handleScroll:{mouseWheel:false,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},
            handleScale:{mouseWheel:true,pinch:true,axisPressedMouseMove:{time:true,price:true},axisDoubleClickReset:{time:true,price:true}}
        });
        const series=chart.addSeries(L.CandlestickSeries,{upColor:'#26a69a',downColor:'#ef5350',wickUpColor:'#26a69a',wickDownColor:'#ef5350',borderVisible:false,priceFormat:{type:'price',precision,minMove:10**-precision},
            // A primitive is not part of the default candle autoscale. Include the
            // real zone bounds even when all visible candles trade far above/below it.
            autoscaleInfoProvider:original=>{const info=original(),range=info?.priceRange;return {...info,priceRange:{minValue:Math.min(range?.minValue??minZone,minZone),maxValue:Math.max(range?.maxValue??maxZone,maxZone)}};}});
        const data=bars.map(b=>({time:intraday?b.timestamp:b.date,open:b.open,high:b.high,low:b.low,close:b.close}));
        const setup=zone.liquiditySetup?.state==='ready'?zone.liquiditySetup:null;
        for(const key of ['rangeStart','rangeEnd','liquidityLevel'])delete container.dataset[key];
        container.dataset.structure=setup?'range-liquidity':'none';
        // Future whitespace locates the seasonal interval; never invent future candles.
        const cursor=new Date(day(bars.at(-1).date)),step=intraday?14400000:(resolution==='W1'?7:1)*86400000;
        const seasonalEnd=candidate?day(candidate.endDate):+cursor,target=Math.max(+cursor+8*step,seasonalEnd+3*86400000);
        const cryptoWeekends=price.provider==='Yahoo Finance'&&price.symbol?.endsWith('-USD');let extra=0;
        while((extra<8||+cursor<target)&&extra<20000){
            if(intraday)cursor.setUTCHours(cursor.getUTCHours()+4);else cursor.setUTCDate(cursor.getUTCDate()+(resolution==='W1'?7:1));
            if(resolution==='W1'||cryptoWeekends||![0,6].includes(cursor.getUTCDay())){data.push({time:intraday?+cursor/1000:cursor.toISOString().slice(0,10)});extra++;}
        }
        // Bounded whitespace generation must never clip the supplied interval.
        if(Number.isFinite(seasonalEnd)&&+cursor<seasonalEnd)data.push({time:intraday?seasonalEnd/1000:candidate.endDate});
        if(candidate&&day(candidate.startDate)<day(bars[0].date))data.unshift({time:intraday?day(candidate.startDate)/1000:candidate.startDate});
        // Keep our immutable ISO-date axis: the library normalizes data.time internally.
        const dates=data.map(b=>axisKey(b.time));
        series.setData(data);container.dataset.candleCount=bars.length;container.dataset.resolution=resolution;
        // Native price lines keep both boundary prices on the right axis during
        // zoom/pan and resize. The primitive still draws the time-bounded zone.
        for(const z of shown)for(const boundary of [z.lower,z.upper])series.createPriceLine({
            price:boundary,color:z.type==='demand'?'#26a69a':'#ef5350',
            lineVisible:false,axisLabelVisible:true,
            axisLabelColor:z.type==='demand'?'#26a69a':'#ef5350',axisLabelTextColor:'#ffffff',title:''
        });
        const markers=annotations.length?L.createSeriesMarkers(series,annotations):null;
        const drawingTools=window.ChartDrawingTools?.create(container,chart,series,{number});
        const x=date=>{
            let n=dates.findIndex(d=>d>=date);if(n<0)n=dates.length-1;
            let p=n;if(n>0&&dates[n]!==date)p=n-1+(day(date)-day(dates[n-1]))/(day(dates[n])-day(dates[n-1]));
            // Whitespace-only logical coordinates are unreliable in the bundled
            // library. Extend the spacing between two actual provider candles.
            const last=bars.length-1,time=i=>intraday?bars[i].timestamp:bars[i].date;
            const anchor=chart.timeScale().timeToCoordinate(time(last)),previous=chart.timeScale().timeToCoordinate(time(Math.max(0,last-1)));
            const lastIndex=dates.indexOf(axisKey(time(last)));
            return anchor===null||previous===null?null:anchor+(p-lastIndex)*(anchor-previous);
        };
        const renderer={draw(target){target.useMediaCoordinateSpace(({context:ctx,mediaSize:{width,height}})=>{
            const start=candidate?x(candidate.startDate):null,end=candidate?x(candidate.endDate):null,base=x(zone.baseDate),upper=series.priceToCoordinate(zone.upper),lower=series.priceToCoordinate(zone.lower);
            container.dataset.seasonalStart=String(start);container.dataset.seasonalEnd=String(end);
            container.dataset.zoneLeft=String(base);container.dataset.zoneTop=String(upper);container.dataset.zoneBottom=String(lower);
            container.dataset.paneWidth=String(width);container.dataset.paneHeight=String(height);
            ctx.save();ctx.beginPath();ctx.rect(0,0,width,height);ctx.clip();
            if(start!==null&&end!==null){ctx.fillStyle=seasonal.fill;ctx.fillRect(start,0,end-start,height);ctx.strokeStyle=seasonal.line;ctx.setLineDash([4,5]);for(const xx of[start,end]){ctx.beginPath();ctx.moveTo(xx,0);ctx.lineTo(xx,height);ctx.stroke();}ctx.setLineDash([]);ctx.fillStyle=seasonal.text;ctx.font='11px sans-serif';ctx.fillText(seasonal.label,Math.max(6,Math.min(start+6,width-ctx.measureText(seasonal.label).width-6)),height-12);}
            for(const z of shown){const top=series.priceToCoordinate(z.upper),bottom=series.priceToCoordinate(z.lower),left=Math.max(0,x(z.baseDate)??0);if(top===null||bottom===null)continue;ctx.fillStyle=z.type==='demand'?'#26a69a30':'#ef535025';ctx.strokeStyle=z.type==='demand'?'#26a69a99':'#ef535099';ctx.fillRect(left,top,width-left,bottom-top);ctx.strokeRect(left,top,width-left,bottom-top);ctx.fillStyle='#aebbc3';ctx.font='11px sans-serif';const lines=(z.chartLabel||`${z.timeframe} ${z.type}`).split('\n');lines.forEach((line,i)=>ctx.fillText(line,Math.min(left+6,Math.max(6,width-ctx.measureText(line).width-6)),z.labelPlacement==='below'?Math.min(height-6,bottom+14+i*13):Math.max(12,top-6-(lines.length-1-i)*13)));}
            if(setup){
                ctx.font='11px sans-serif';
                const left=x(setup.range.start),right=x(setup.range.end),top=series.priceToCoordinate(setup.range.upper),bottom=series.priceToCoordinate(setup.range.lower);
                container.dataset.rangeStart=String(left);container.dataset.rangeEnd=String(right);
                if([left,right,top,bottom].every(v=>v!==null)){ctx.strokeStyle='#b2bec9aa';ctx.fillStyle='#b2bec90b';ctx.setLineDash([6,4]);ctx.fillRect(left,top,right-left,bottom-top);ctx.strokeRect(left,top,right-left,bottom-top);ctx.setLineDash([]);ctx.fillStyle='#c5ced6';ctx.fillText('Předchozí range',Math.max(6,left+6),top-7);}
                const poolX=x(setup.pool.swings[0].date),poolY=series.priceToCoordinate(setup.pool.level);
                container.dataset.liquidityLevel=String(setup.pool.level);
                if(poolX!==null&&poolY!==null){ctx.strokeStyle='#e8b85d';ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(poolX,poolY);ctx.lineTo(width,poolY);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#e8b85d';ctx.fillText(`${zone.type==='demand'?'Swing lows':'Swing highs'} · likvidita (proxy)`,Math.max(6,poolX+6),poolY-7);}
                for(const p of setup.pool.swings){const xx=x(p.date),yy=series.priceToCoordinate(p.price);if(xx!==null&&yy!==null){ctx.fillStyle='#e8b85d';ctx.beginPath();ctx.arc(xx,yy,3,0,Math.PI*2);ctx.fill();}}
                const bx=x(setup.breakout.date),by=series.priceToCoordinate(setup.breakout.price);if(bx!==null&&by!==null){ctx.strokeStyle='#d5e7ef';ctx.beginPath();ctx.arc(bx,by,5,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#d5e7ef';ctx.fillText('Průraz close',bx+7,by-8);}
            }
            ctx.restore();
        });}};
        series.attachPrimitive({paneViews:()=>[{zOrder:()=> 'bottom',renderer:()=>renderer}]});
        function recordRange(){const r=chart.timeScale().getVisibleLogicalRange();if(r){container.dataset.visibleFrom=r.from;container.dataset.visibleTo=r.to;}}
        chart.timeScale().subscribeVisibleLogicalRangeChange(recordRange);
        const reset=()=>{
            chart.priceScale('right').applyOptions({autoScale:true});
            const baseIndex=Math.min(...shown.map(z=>Math.max(0,dates.findIndex(d=>d>=z.baseDate)))),rangeIndex=setup?dates.findIndex(d=>d>=setup.range.start):-1;
            const seasonalIndex=candidate?Math.max(0,dates.findIndex(d=>d>=candidate.startDate)):Infinity;
            const first=Math.min(baseIndex-8,rangeIndex>=0?rangeIndex-5:Infinity,seasonalIndex-3,Math.max(0,bars.length-(resolution==='W1'?65:130))),last=data.length-1;
            const padding=Math.max(3,(last-first)*.03);
            chart.timeScale().setVisibleLogicalRange({from:first-padding,to:last+padding});tip.hidden=true;
        };
        const zoom=factor=>{const r=chart.timeScale().getVisibleLogicalRange();if(r){const mid=(r.from+r.to)/2,half=Math.max(6,(r.to-r.from)*factor/2);chart.timeScale().setVisibleLogicalRange({from:mid-half,to:mid+half});}};
        chart.subscribeCrosshairMove(p=>{
            if(drawingTools?.active){tip.hidden=true;return;}
            if(!p.point||!p.time||p.point.x<0||p.point.y<0){tip.hidden=true;return;}
            const b=p.seriesData.get(series),value=series.coordinateToPrice(p.point.y);
            tip.textContent=`${displayTime(p.time)} · cena ${number(value)}${b?.open!==undefined?`\nO ${number(b.open)} · H ${number(b.high)}\nL ${number(b.low)} · C ${number(b.close)}`:'\nBez svíčky · budoucí sezonní období'}`;
            if(resolution!=='W1'&&b?.open!==undefined){const original=price.bars.find(bar=>bar.date===iso(p.time)),dates=window.MarketCandles.dateInfo(price,original);if(dates.sessionDate)tip.textContent+=`\nDen session ${dates.sessionDate} (odvozený)\nZačátek UTC ${dates.providerTimestamp}`;}
            tip.hidden=false;
            const box=container.getBoundingClientRect(),hostBox=host.getBoundingClientRect(),pos=window.MarketChartUi.tooltipPosition(p.point.x+hostBox.left-box.left,p.point.y,tip.offsetWidth,tip.offsetHeight,box.width,box.height);
            tip.style.left=pos.left+'px';tip.style.top=pos.top+'px';
        });
        const key=e=>{if(['+','=','-','0','ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();if(e.key==='0')reset();else if(e.key==='ArrowLeft'||e.key==='ArrowRight'){const r=chart.timeScale().getVisibleLogicalRange(),move=(r.to-r.from)*.1*(e.key==='ArrowLeft'?-1:1);chart.timeScale().setVisibleLogicalRange({from:r.from+move,to:r.to+move});}else zoom(e.key==='-'?1.25:.8);}};
        container.addEventListener('keydown',key);reset();
        return {reset,zoom,fit:()=>{chart.priceScale('right').applyOptions({autoScale:true});chart.timeScale().fitContent();},destroy:()=>{container.removeEventListener('keydown',key);drawingTools?.destroy();markers?.detach();chart.remove();host.remove();tip.hidden=true;}};
    }};
})();
