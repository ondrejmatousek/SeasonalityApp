// Trade Replay toolbar, scoped to the H4 Papertrading chart.
(() => {
const paths={
  select:'<path d="M12 2v6m0 8v6M2 12h6m8 0h6"/>',
  line:'<path d="m4 20 16-16"/><circle cx="4" cy="20" r="1.7"/><circle cx="20" cy="4" r="1.7"/>',
  horizontal:'<path d="M2 12h20"/><circle cx="9" cy="12" r="2"/>',
  rectangle:'<rect x="4" y="5" width="16" height="14"/><path d="M3 4h3v3H3zm15 13h3v3h-3z"/>',
  long:'<path d="M4 3v18M4 6h15M4 12h15M4 18h15"/><circle cx="19" cy="6" r="1.5"/><circle cx="19" cy="12" r="1.5"/><circle cx="19" cy="18" r="1.5"/><path d="m9 10 3-3 3 3"/>',
  short:'<path d="M4 3v18M4 6h15M4 12h15M4 18h15"/><circle cx="19" cy="6" r="1.5"/><circle cx="19" cy="12" r="1.5"/><circle cx="19" cy="18" r="1.5"/><path d="m9 14 3 3 3-3"/>',
  magnet:'<path d="M5 4v9a7 7 0 0 0 14 0V4h-4v9a3 3 0 0 1-6 0V4ZM5 8h4m6 0h4"/>',
  repeat:'<path d="m4 16 11-11 4 4L8 20H4Zm9-9 4 4M20 2v4h-4M3 8V4h4"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="1.5"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2"/>',
  eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  hidden:'<path d="m3 3 18 18M9 5.5A11 11 0 0 1 12 5c6 0 10 7 10 7a20 20 0 0 1-3 3M6 6.5A24 24 0 0 0 2 12s4 7 10 7a13 13 0 0 0 5-1M10 10a3 3 0 0 0 4 4"/>',
  undo:'<path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12h-2"/>',
  trash:'<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
};
const drawingIcon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
const groups=[
  {id:'lines',label:'Čáry',tools:[['line','Trendová čára'],['horizontal','Vodorovná čára']]},
  {id:'shapes',label:'Geometrické tvary',tools:[['rectangle','Obdélník / zóna']]},
  {id:'positions',label:'Projekce a pozice',tools:[['long','Long pozice'],['short','Short pozice']]},
];
const action=(id,label,path,toggle=false)=>`<button type="button" class="tv-tool" id="${id}" title="${label}" aria-label="${label}" ${toggle?'aria-pressed="false"':''}>${drawingIcon(path)}</button>`;
function drawingToolbarHTML() {
  return `<nav class="drawing-tools tv-drawing-tools" aria-label="Kreslicí nástroje"><button type="button" class="tv-tool tv-cursor selected" data-tool="select" title="Kurzor · Escape" aria-label="Kurzor" aria-pressed="true">${drawingIcon('select')}</button>
  ${groups.map(g=>`<div class="tv-tool-group" data-group="${g.id}"><button type="button" class="tv-tool tv-group-primary" data-tool="${g.tools[0][0]}" title="${g.tools[0][1]}" aria-label="${g.tools[0][1]}" aria-pressed="false">${drawingIcon(g.tools[0][0])}</button><button type="button" class="tv-group-expand" data-expand="${g.id}" aria-label="Otevřít nástroje: ${g.label}" aria-expanded="false" aria-controls="tools-${g.id}"><svg viewBox="0 0 8 8"><path d="m2 1 3 3-3 3"/></svg></button><div class="tv-tool-menu" id="tools-${g.id}" hidden role="menu" aria-label="${g.label}"><div class="tv-menu-title">${g.label}</div>${g.tools.map(([tool,label])=>`<button type="button" role="menuitem" data-tool="${tool}">${drawingIcon(tool)}<span>${label}</span><span class="tv-menu-check" aria-hidden="true">✓</span></button>`).join('')}</div></div>`).join('')}
  <span class="tv-separator"></span>${action('drawing-magnet','Magnet: přichytit k OHLC svíčky','magnet',true)}${action('drawing-repeat','Zůstat v režimu kreslení','repeat',true)}${action('drawing-lock','Uzamknout všechny nákresy','lock',true)}${action('drawing-visibility','Skrýt všechny nákresy','eye',true)}<span class="tv-separator"></span>${action('drawing-undo','Vrátit poslední úpravu nákresů · Ctrl+Z','undo')}${action('delete-drawing','Smazat vybraný nákres · Delete','trash')}</nav>`;
}

function mountDrawingToolbar(container, editor) {
  container.insertAdjacentHTML('afterbegin', drawingToolbarHTML());
  const root=container.querySelector('.tv-drawing-tools');
  function close() {root.querySelectorAll('.tv-tool-menu').forEach(m=>m.hidden=true);root.querySelectorAll('[data-expand]').forEach(b=>b.setAttribute('aria-expanded','false'));}
  const choose=tool=>{close();editor.setTool(tool);container.focus({preventScroll:true});};
  root.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>choose(b.dataset.tool));
  root.querySelectorAll('[data-expand]').forEach(b=>b.onclick=()=>{
    const menu=root.querySelector(`#tools-${b.dataset.expand}`),wasOpen=!menu.hidden;close();
    if(!wasOpen){menu.hidden=false;b.setAttribute('aria-expanded','true');menu.style.top='0px';
      const bottom=menu.getBoundingClientRect().bottom;
      if(bottom>window.innerHeight-12)menu.style.top=`${window.innerHeight-12-bottom}px`;
      menu.querySelector('[role=menuitem]').focus();}
  });
  const outside=e=>{if(!root.contains(e.target))close();};
  const keyboard=e=>{
    if(e.key==='Escape' && root.querySelector('.tv-tool-menu:not([hidden])')){
      const expand=root.querySelector('[aria-expanded=true]');
      close();expand?.focus();e.preventDefault();e.stopPropagation();return;
    }
    const menu=e.target.closest('.tv-tool-menu');if(!menu || menu.hidden)return;
    if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
      e.preventDefault();const buttons=[...menu.querySelectorAll('[role=menuitem]')];const i=buttons.indexOf(e.target);
      const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[next].focus();
    }
  };
  document.addEventListener('pointerdown',outside);root.addEventListener('keydown',keyboard);
  root.querySelector('#drawing-magnet').onclick=()=>{editor.magnet=!editor.magnet;editor.snapPoint=null;editor.render();};
  root.querySelector('#drawing-repeat').onclick=()=>{editor.keepDrawing=!editor.keepDrawing;syncFlags();};
  root.querySelector('#drawing-lock').onclick=()=>{editor.locked=!editor.locked;editor.setTool('select');};
  root.querySelector('#drawing-visibility').onclick=()=>{editor.hidden=!editor.hidden;editor.selected=null;editor.setTool('select');};
  root.querySelector('#drawing-undo').onclick=()=>editor.undo();
  root.querySelector('#delete-drawing').onclick=()=>editor.removeSelected();
  function syncTool(tool){
    for(const g of groups){const found=g.tools.find(([t])=>t===tool);if(!found)continue;
      const primary=root.querySelector(`[data-group="${g.id}"] .tv-group-primary`);
      primary.dataset.tool=tool;primary.title=found[1];primary.setAttribute('aria-label',found[1]);primary.innerHTML=drawingIcon(tool);
      primary.onclick=()=>choose(primary.dataset.tool);
    }
    root.querySelectorAll('[data-tool]').forEach(b=>{const active=b.dataset.tool===tool;b.classList.toggle('selected',active);if(b.getAttribute('role')!=='menuitem')b.setAttribute('aria-pressed',String(active));});
  }
  function syncFlags(){
    for(const [id,key] of [['drawing-magnet','magnet'],['drawing-repeat','keepDrawing'],['drawing-lock','locked'],['drawing-visibility','hidden']]){
      const b=root.querySelector(`#${id}`);b.classList.toggle('enabled',Boolean(editor[key]));b.setAttribute('aria-pressed',String(Boolean(editor[key])));
    }
    const visibility=root.querySelector('#drawing-visibility');
    const icon=editor.hidden?'hidden':'eye';
    if(visibility.dataset.icon!==icon){visibility.dataset.icon=icon;visibility.innerHTML=drawingIcon(icon);}
    const label=editor.hidden?'Zobrazit všechny nákresy':'Skrýt všechny nákresy';
    visibility.title=label;visibility.setAttribute('aria-label',label);
    root.querySelector('#drawing-undo').disabled=editor.locked || !editor.history.length;
    root.querySelector('#delete-drawing').disabled=editor.locked || !editor.selection();
  }
  syncTool(editor.tool);
  syncFlags();
  return {syncTool,syncFlags,destroy:()=>{close();document.removeEventListener('pointerdown',outside);root.removeEventListener('keydown',keyboard);root.remove();}};
}

window.PaperChartToolbar={create(container,host,chart,series,{data,precision}) {
  const status=document.createElement('output');
  status.className='paper-drawing-status';
  status.setAttribute('aria-live','polite');
  container.append(status);
  let toolbar;
  const editor=new window.PaperChartDrawings({
    container:host,chart,series,data,precision,focusTarget:container,
    onTool:tool=>{status.textContent='';toolbar?.syncTool(tool);},
    onError:message=>{status.textContent=message;},
    onRender:()=>toolbar?.syncFlags()
  });
  toolbar=mountDrawingToolbar(container,editor);
  function key(e) {
    if(e.defaultPrevented)return;
    if(e.key==='Escape' && editor.tool!=='select')editor.setTool('select');
    else if(e.key==='Delete')editor.removeSelected();
    else if((e.ctrlKey || e.metaKey) && e.key.toLowerCase()==='z')editor.undo();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
  container.addEventListener('keydown',key);
  return {
    get active(){return editor.tool!=='select';},
    destroy(){
      container.removeEventListener('keydown',key);
      toolbar.destroy();
      editor.destroy();
      status.remove();
    }
  };
}};
})();
