(() => {
    const root=document.querySelector('.seasonality-page'),panel=document.getElementById('market-htf-view');if(!root||!panel)return;
    const by=id=>document.getElementById(id),status=by('htf-status'),tbody=by('htf-results'),canvas=by('htf-price-chart'),tip=by('htf-tooltip');
    const num=v=>new Intl.NumberFormat('cs-CZ',{maximumFractionDigits:4}).format(v),pct=v=>num(v)+' %',date=s=>new Date(s+'T00:00:00Z').toLocaleDateString('cs-CZ'),day=s=>Date.parse(s+'T00:00:00Z');
    const labels={confirms:'Potvrzuje',against:'Proti směru',neutral:'Neutrální',insufficient:'Bez dostatku dat'},priceLabels={inside:'Uvnitř zóny',near:'Poblíž zóny',far:'Cena daleko · čekání'};
    let snapshot,selected,loading=false,geometry;
    const el=(tag,text)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;return n;};
    function stale(){return !snapshot||day(new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Prague'}).format(new Date()))-day(snapshot.asOf)>86400000;}
    async function load(){if(loading)return;loading=true;status.textContent='Načítám ranní HTF analýzu…';try{if(!window.StaticMarketData)throw Error('HTF vyžaduje statický export OHLC');snapshot=await window.StaticMarketData.htf();render();}catch(e){status.textContent='HTF data nedostupná: '+e.message;status.classList.add('is-error');}finally{loading=false;}}
    function rows(){return snapshot.assets.filter(a=>a.mapping.scope==='core'&&a.mapping.executionKind!=='futures-profile').flatMap(a=>a.matches.map(m=>({asset:a,match:m,price:snapshot.prices[a.mapping.priceKey],zone:snapshot.prices[a.mapping.priceKey].zones.find(z=>z.id===m.zoneId)}))).filter(r=>r.zone&& (by('htf-timeframe').value==='all'||r.zone.timeframe===by('htf-timeframe').value)&& (by('htf-direction').value==='all'||r.match.candidate.direction===by('htf-direction').value)&& (by('htf-mode').value==='all'||r.match.priceState!=='far')&& (by('htf-mode').value!=='confirmed'||(!stale()&&r.match.cotState==='confirms'))).sort((a,b)=>a.match.distanceAtr-b.match.distanceAtr||b.match.candidate.scoringV2.rawScore-a.match.candidate.scoringV2.rawScore);}
    function render(){if(!snapshot)return;const list=rows(),ready=Object.values(snapshot.prices).filter(p=>p.status==='ready').length;
        status.textContent=`Vyhodnoceno ${date(snapshot.asOf)} · OHLC ${ready}/${Object.keys(snapshot.prices).length} cenových zdrojů · ${list.length} shod zón a období (ne nezávislých obchodů). ${stale()?'STARŠÍ SNAPSHOT — aktuální shodu znovu ověř; COT potvrzení filtr nevrací.':'Cena je poslední dokončený den, nikoli živá kotace.'}`;status.classList.toggle('is-error',stale());
        tbody.replaceChildren();for(const r of list){const tr=el('tr'),c=r.match.candidate,s=c.histories[20].seasonal;tr.dataset.key=r.asset.key;
            const texts=[r.asset.key+' / '+r.asset.mapping.priceKey,`${r.zone.timeframe} ${r.zone.type} · ${num(r.zone.lower)}–${num(r.zone.upper)}`,priceLabels[r.match.priceState],`${date(c.startDate)} – ${date(c.endDate)} · ${r.match.seasonalState==='active'?'probíhá':'teprve přijde'}`,`${pct(s.rate)} · ${s.count} období`,labels[r.match.cotState]];
            texts.forEach((text,i)=>{const td=el('td',text);if(i===0)td.append(el('small',r.asset.mapping.exposureFamily));if(i===1)td.append(el('small',`${r.zone.visits} návratů · vznik ${date(r.zone.confirmedAt)}`));if(i===2)td.append(el('small',`Close ${num(r.price.latestClose)} · ${date(r.price.latestDate)} · vzdálenost ${num(r.match.distanceAtr)} ATR`));if(i===4)td.append(el('small',`Medián ${pct(s.median)} · raw ${num(c.scoringV2.rawScore)}/10`));if(i===5)td.append(el('small',`Podobné ${c.scoringV2.samples.similar} · ostatní ${c.scoringV2.samples.other}`));tr.append(td);});
            const td=el('td'),button=el('button','Ukázat graf');button.type='button';button.onclick=()=>{selected=r;show();by('htf-detail').scrollIntoView({behavior:'smooth',block:'start'});};td.append(button);tr.append(td);tbody.append(tr);}
        if(!list.length){const td=el('td','Žádná shoda pro tento výběr. Přepni na všechny shody pro čekající vzdálené zóny; nevytváříme potvrzení násilně.');td.colSpan=7;const tr=el('tr');tr.append(td);tbody.append(tr);}
        by('htf-coverage').replaceChildren();for(const [key,p]of Object.entries(snapshot.prices))by('htf-coverage').append(el('p',p.status==='ready'?`${key}: ${p.provider} ${p.symbol} · ${p.timezone} · ${p.barCount} OHLC · poslední ${p.latestDate} · ${p.zones.length} zón${p.lastSplit?' · detekce pouze po splitu '+p.lastSplit:''}`:`${key}: NEDOSTUPNÉ — ${p.error}`));
        if(!selected||!list.some(r=>r.asset.key===selected.asset.key&&r.zone.id===selected.zone.id&&r.match.candidate.startDate===selected.match.candidate.startDate))selected=list[0];by('htf-detail').hidden=!selected;if(selected)show();else geometry=null;
    }
    function show(){const {asset,zone,match,price}=selected,c=match.candidate,s=c.histories[20].seasonal;
        by('htf-detail').hidden=false;by('htf-chart-title').textContent=`${asset.key} · ${zone.timeframe} ${zone.type} · ${c.direction==='up'?'růst':'pokles'}`;
        const profiles=snapshot.assets.filter(a=>a.mapping.priceKey===asset.mapping.priceKey&&a.mapping.executionKind==='futures-profile').map(a=>a.key);
        by('htf-chart-caption').textContent=`Cenová reference ${asset.mapping.priceKey} · ${price.provider} ${price.symbol} · ${price.timezone}. ${profiles.length?'Profily '+profiles.join('/')+': úrovně zóny jsou ceny indexu, ne futures. ':''}Tyrkysový svislý výřez je sezonní období, barevné vodorovné pásmo je zóna. Vpravo za poslední svíčkou není předpověď.`;
        const metrics=by('htf-metrics');metrics.replaceChildren();for(const [title,value,note]of [
            ['Cena vs zóna',priceLabels[match.priceState],`Poslední dokončený close ${num(price.latestClose)} z ${date(price.latestDate)}.`],
            ['Sezonalita',pct(s.rate),`${s.count} dokončených období / posledních 20 let; medián ${pct(s.median)}. Výběr intervalu z maximální dokončené historie.`],
            ['Historická COT shoda',labels[match.cotState],`C = ${num(c.scoringV2.components.C)}; ${c.scoringV2.samples.similar} podobných / ${c.scoringV2.samples.other} ostatních případů. ${asset.mapping.cotSources.map(v=>v.name||v.key).join(' + ')}.`],
            ['Co teď',stale()?'Starší data · znovu ověř':match.priceState==='far'?'Čekat na návrat ceny':match.seasonalState==='upcoming'?'Čekat na sezonní období':'Hledat setup · ne automatický vstup','Denní close v zóně není potvrzení obratu. Aktuální strukturu, cenu a risk ověř v trading grafu.']]){const box=el('div');box.append(el('small',title),el('strong',value),el('small',note));metrics.append(box);}draw();
    }
    function draw(){if(!selected||panel.hidden)return;tip.hidden=true;const {zone,price,match}=selected,bars=(zone.timeframe==='W1'?price.weekly:price.bars).slice(zone.timeframe==='W1'?-52:-90);if(!bars.length)return;
        const w=canvas.clientWidth,h=canvas.clientHeight,dpr=window.devicePixelRatio||1;canvas.width=w*dpr;canvas.height=h*dpr;const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);
        // Ordinal trading-bar axis: Friday and Monday are neighbouring candles.
        // Future slots only locate the seasonal window; they never contain OHLC.
        const slots=bars.map(b=>b.date),cursor=new Date(day(slots.at(-1)));
        while(slots.at(-1)<match.candidate.endDate){cursor.setUTCDate(cursor.getUTCDate()+(zone.timeframe==='W1'?7:1));if(zone.timeframe==='W1'||![0,6].includes(cursor.getUTCDay()))slots.push(cursor.toISOString().slice(0,10));}
        for(let i=0;i<4;){cursor.setUTCDate(cursor.getUTCDate()+(zone.timeframe==='W1'?7:1));if(zone.timeframe==='W1'||![0,6].includes(cursor.getUTCDay())){slots.push(cursor.toISOString().slice(0,10));i++;}}
        const left=80,right=w-18,top=22,bottom=h-38,spacing=(right-left)/slots.length,low=Math.min(zone.lower,...bars.map(b=>b.low)),high=Math.max(zone.upper,...bars.map(b=>b.high)),pad=(high-low)*.08||1,y=v=>bottom-(v-low+pad)/(high-low+2*pad)*(bottom-top);
        const position=d=>{const next=slots.findIndex(s=>s>=d);if(next===0)return 0;if(next<0)return slots.length-1;const fraction=(day(d)-day(slots[next-1]))/(day(slots[next])-day(slots[next-1]));return next-1+fraction;},x=d=>left+(position(d)+.5)*spacing;
        ctx.font='12px sans-serif';ctx.fillStyle='#a9b8c2';for(let i=0;i<=4;i++){const value=low-pad+(high-low+2*pad)*i/4,yy=y(value);ctx.strokeStyle='#39454a';ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(right,yy);ctx.stroke();ctx.fillText(num(value),3,yy+4);}
        ctx.save();ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();const sx=x(match.candidate.startDate),ex=x(match.candidate.endDate);ctx.fillStyle='#24dfcf18';ctx.fillRect(sx,top,ex-sx,bottom-top);ctx.strokeStyle='#7ecac1';ctx.setLineDash([5,5]);for(const xx of[sx,ex]){ctx.beginPath();ctx.moveTo(xx,top);ctx.lineTo(xx,bottom);ctx.stroke();}ctx.setLineDash([]);
        ctx.fillStyle=zone.type==='demand'?'#24dfcf35':'#f28aa835';ctx.strokeStyle=zone.type==='demand'?'#24dfcf':'#f28aa8';const zx=Math.max(left,x(zone.baseDate));ctx.fillRect(zx,y(zone.upper),right-zx,y(zone.lower)-y(zone.upper));ctx.strokeRect(zx,y(zone.upper),right-zx,y(zone.lower)-y(zone.upper));
        const bw=Math.max(1,spacing*.86);
        ctx.lineWidth=1;
        for(const b of bars){
            const xx=Math.round(x(b.date)*dpr)/dpr,bodyTop=Math.min(y(b.open),y(b.close)),bodyBottom=Math.max(y(b.open),y(b.close));
            ctx.strokeStyle=ctx.fillStyle=b.close>=b.open?'#22c55e':'#ef4444';
            // Wicks terminate at the actual open/close body, including dojis.
            ctx.beginPath();ctx.moveTo(xx,y(b.high));ctx.lineTo(xx,bodyTop);ctx.moveTo(xx,bodyBottom);ctx.lineTo(xx,y(b.low));ctx.stroke();
            const bodyHeight=Math.max(b.open===b.close?1/dpr:2,bodyBottom-bodyTop);
            ctx.fillRect(xx-bw/2,(bodyTop+bodyBottom-bodyHeight)/2,bw,bodyHeight);
        }ctx.restore();
        ctx.fillStyle='#a9b8c2';for(let i=0;i<5;i++){const d=slots[Math.round((slots.length-1)*i/4)];ctx.fillText(date(d),Math.min(right-65,x(d)),h-12);}geometry={bars,x,y,left,right,top,bottom};
    }
    canvas.onpointermove=e=>{if(!geometry||!selected)return;const box=canvas.getBoundingClientRect(),px=e.clientX-box.left,py=e.clientY-box.top;if(px<geometry.left||px>geometry.x(geometry.bars.at(-1).date)+5||py<geometry.top||py>geometry.bottom){tip.hidden=true;return;}const b=geometry.bars.reduce((best,b)=>Math.abs(geometry.x(b.date)-px)<Math.abs(geometry.x(best.date)-px)?b:best);tip.textContent=`${date(b.date)}\nO ${num(b.open)} · H ${num(b.high)}\nL ${num(b.low)} · C ${num(b.close)}`;tip.hidden=false;const pos=window.MarketChartUi.tooltipPosition(px,py,tip.offsetWidth,tip.offsetHeight,box.width,box.height);tip.style.left=pos.left+'px';tip.style.top=pos.top+'px';};canvas.onpointerleave=()=>tip.hidden=true;
    for(const id of['htf-mode','htf-timeframe','htf-direction'])by(id).onchange=render;
    by('htf-retry').onclick=load;root.addEventListener('htf-visible',()=>snapshot?render():load());new ResizeObserver(()=>{if(selected&&!panel.hidden)draw();}).observe(canvas);
})();
