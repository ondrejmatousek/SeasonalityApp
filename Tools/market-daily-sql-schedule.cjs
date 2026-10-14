// Cheap repository-pointer gate, no SQL/provider calls. Avoid keeping free/serverless SQL awake after daily publication.
const fs=require('node:fs');
function gate({event,mode='',now=new Date(),published=null}={}){
 if(event==='workflow_dispatch')return {run:true,reason:'Explicit manual SQL check'};
 if(event!=='schedule'||!['','shadow','publish'].includes(mode))return {run:false,reason:'SQL scheduling disabled'};
 const local=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).format(now);
 if(Number(local.slice(11,13))<3)return {run:false,reason:'Before 03:00 Europe/Prague collection window'};
 if(mode==='publish'&&published?.runDate===local.slice(0,10)&&Number.isSafeInteger(published.generationId)&&published.generationId>0&&/^[a-f0-9]{64}$/.test(published.stateSha256))
  return {run:false,reason:'Today SQL generation already committed; no additional SQL wake-up. Manual runs check corrections.'};
 return {run:true,reason:'Awaiting daily accepted SQL generation/publication'};
}
module.exports={gate};
if(require.main===module){
 const manifest='data/generated/site/data/manifest.json';
 const published=fs.existsSync(manifest)?JSON.parse(fs.readFileSync(manifest)).marketDailySql:null;
 const result=gate({event:process.env.EVENT_NAME,mode:process.env.SQL_MODE||'',published});
 if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,'run='+result.run+'\n');
 if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,result.reason+'\n');
 console.log(JSON.stringify(result));
}
