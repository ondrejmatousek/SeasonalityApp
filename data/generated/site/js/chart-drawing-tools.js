// Manual annotations only. Never changes provider data, detected zones or signals.
(() => {
    window.ChartDrawingTools={create(container,chart,series,{number}){
        const tools=[['cursor','↖','Kurzor / posun'],['horizontal','─','Vodorovná úroveň'],['line','╱','Trendová čára'],['rectangle','□','Obdélník'],['measure','↔','Měření'],['erase','⌫','Smazat vybranou kresbu'],['undo','↶','Zpět'],['clear','×','Smazat všechny ruční kresby']];
        const toolbar=document.createElement('div'),status=document.createElement('output');
        toolbar.className='zone-draw-tools';toolbar.title='Dočasné ruční kresby; nemění zóny ani výpočty.';toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label','Ruční kreslení do grafu');toolbar.setAttribute('aria-orientation','vertical');
        status.className='zone-draw-status';status.setAttribute('aria-live','polite');
        container.append(toolbar,status);
        let mode='cursor',shapes=[],history=[],anchor=null,preview=null,requestUpdate=()=>{},width=0,height=0;
        const buttons=new Map(),xy=p=>({x:chart.timeScale().logicalToCoordinate(p.logical),y:series.priceToCoordinate(p.price)});
        const message=()=>{status.hidden=mode==='cursor';status.textContent=mode==='cursor'?'Ruční kresby platí jen pro tento otevřený graf.':mode==='erase'?'Klikni / klepni na ruční kresbu.':mode==='horizontal'?'Klikni / klepni pro cenovou úroveň.':anchor?'Zvol druhý bod. Esc = zrušit.':'Zvol první bod; pak druhý. Esc = zrušit.';};
        function update(){container.dataset.drawingCount=String(shapes.length);container.dataset.drawingTool=mode;requestUpdate();}
        function choose(next){mode=next;anchor=preview=null;for(const [key,b]of buttons)if(!['undo','clear'].includes(key))b.setAttribute('aria-pressed',String(key===mode));chart.applyOptions({handleScroll:{pressedMouseMove:mode==='cursor',horzTouchDrag:mode==='cursor'}});message();update();}
        function remember(){history.push(shapes.slice());if(history.length>30)history.shift();}
        function commit(shape){if(shapes.length>=100){status.textContent='Limit 100 kreseb. Nejprve některé smaž.';anchor=preview=null;return;}remember();shapes.push(shape);anchor=preview=null;choose('cursor');}
        for(const [key,icon,label]of tools){const b=document.createElement('button');b.type='button';b.textContent=icon;b.title=label;b.setAttribute('aria-label',label);b.dataset.drawTool=key;b.addEventListener('click',e=>{e.stopPropagation();if(key==='undo'){if(history.length)shapes=history.pop();anchor=preview=null;message();update();}else if(key==='clear'){if(shapes.length){remember();shapes=[];}anchor=preview=null;message();update();}else choose(key);});toolbar.append(b);buttons.set(key,b);}
        // Toolbar navigation must not pan the underlying chart.
        toolbar.addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();e.stopPropagation();const list=[...buttons.values()],i=list.indexOf(document.activeElement);list[e.key==='Home'?0:e.key==='End'?list.length-1:(i+(e.key==='ArrowDown'?1:-1)+list.length)%list.length].focus();}});
        const point=p=>{if(!p.point||p.point.x<0||p.point.y<0||p.point.x>width||p.point.y>height)return null;const logical=chart.timeScale().coordinateToLogical(p.point.x),price=series.coordinateToPrice(p.point.y);return Number.isFinite(logical)&&Number.isFinite(price)?{logical,price}:null;};
        const distance=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);};
        function hit(s,p){const a=xy(s.a),b=xy(s.b||s.a);if([a.x,a.y,b.x,b.y].some(v=>v===null))return false;if(s.type==='horizontal')return Math.abs(p.y-a.y)<10;if(s.type==='rectangle')return Math.min(distance(p,a,{x:b.x,y:a.y}),distance(p,{x:b.x,y:a.y},b),distance(p,b,{x:a.x,y:b.y}),distance(p,{x:a.x,y:b.y},a))<10;return distance(p,a,b)<10;}
        const click=p=>{if(mode==='cursor')return;const a=point(p);if(!a)return;
            if(mode==='erase'){for(let i=shapes.length-1;i>=0;i--)if(hit(shapes[i],p.point)){remember();shapes.splice(i,1);update();break;}return;}
            if(mode==='horizontal'){commit({type:mode,a});return;}
            if(!anchor){anchor=a;message();update();}else commit({type:mode,a:anchor,b:a});
        };
        const move=p=>{if(anchor){const end=point(p);preview=end?{type:mode,a:anchor,b:end}:null;update();}};
        const renderer={draw(target){target.useMediaCoordinateSpace(({context:ctx,mediaSize})=>{width=mediaSize.width;height=mediaSize.height;ctx.save();ctx.beginPath();ctx.rect(0,0,width,height);ctx.clip();
            for(const s of [...shapes,...(preview?[preview]:[])]){const a=xy(s.a),b=xy(s.b||s.a);if([a.x,a.y,b.x,b.y].some(v=>v===null))continue;ctx.strokeStyle=s.type==='measure'?'#f6c65c':'#62b5ff';ctx.fillStyle='#62b5ff22';ctx.lineWidth=2;ctx.setLineDash(s===preview?[4,4]:[]);
                if(s.type==='rectangle'){ctx.fillRect(a.x,a.y,b.x-a.x,b.y-a.y);ctx.strokeRect(a.x,a.y,b.x-a.x,b.y-a.y);}else{ctx.beginPath();ctx.moveTo(s.type==='horizontal'?0:a.x,a.y);ctx.lineTo(s.type==='horizontal'?width:b.x,s.type==='horizontal'?a.y:b.y);ctx.stroke();}
                if(s.type==='measure'||s.type==='horizontal'){const delta=s.b?s.b.price-s.a.price:0,text=s.type==='horizontal'?number(s.a.price):`${number(delta)} · ${(delta/Math.abs(s.a.price)*100).toFixed(2)} % · ${Math.abs(s.b.logical-s.a.logical).toFixed(1)} sv.`;ctx.font='11px sans-serif';const textWidth=Math.min(width-8,ctx.measureText(text).width+8),left=Math.max(0,Math.min(a.x,width-textWidth)),top=Math.max(2,Math.min(a.y-24,height-20));ctx.fillStyle='#15212b';ctx.fillRect(left,top,textWidth,20);ctx.fillStyle=s.type==='measure'?'#f6c65c':'#b9ddff';ctx.fillText(text,left+4,top+14);}
            }ctx.restore();});}};
        const primitive={attached:p=>{requestUpdate=p.requestUpdate;},detached:()=>{requestUpdate=()=>{};},paneViews:()=>[{zOrder:()=> 'top',renderer:()=>renderer}]};
        series.attachPrimitive(primitive);
        // Handle drawing pointers independently of the library's pan/double-click
        // recognizer. Cursor mode is left entirely to the native chart.
        const host=container.querySelector('.zone-chart-canvas'),eventPoint=e=>{const b=host.getBoundingClientRect();return {point:{x:e.clientX-b.left,y:e.clientY-b.top}};};
        const down=e=>{if(mode==='cursor'||e.button!==0)return;e.preventDefault();e.stopImmediatePropagation();container.focus({preventScroll:true});host.setPointerCapture(e.pointerId);};
        const pointerMove=e=>{if(mode!=='cursor')move(eventPoint(e));};
        const up=e=>{if(mode==='cursor'||e.button!==0)return;e.preventDefault();e.stopImmediatePropagation();if(host.hasPointerCapture(e.pointerId))host.releasePointerCapture(e.pointerId);click(eventPoint(e));};
        host.addEventListener('pointerdown',down,true);host.addEventListener('pointermove',pointerMove,true);host.addEventListener('pointerup',up,true);
        const key=e=>{if(e.key==='Escape'&&mode!=='cursor'){e.preventDefault();e.stopImmediatePropagation();choose('cursor');}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.stopPropagation();buttons.get('undo').click();}};
        container.addEventListener('keydown',key,true);choose('cursor');
        return {get active(){return mode!=='cursor';},destroy(){container.removeEventListener('keydown',key,true);host.removeEventListener('pointerdown',down,true);host.removeEventListener('pointermove',pointerMove,true);host.removeEventListener('pointerup',up,true);series.detachPrimitive(primitive);toolbar.remove();status.remove();delete container.dataset.drawingCount;delete container.dataset.drawingTool;}};
    }};
})();
