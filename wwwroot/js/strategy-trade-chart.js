// Rendering-only audit view. Never changes strategy settings, candles or fills.
(()=>{
 'use strict';
 const localTime=t=>window.MarketChartTime.format(t);
 const num=v=>new Intl.NumberFormat('cs-CZ',{maximumFractionDigits:8}).format(v);
 window.StrategyTradeChart={create(container,readout,{prepared:p,trade:t,config:c,resolution='M15'}){
  const L=window.LightweightCharts;if(!L)throw Error('Knihovna TradingView Lightweight Charts není dostupná.');
  const bars=resolution==='H4'?p.h4:resolution==='D1'?p.d1:p.data.m15;
  const zone=p.zones.find(z=>z.id===t.reference?.zoneId),parent=p.zones.find(z=>z.id===t.reference?.parentId);
  const precision=t.entry<10?5:3,levels=[t.entry,t.stop,t.target,t.exit,...[zone,parent].filter(Boolean).flatMap(z=>[z.lower,z.upper])].filter(Number.isFinite);
  container.dataset.displayTimeZone=window.MarketChartTime.timeZone;
  const chart=L.createChart(container,{autoSize:true,layout:{background:{type:L.ColorType.Solid,color:'#101416'},textColor:'#b9c8cf',attributionLogo:true},grid:{vertLines:{color:'#20272b'},horzLines:{color:'#20272b'}},rightPriceScale:{borderColor:'#344047',scaleMargins:{top:.18,bottom:.18}},timeScale:{timeVisible:true,secondsVisible:false,borderColor:'#344047',lockVisibleTimeRangeOnResize:true,tickMarkFormatter:window.MarketChartTime.tick},crosshair:{mode:L.CrosshairMode.Normal},localization:{locale:'cs-CZ',timeFormatter:localTime},handleScroll:{mouseWheel:false,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},handleScale:{mouseWheel:true,pinch:true,axisPressedMouseMove:{time:true,price:true},axisDoubleClickReset:{time:true,price:true}}});
  const series=chart.addSeries(L.CandlestickSeries,{upColor:'#26a69a',downColor:'#ef5350',wickUpColor:'#26a69a',wickDownColor:'#ef5350',borderVisible:false,priceFormat:{type:'price',precision,minMove:10**-precision},autoscaleInfoProvider:original=>{const a=original();return {...a,priceRange:{minValue:Math.min(a?.priceRange?.minValue??t.stop,...levels),maxValue:Math.max(a?.priceRange?.maxValue??t.target,...levels)}};}});
  series.setData(bars.map(b=>({time:b.t,open:b.open,high:b.high,low:b.low,close:b.close})));
  const index=time=>{let lo=0,hi=bars.length-1;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(bars[mid].t<=time)lo=mid;else hi=mid-1;}return lo;};
  const stamp=time=>bars[index(time)].t;
  const x=time=>chart.timeScale().timeToCoordinate(stamp(time)),y=price=>series.priceToCoordinate(price);
  for(const [price,title,color]of [[t.entry,'Vstup','#d6e6f0'],[t.stop,'SL','#ef7070'],[t.target,'TP','#42cba3']])series.createPriceLine({price,title: title+' '+num(price),color,lineWidth:1,lineStyle:L.LineStyle.Dashed,axisLabelVisible:true});
  if(Number.isFinite(t.reference?.swingPrice))series.createPriceLine({price:t.reference.swingPrice,title:'Vybraný M15 swing',color:'#e7b759',lineWidth:1,lineStyle:L.LineStyle.Dotted,axisLabelVisible:true});
  const markers=[{at:t.signalAt-1,color:'#e7b759',text:'Signál potvrzen',shape:'circle',position:t.direction===1?'belowBar':'aboveBar'}, {at:t.enteredAt,color:'#6acaf5',text:t.direction===1?'Long vstup':'Short vstup',shape:t.direction===1?'arrowUp':'arrowDown',position:t.direction===1?'belowBar':'aboveBar'}, {at:t.exitedAt-1,color:t.netR>0?'#42cba3':'#ef7070',text:'Výstup · '+t.exitReason,shape:'circle',position:t.direction===1?'aboveBar':'belowBar'}].sort((a,b)=>a.at-b.at).map(m=>({...m,time:stamp(m.at)}));
  const markerPlugin=L.createSeriesMarkers(series,markers);
  if(c.model==='ema')for(const [period,color]of [[c.fast,'#e7b759'],[c.slow,'#ac92ec']]){
   const line=chart.addSeries(L.LineSeries,{color,lineWidth:2,title:'H4 EMA '+period,priceLineVisible:false,lastValueVisible:false});
   // Show H4 values only from their close onward, not at their candle open.
   let j=0,value=null;const data=[];
   for(const b of bars){while(j<p.h4.length&&p.h4[j].end<=b.t){value=p.emas[period][j++];}data.push(value==null?{time:b.t}:{time:b.t,value});}line.setData(data);
  }
  let measure=[],ruler=false,requestDraw=()=>{};
  const renderer={draw(target){target.useMediaCoordinateSpace(({context:g,mediaSize:{width,height}})=>{
   g.save();g.beginPath();g.rect(0,0,width,height);g.clip();
   const rect=(left,right,low,high,color)=>{if([left,right,low,high].every(Number.isFinite)){g.fillStyle=color;g.fillRect(left,Math.min(low,high),Math.max(3,right-left),Math.abs(high-low));}};
   const end=x(t.exitedAt-1),entry=x(t.enteredAt);
   for(const z of [parent,zone].filter(Boolean)){const left=x(z.baseStart),top=y(z.upper),bottom=y(z.lower);rect(left,end,top,bottom,z===parent?'#9999ee14':'#26a69a28');if(left!==null&&top!==null){g.fillStyle='#a8d7cf';g.font='12px sans-serif';g.fillText(z.timeframe+' '+z.type,Math.max(5,left+4),Math.max(14,top-5));}}
   // A same-candle stop must still show a readable price plan. This horizontal
   // minimum is a drawing aid, never a claim about holding duration.
   const planEnd=entry===null||end===null?null:Math.min(width,Math.max(end,entry+70));
   rect(entry,planEnd,y(t.entry),y(t.stop),'#ef53503b');rect(entry,planEnd,y(t.entry),y(t.target),'#26a69a35');
   if(entry!==null&&end!==null){g.strokeStyle='#8ccfee';g.lineWidth=2;g.beginPath();g.moveTo(entry,y(t.entry));g.lineTo(end,y(t.exit));g.stroke();}
   if(measure.length===2){const [a,b]=measure,ax=x(a.time),bx=x(b.time),ay=y(a.price),by=y(b.price);if([ax,bx,ay,by].every(Number.isFinite)){g.strokeStyle='#f4d77a';g.setLineDash([4,3]);g.strokeRect(ax,ay,bx-ax,by-ay);}}
   container.dataset.tradeDrawn=String([entry,end,y(t.entry),y(t.stop),y(t.target)].every(Number.isFinite));
   container.dataset.entryX=String(entry);container.dataset.exitX=String(end);container.dataset.stopY=String(y(t.stop));container.dataset.targetY=String(y(t.target));container.dataset.paneWidth=String(width);container.dataset.paneHeight=String(height);
   g.restore();
  });}};
  series.attachPrimitive({attached({requestUpdate}){requestDraw=requestUpdate;},paneViews:()=>[{zOrder:()=> 'bottom',renderer:()=>renderer}]});
  const focus=context=>{chart.priceScale('right').applyOptions({autoScale:true});const start=context?Math.min(t.signalAt,zone?.baseStart??t.signalAt,parent?.baseStart??t.signalAt):t.signalAt;chart.timeScale().setVisibleLogicalRange({from:index(start)-24,to:index(t.exitedAt-1)+24});};
  const zoom=f=>{const r=chart.timeScale().getVisibleLogicalRange();if(r){const mid=(r.from+r.to)/2,half=Math.max(5,(r.to-r.from)*f/2);chart.timeScale().setVisibleLogicalRange({from:mid-half,to:mid+half});}};
  chart.subscribeCrosshairMove(e=>{if(ruler)return;const b=e.seriesData.get(series);if(b?.open!==undefined)readout.textContent=`${localTime(b.time)} · O ${num(b.open)} · H ${num(b.high)} · L ${num(b.low)} · C ${num(b.close)}`;});
  chart.subscribeClick(e=>{if(!ruler||!e.point||e.time==null)return;const price=series.coordinateToPrice(e.point.y);if(!Number.isFinite(price))return;if(measure.length===2)measure=[];measure.push({time:Number(e.time),price});if(measure.length===2){const [a,b]=measure;readout.textContent=`Měření: ${num(b.price-a.price)} (${num((b.price/a.price-1)*100)} %) · ${Math.abs(b.time-a.time)/60} minut UTC. Nejde o výsledek obchodu.`;}else readout.textContent='Vyber druhý bod měření.';requestDraw();});
  const key=e=>{if(['+','=','-','0','ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();if(e.key==='0')focus(false);else if(e.key.startsWith('Arrow')){const r=chart.timeScale().getVisibleLogicalRange(),d=(r.to-r.from)*.15*(e.key==='ArrowLeft'?-1:1);chart.timeScale().setVisibleLogicalRange({from:r.from+d,to:r.to+d});}else zoom(e.key==='-'?1.25:.8);}};
  container.addEventListener('keydown',key);container.dataset.resolution=resolution;container.dataset.tradeEntry=String(t.enteredAt);focus(false);
  return {focus:()=>focus(false),context:()=>focus(true),all:()=>{chart.priceScale('right').applyOptions({autoScale:true});chart.timeScale().fitContent();},zoom,setRuler:value=>{ruler=value;},clear:()=>{measure=[];requestDraw();readout.textContent='Měření smazáno. Časy grafu jsou Europe/Prague.';},image:()=>chart.takeScreenshot().toDataURL('image/png'),destroy:()=>{container.removeEventListener('keydown',key);markerPlugin.detach();chart.remove();}};
 }};
})();
