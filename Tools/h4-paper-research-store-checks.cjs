const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const F=require('./h4-paper-research-checks.cjs'),copy=x=>JSON.parse(JSON.stringify(x));
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'seasonality-paper-research-store-')),dll=path.resolve('Tools/PaperResearchStore/bin/Release/net10.0/PaperResearchStore.dll');
const wrap=s=>({state:{...copy(s),implementationSha256:F.hash('isolated fixture')}});
const initial=wrap(F.init),discovery=wrap(F.state);
function check(label,next,expected,previous){const file=path.join(directory,label+'.json'),old=path.join(directory,label+'-old.json');fs.writeFileSync(file,JSON.stringify(next));const args=[dll,'--validate',file];if(previous){fs.writeFileSync(old,JSON.stringify(previous));args.push('--previous',old);}const r=spawnSync('dotnet',args,{encoding:'utf8',env:{...process.env,SEASONALITY_H4_SQL_CONNECTION:''}});assert.equal(r.status,expected?0:1,label+': '+r.stdout+r.stderr);}
check('initial',initial,true);check('reports',discovery,true,initial);
const after=wrap(F.init);after.state.lastRunAt=F.iso(F.t0+50000);after.state.simulations=copy(F.sim.simulations);after.state.events=copy(F.sim.events);check('separate-results',after,true,initial);
for(const [name,mutate]of [
 ['plan',s=>s.plan.minGroup=1],['started',s=>s.startedAt=F.iso(F.t0-1)],['implementation',s=>s.implementationSha256=F.hash('different')],
 ['frozen',s=>s.simulations[0].frozen.entry+=1],['outcome',s=>s.simulations[0].netR+=1],['removed',s=>s.simulations=[]],['events',s=>s.events=[]],['cursor',s=>s.simulations[0].lastProcessedStart=1]
]){const next=copy(after);mutate(next.state);check(name,next,false,after);}
const changedReport=copy(discovery);changedReport.state.report.checkpoints[0].candidateId='forged';check('public-report',changedReport,false,discovery);
const changedSaved=copy(discovery);changedSaved.state.checkpoints[0].candidateId='forged';check('saved-report',changedSaved,false,discovery);
const removed=copy(discovery);removed.state.checkpoints=[];removed.state.report.checkpoints=[];check('removed-checkpoint',removed,false,discovery);
console.log('PASS research SQL boundary: immutable plan/code/registrations/fills/outcomes/events/checkpoints, public report parity; validate-only never opens SQL.');
