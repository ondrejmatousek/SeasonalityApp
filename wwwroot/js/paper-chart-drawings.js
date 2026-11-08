// Trade Replay drawing editor, adapted for a fixed H4 series and temporary annotations.
(() => {
// Search the adjacent loaded candles, using screen distances so
// snapping behaves consistently at every zoom level and price scale.
function candleSnap(data, index, x, y, toX, toY, radius = 18) {
  let closest = null, distance = radius;
  for (let i = Math.max(0,index-1); i <= Math.min(data.length-1,index+1); i++) {
    const cx = toX(i); if (cx === null) continue;
    for (const price of [data[i].open,data[i].high,data[i].low,data[i].close]) {
      const cy = toY(price); if (cy === null) continue;
      const delta = Math.hypot(cx-x,cy-y);
      if (delta <= distance) { distance = delta; closest = {index:i,price,x:cx,y:cy}; }
    }
  }
  return closest;
}

const svgNS = 'http://www.w3.org/2000/svg';

// Annotation anchors are candle indices and prices, never viewport pixels. The SVG is a
// projection over the chart; it follows zoom, scroll, price-scale changes and resizing.
class PaperChartDrawings {
  constructor({ container, chart, series, focusTarget, data, precision, onTool, onError, onRender }) {
    Object.assign(this,{container,chart,series,focusTarget,data,precision,onTool,onError,onRender});
    this.tickSize=10**-precision;
    this.drawings = []; this.tool = 'select'; this.selected = null;
    this.magnet=false;this.keepDrawing=false;this.locked=false;this.hidden=false;
    this.history=[];this.committed=structuredClone(this.drawings);
    this.svg = document.createElementNS(svgNS,'svg'); this.svg.classList.add('drawing-overlay');
    this.svg.setAttribute('aria-label','Nákresy a plánované pozice');
    container.append(this.svg);
    this.down = e => this.pointerDown(e); this.move = e => this.pointerMove(e); this.up = e => this.pointerUp(e);
    this.svg.addEventListener('pointerdown',this.down);
    this.svg.addEventListener('pointermove',this.move);
    this.svg.addEventListener('pointerup',this.up);
    this.svg.addEventListener('pointercancel',this.up);
    this.shiftKey=e=>{
      if(e.key!=='Shift' || !this.lastPointer)return;
      if(this.draft?.kind==='line' || (this.drag && ['start','end'].includes(this.drag.handle) && this.selection()?.kind==='line'))this.pointerMove({...this.lastPointer,shiftKey:e.type==='keydown'});
    };
    document.addEventListener('keydown',this.shiftKey);document.addEventListener('keyup',this.shiftKey);
    this.changeRange = () => this.schedule();
    chart.timeScale().subscribeVisibleLogicalRangeChange(this.changeRange);
    this.observer = new ResizeObserver(this.changeRange); this.observer.observe(container);
    this.wheel = e => {
      const surface=this.chart.chartElement();
      // Drawings sit beside the chart surface in the DOM.
      // Forward their wheel input to the chart's native zoom/scroll handler.
      if(!surface.contains(e.target)) {
        const forwarded=new WheelEvent('wheel',{bubbles:true,cancelable:true,
          deltaX:e.deltaX,deltaY:e.deltaY,deltaZ:e.deltaZ,deltaMode:e.deltaMode,
          clientX:e.clientX,clientY:e.clientY,screenX:e.screenX,screenY:e.screenY,
          ctrlKey:e.ctrlKey,shiftKey:e.shiftKey,altKey:e.altKey,metaKey:e.metaKey});
        if(!surface.dispatchEvent(forwarded))e.preventDefault();
      }
      this.schedule();
    }; container.addEventListener('wheel',this.wheel,{passive:false});
    this.chartMove = () => this.schedule(); container.addEventListener('pointermove',this.chartMove);
    this.outsideSetup=e=>{
      if(this.tool==='select' && this.selected && !e.target.closest('[data-drawing]'))this.select(null);
    };
    container.addEventListener('pointerdown',this.outsideSetup,true);
  }
  roundPrice(value){return Number(value.toFixed(this.precision));}
  destroy() {
    cancelAnimationFrame(this.frame); this.observer.disconnect();
    this.chart.timeScale().unsubscribeVisibleLogicalRangeChange(this.changeRange);
    this.container.removeEventListener('wheel',this.wheel); this.container.removeEventListener('pointermove',this.chartMove);
    this.container.removeEventListener('pointerdown',this.outsideSetup,true);
    document.removeEventListener('keydown',this.shiftKey);document.removeEventListener('keyup',this.shiftKey);
    this.svg.remove();
  }
  setTool(tool) {
    this.draft=null;this.snapPoint=null; this.tool=tool;
    if(tool!=='select') this.selected=null;
    this.svg.classList.toggle('drawing-mode',tool !== 'select');
    this.onTool?.(tool); this.render();
  }
  selection() { return this.draft || this.drawings.find(d=>d.id===this.selected) || null; }
  select(id) { this.selected=id; this.render(); }
  removeSelected() {
    if(this.locked)return;
    if (this.draft) { this.setTool('select'); return; }
    if (!this.selected) return;
    this.drawings=this.drawings.filter(d=>d.id!==this.selected); this.selected=null;
    this.commit(); this.render();
  }
  commit() {
    if(JSON.stringify(this.committed)!==JSON.stringify(this.drawings)){
      this.history.push(this.committed);if(this.history.length>50)this.history.shift();
      this.committed=structuredClone(this.drawings);
    }
  }
  undo() {
    if(this.locked || !this.history.length)return;
    this.draft=null;this.selected=null;this.drawings=this.history.pop();this.committed=structuredClone(this.drawings);
    this.setTool('select');
  }
  schedule() { cancelAnimationFrame(this.frame); this.frame=requestAnimationFrame(()=>this.render()); }
  point(e, snap = this.magnet) {
    const rect=this.container.getBoundingClientRect(), x=e.clientX-rect.left, y=e.clientY-rect.top;
    const pane=this.chart.paneSize(0);
    if(x<0 || x>pane.width || y<0 || y>pane.height || !this.data.length) return null;
    let price=this.series.coordinateToPrice(y);
    const logical=this.chart.timeScale().coordinateToLogical(x);
    if(!Number.isFinite(price) || !Number.isFinite(logical)) return null;
    let index=Math.round(logical);
    const snapped=snap?candleSnap(this.data,index,x,y,i=>this.chart.timeScale().logicalToCoordinate(i),p=>this.series.priceToCoordinate(p)):null;
    if(snapped){price=snapped.price;index=snapped.index;}
    return {x:snapped?.x ?? x,y:snapped?.y ?? y,index,price:this.roundPrice(price),snapped:Boolean(snapped)};
  }
  x(index) { return this.chart.timeScale().logicalToCoordinate(index); }
  pointerDown(e) {
    if(e.button!==0) return;
    this.lastPointer={clientX:e.clientX,clientY:e.clientY};
    const p=this.point(e); if(!p) return;
    const hit=e.target.closest('[data-drawing]');
    this.focusTarget.focus({preventScroll:true});
    if(this.tool==='select') {
      if(!hit) return;
      e.preventDefault(); e.stopPropagation();
      this.selected=hit.dataset.drawing;
      if(this.locked){this.render();return;}
      const d=this.selection(); this.drag={ id:d.id,handle:hit.dataset.handle || 'move',start:this.point(e,false),original:structuredClone(d),pointer:e.pointerId };
      this.svg.setPointerCapture(e.pointerId); this.render(); return;
    }
    e.preventDefault(); e.stopPropagation();
    if(this.locked || this.hidden){this.onError?.('Nejprve odemkni a zobraz nákresy.');return;}
    if(this.drawings.length>=100) { this.onError?.('Graf může obsahovat nejvýše 100 nákresů.');return; }
    this.onError?.('');
    if(this.tool==='horizontal') {
      const d={id:crypto.randomUUID(),kind:'horizontal',index:p.index,price:p.price}; this.drawings.push(d);this.selected=d.id;
      if(!this.keepDrawing)this.setTool('select');this.commit();this.render();return;
    }
    if(!this.draft) {
      if(['long','short'].includes(this.tool)) {
        const side=this.tool==='long'?'buy':'sell', direction=side==='buy'?1:-1;
        const stopPrice=this.series.coordinateToPrice(p.y+direction*45);
        const distance=Math.max(this.tickSize,Math.abs(p.price-stopPrice));
        this.draft={id:crypto.randomUUID(),kind:'position',side,index:p.index,endIndex:p.index+18,
          entry:p.price,stop:this.roundPrice(p.price-direction*distance),target:this.roundPrice(p.price+direction*distance*2)};
      } else this.draft={id:crypto.randomUUID(),kind:this.tool,index:p.index,endIndex:p.index,price:p.price,endPrice:p.price};
      this.render();return;
    }
    if(this.draft.kind==='position') {
      const dir=this.draft.side==='buy'?1:-1;
      if(dir*(this.draft.entry-p.price)<this.tickSize*.5) {this.onError?.('Umísti stop-loss na ztrátovou stranu vstupu.');return;}
      this.draft.stop=p.price; this.draft.target=this.roundPrice(this.draft.entry+dir*Math.abs(this.draft.entry-p.price)*2);
    } else {this.draft.endIndex=p.index;this.draft.endPrice=this.draft.kind==='line' && e.shiftKey?this.draft.price:p.price;}
    const d=this.draft;this.draft=null;this.drawings.push(d);this.selected=d.id;
    if(!this.keepDrawing)this.setTool('select');this.commit();this.render();
  }
  pointerMove(e) {
    this.lastPointer={clientX:e.clientX,clientY:e.clientY};
    let p=this.point(e);this.snapPoint=p?.snapped?p:null;if(!p){this.render();return;}
    if(this.drag) {
      const d=this.selection(), original=this.drag.original;
      // When moving an entire shape, snap its anchor rather than the arbitrary
      // spot inside the rectangle where the user grabbed it.
      if(this.drag.handle==='move') {
        const raw=this.point(e,false),anchorPrice=original.kind==='position'?original.entry:original.price;
        const rect=this.container.getBoundingClientRect();
        const anchorX=this.x(original.index),anchorY=this.series.priceToCoordinate(anchorPrice);
        if(raw && anchorX!==null && anchorY!==null) {
          const anchor=this.point({clientX:rect.left+anchorX+raw.x-this.drag.start.x,clientY:rect.top+anchorY+raw.y-this.drag.start.y});
          if(anchor){p={...anchor,price:anchor.price-anchorPrice+this.drag.start.price,index:anchor.index-original.index+this.drag.start.index};this.snapPoint=anchor.snapped?anchor:null;}
        }
      }
      const dy=p.price-this.drag.start.price, dt=p.index-this.drag.start.index;
      if(d.kind==='position') {
        const dir=d.side==='buy'?1:-1;
        if(this.drag.handle==='stop') d.stop=this.roundPrice(dir===1?Math.min(p.price,d.entry-this.tickSize):Math.max(p.price,d.entry+this.tickSize));
        else if(this.drag.handle==='target') d.target=this.roundPrice(dir===1?Math.max(p.price,d.entry+this.tickSize):Math.min(p.price,d.entry-this.tickSize));
        else if(this.drag.handle==='end') d.endIndex=Math.max(d.index+1,p.index);
        else if(this.drag.handle==='entry') d.index=Math.min(original.endIndex-1,p.index);
        else { d.entry=this.roundPrice(original.entry+dy);d.stop=this.roundPrice(original.stop+dy);d.target=this.roundPrice(original.target+dy);d.index=original.index+dt;d.endIndex=original.endIndex+dt; }
      } else if(this.drag.handle==='end') {d.endIndex=p.index;d.endPrice=d.kind==='line' && e.shiftKey?original.price:p.price;if(d.kind==='line' && e.shiftKey)this.snapPoint=null;}
      else if(this.drag.handle==='start') {d.index=p.index;d.price=d.kind==='line' && e.shiftKey?original.endPrice:p.price;if(d.kind==='line' && e.shiftKey)this.snapPoint=null;}
      else {d.index=original.index+dt;d.price=this.roundPrice(original.price+dy);if(d.endIndex!==undefined){d.endIndex=original.endIndex+dt;d.endPrice=this.roundPrice(original.endPrice+dy);}}
      this.render();return;
    }
    if(!this.draft){this.render();return;}
    if(this.draft.kind==='position') {
      const d=this.draft, dir=d.side==='buy'?1:-1;
      if(dir*(d.entry-p.price)>=this.tickSize*.5) {d.stop=p.price;d.target=this.roundPrice(d.entry+dir*Math.abs(d.entry-p.price)*2);}
    } else {this.draft.endIndex=p.index;this.draft.endPrice=this.draft.kind==='line' && e.shiftKey?this.draft.price:p.price;if(this.draft.kind==='line' && e.shiftKey)this.snapPoint=null;}
    this.render();
  }
  pointerUp(e) {
    if(!this.drag)return;
    this.drag=null;this.snapPoint=null; if(this.svg.hasPointerCapture(e.pointerId))this.svg.releasePointerCapture(e.pointerId);
    this.commit(); this.render();
  }
  render() {
    if(!this.data.length)return;
    const {width,height}=this.chart.paneSize(0);
    this.svg.style.height=`${height}px`;
    this.svg.setAttribute('viewBox',`0 0 ${this.container.clientWidth} ${height}`);
    let markup=`<defs><clipPath id="paper-drawing-clip"><rect width="${Math.max(0,width)}" height="${Math.max(0,height)}"/></clipPath></defs><g clip-path="url(#paper-drawing-clip)">`;
    for(const d of (this.hidden?[]:[...this.drawings,...(this.draft?[this.draft]:[])])) {
      const x=this.x(d.index), endX=this.x(d.endIndex ?? d.index), selected=d.id===this.selected || d===this.draft;
      if(x===null || endX===null)continue;
      const attrs=`data-drawing="${d.id}"`, handle=(cx,cy,key)=>`<circle ${attrs} data-handle="${key}" cx="${cx}" cy="${cy}" r="8" class="drawing-handle-hit"/><circle ${attrs} data-handle="${key}" cx="${cx}" cy="${cy}" r="3.25" class="drawing-handle"/>`;
      const text=(tx,ty,label,color)=>`<text x="${tx}" y="${ty}" fill="${color}" class="drawing-label">${label}</text>`;
      if(d.kind==='position') {
        const entry=this.series.priceToCoordinate(d.entry),stop=this.series.priceToCoordinate(d.stop),target=this.series.priceToCoordinate(d.target);
        if([entry,stop,target].some(v=>v===null))continue;
        const left=Math.min(x,endX),right=Math.max(x+24,endX),w=right-left;
        markup+=`<g ${attrs} class="drawing-shape ${selected?'is-selected':''}"><rect ${attrs} x="${left}" y="${Math.min(entry,stop)}" width="${w}" height="${Math.abs(stop-entry)}" fill="#e776782d" stroke="#bf6168" stroke-width="1"/><rect ${attrs} x="${left}" y="${Math.min(entry,target)}" width="${w}" height="${Math.abs(target-entry)}" fill="#40b8a12d" stroke="#469b88" stroke-width="1"/><line ${attrs} x1="${left}" x2="${right}" y1="${entry}" y2="${entry}" stroke="#c3cedd"/>`;
        const rr=Math.abs(d.target-d.entry)/Math.abs(d.entry-d.stop);
        const targetLabel=d.side==='buy'?Math.min(entry,target)+15:Math.max(entry,target)-7;
        const stopLabel=d.side==='buy'?Math.max(entry,stop)-7:Math.min(entry,stop)+15;
        markup+=text(left+7,targetLabel,`TP ${d.target.toFixed(this.precision)} · R:R 1:${rr.toFixed(2)}`,'#7bd0b6');
        markup+=text(left+7,stopLabel,`SL ${d.stop.toFixed(this.precision)} · ${Math.abs(d.entry-d.stop).toFixed(this.precision)}`,'#f0a0a2');
        markup+=text(left+7,entry-6,`${d.side==='buy'?'LONG':'SHORT'} ${d.entry.toFixed(this.precision)}`,'#d5dfeb');
        if(selected)markup+=handle(left,entry,'entry')+handle(left,stop,'stop')+handle(left,target,'target')+handle(right,entry,'end');
        markup+='</g>';
      } else {
        const y=this.series.priceToCoordinate(d.price), y2=this.series.priceToCoordinate(d.endPrice ?? d.price);if(y===null||y2===null)continue;
        if(d.kind==='horizontal')markup+=`<line ${attrs} x1="0" x2="${width}" y1="${y}" y2="${y}" stroke="#d9b17e" class="drawing-shape line-hit"/>`+text(12,y-7,d.price.toFixed(this.precision),'#d9b17e');
        else if(d.kind==='line')markup+=`<line ${attrs} x1="${x}" x2="${endX}" y1="${y}" y2="${y2}" stroke="#d9b17e" class="drawing-shape line-hit"/>`;
        else markup+=`<rect ${attrs} x="${Math.min(x,endX)}" y="${Math.min(y,y2)}" width="${Math.max(1,Math.abs(endX-x))}" height="${Math.max(1,Math.abs(y2-y))}" fill="#648ec529" stroke="#759fd3" class="drawing-shape"/>`;
        if(selected)markup+=handle(x,y,'start')+(d.kind!=='horizontal'?handle(endX,y2,'end'):'');
      }
    }
    if(this.magnet && !this.hidden && !this.locked && this.snapPoint && (this.draft || this.drag || this.tool!=='select'))markup+=`<circle cx="${this.snapPoint.x}" cy="${this.snapPoint.y}" r="7" fill="#1670ff33" stroke="#66adff" stroke-width="2" pointer-events="none"/>`;
    this.svg.innerHTML=markup+'</g>';
    this.onRender?.();
  }
}

window.PaperChartDrawings=PaperChartDrawings;
})();
