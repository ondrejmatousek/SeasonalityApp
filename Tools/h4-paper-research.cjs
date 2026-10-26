// Read-only analysis of the baseline plus an independent forward-only sidecar.
const Sim=require('./h4-paper-research-engine.cjs');
const copy=x=>JSON.parse(JSON.stringify(x)),ms=x=>Date.parse(x);
const plan=Object.freeze({id:'fm-h4-research-v1',baseline:'fm-h4-touch-2r-v1',discoveryTarget:100,validationTarget:100,minGroup:30,minDays:10,bootstrap:1000,
 groups:[{id:'all',label:'Původní dotyk · 2R'},{id:'bos',label:'Původní 2R · pouze BOS'},{id:'volume',label:'Původní 2R · pouze vysoké volume'},...Sim.variants.map(v=>({id:v.id,label:v.label}))],
 rules:'BOS=yes; volume=high at registration. Separate TP3R/SL10% forward OCO ledgers. M15: verified OANDA candles, confirmed 2-left/2-right pivot before signal, sweep and close back after zone touch within 8 M15 intervals; enter next open, H4-zone stop +5%, TP2R. No EMA, no live orders. Costs: baseline assumptions, financing unmodeled. Candidate: >=30 closed, >=10 UTC entry days, positive bootstrap lower bound and double-cost mean; highest mean among eligible. No automatic promotion.'});
function closed(s){return ['tp','sl'].includes(s.status)&&Number.isFinite(s.netR)&&Number.isFinite(s.grossR)&&Number.isFinite(s.costR)&&s.costR>=0&&Number.isFinite(ms(s.resolvedAt))&&Number.isFinite(ms(s.enteredAt))&&ms(s.enteredAt)>=ms(s.frozen.registeredAt)&&ms(s.resolvedAt)>=ms(s.enteredAt);}
function rng(seed){let n=2166136261;for(const c of seed)n=Math.imul(n^c.charCodeAt(0),16777619);return ()=>{n^=n<<13;n^=n>>>17;n^=n<<5;return (n>>>0)/4294967296;};}
function stats(rows,seed){
 const trades=rows.filter(closed).sort((a,b)=>ms(a.resolvedAt)-ms(b.resolvedAt)||a.netR-b.netR||a.id.localeCompare(b.id));
 let total=0,peak=0,dd=0,gain=0,loss=0,stress=0;
 const blocks=new Map();
 for(const t of trades){total+=t.netR;stress+=t.grossR-2*t.costR;peak=Math.max(peak,total);dd=Math.max(dd,peak-total);gain+=Math.max(0,t.netR);loss+=Math.max(0,-t.netR);const day=new Date(t.enteredAt).toISOString().slice(0,10);if(!blocks.has(day))blocks.set(day,[]);blocks.get(day).push(t.netR);}
 let mean95=null;
 if(blocks.size>=5){const values=[...blocks.values()],random=rng(seed),samples=[];
  for(let k=0;k<plan.bootstrap;k++){let sum=0,n=0;for(let d=0;d<values.length;d++){const block=values[Math.floor(random()*values.length)];for(const r of block){sum+=r;n++;}}samples.push(sum/n);}
  samples.sort((a,b)=>a-b);mean95=[samples[24],samples[974]];
 }
 const n=trades.length,w=trades.filter(t=>t.status==='tp').length,z=1.95996398454,p=n?w/n:0,den=n?1+z*z/n:1;
 const center=n?(p+z*z/(2*n))/den:0,half=n?z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/den:0;
 return {n,tp:w,sl:n-w,totalR:total,meanR:n?total/n:null,profitFactor:loss?gain/loss:null,noLosses:n>0&&loss===0,drawdownR:dd,stressR:stress,stressMeanR:n?stress/n:null,entryDays:blocks.size,mean95,win95:n?[center-half,center+half]:null,
  pending:rows.filter(s=>s.status==='waiting').length,open:rows.filter(s=>s.status==='open').length,needsData:rows.filter(s=>s.status==='needs_data').length,ambiguous:rows.filter(s=>s.status==='ambiguous').length,cancelled:rows.filter(s=>s.status==='cancelled').length,invalidClosed:rows.filter(s=>['tp','sl'].includes(s.status)&&!closed(s)).length};
}
function registration(s){return s.frozen.baselineRegisteredAt||s.frozen.registeredAt;}
function groups(state,baseline,after=state.startedAt){
 const eligible=s=>Number.isFinite(ms(registration(s)))&&ms(registration(s))>=ms(after);
 const base=baseline.state.setups.filter(eligible),shadows=state.simulations.filter(eligible);
 return plan.groups.map(g=>({id:g.id,label:g.label,...stats(g.id==='all'?base:g.id==='bos'?base.filter(s=>s.frozen.zone?.bos?.state==='yes'):g.id==='volume'?base.filter(s=>s.frozen.zone?.volume?.state==='high'):shadows.filter(s=>s.frozen.variant===g.id),state.plan.id+'|'+g.id+'|'+after)}));
}
function candidate(rows){return [...rows].filter(s=>s.n>=plan.minGroup&&s.entryDays>=plan.minDays&&s.mean95?.[0]>0&&s.stressMeanR>0&&!s.invalidClosed).sort((a,b)=>b.meanR-a.meanR||a.id.localeCompare(b.id))[0]?.id??null;}
function update(previous,baseline,sources,now,hash){
 if(baseline.state?.model!==plan.baseline||!Number.isInteger(baseline.revision)||baseline.revision<1||!Number.isFinite(ms(now)))throw Error('Research requires a real baseline ledger and clock');
 if(baseline.state.setups.some(s=>ms(s.frozen.registeredAt)>ms(now)||s.resolvedAt&&ms(s.resolvedAt)>ms(now)))throw Error('Future baseline evidence');
 const before=JSON.stringify(baseline),state=previous?copy(previous):{schemaVersion:1,model:plan.id,plan:copy(plan),startedAt:now,lastRunAt:now,baselineRevision:0,simulations:[],events:[],checkpoints:[]};
 if(JSON.stringify(state.plan)!==JSON.stringify(plan)||state.model!==plan.id||ms(now)<ms(state.lastRunAt)||baseline.revision<state.baselineRevision)throw Error('Research plan/revision changed; never reset or reinterpret the old ledger');
 if(previous&&baseline.revision===state.baselineRevision&&baseline.stateSha256!==state.baselineSha256)throw Error('Baseline identity changed without a revision');
 state.lastRunAt=now;state.baselineRevision=baseline.revision;state.baselineSha256=baseline.stateSha256;
 Sim.update(state,baseline,sources,now,hash);
 const prospective=groups(state,baseline),base=prospective.find(g=>g.id==='all');
 if(!state.checkpoints.some(c=>c.id==='discovery100')&&base.n>=plan.discoveryTarget){
  const checkpoint={id:'discovery100',createdAt:now,baselineRevision:baseline.revision,baselineSha256:baseline.stateSha256,groups:copy(prospective),candidateId:candidate(prospective),meaning:'Discovery only. First publication with >=100 prospective baseline closures; not proof of a live winner.'};
  state.checkpoints.push({...checkpoint,sha256:hash(JSON.stringify(checkpoint))});
 }
 const discovery=state.checkpoints.find(c=>c.id==='discovery100');
 // Validation trades MUST be registered after the saved discovery report, not merely close later.
 const validation=discovery?groups(state,baseline,new Date(ms(discovery.createdAt)+1).toISOString()):null;
 if(validation?.find(g=>g.id==='all').n>=plan.validationTarget&&!state.checkpoints.some(c=>c.id==='validation100')){
  const selected=validation.find(g=>g.id===discovery.candidateId),pass=selected&&selected.n>=plan.minGroup&&selected.entryDays>=plan.minDays&&selected.mean95?.[0]>0&&selected.stressMeanR>0;
  const checkpoint={id:'validation100',createdAt:now,baselineRevision:baseline.revision,candidateId:discovery.candidateId,passed:Boolean(pass),groups:copy(validation),meaning:'Frozen candidate tested only on newly registered trades after discovery. Passing is model evidence, not guaranteed live profitability.'};
  state.checkpoints.push({...checkpoint,sha256:hash(JSON.stringify(checkpoint))});
 }
 state.report={schemaVersion:1,ready:true,model:state.model,startedAt:state.startedAt,lastRunAt:now,baselineRevision:baseline.revision,baselineSha256:baseline.stateSha256,target:plan.discoveryTarget,progress:base.n,groups:prospective,exploratory:groups(state,baseline,'1970-01-01T00:00:00Z').slice(0,3),validation,checkpoints:copy(state.checkpoints),availability:copy(state.availability),plan:copy(plan),notice:'Overlapping cohorts are not additive or independent. Closed-trade R, not account return or mark-to-market drawdown. Bootstrap by UTC entry day is approximate and does not remove all FX dependence/multiple-testing bias. Financing, broker tick/min-distance and actual costs unmodeled. Unknown outcomes stay outside TP/SL and are counted separately. No live winner or auto activation.'};
 if(JSON.stringify(baseline)!==before)throw Error('Baseline mutated by research');
 return state;
}
module.exports={plan,stats,groups,candidate,update,closed};
