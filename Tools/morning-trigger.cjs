// Immediate data-arrival trigger + successful-input deduplication (Prague day).
const fs=require('node:fs'),crypto=require('node:crypto');
const parts=now=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(now);
function gate({event,now=new Date(),input='data/market-daily/latest.json',health='artifacts/daily-health/latest.json',force=false}={}){
 const local=parts(now),today=local.slice(0,10);
 if(event==='schedule' && local.slice(11,19)<'03:00:00')return {run:false,reason:'Before normal Work collection window (03:00 Europe/Prague)'};
 if(!['push','schedule','workflow_dispatch'].includes(event))return {run:false,reason:'Unsupported event'};
 const bytes=fs.readFileSync(input),p=JSON.parse(bytes),inputSha256=crypto.createHash('sha256').update(bytes).digest('hex');
 if(p.schemaVersion!==1||p.timeframe!=='1D'||!Array.isArray(p.bars))throw Error('Invalid daily input');
 const t=new Date(p.fetchedAt||p.generatedAt);if(!Number.isFinite(+t)||+t>+now||parts(t).slice(0,10)!==today)throw Error('No current Prague-day Work collection; refusing stale run');
 const h=fs.existsSync(health)?JSON.parse(fs.readFileSync(health)):null;
 if(!force&&h?.runDate===today&&h.published===true&&h.status!=='failed'&&h.market?.failed===0&&h.market?.inputSha256===inputSha256)return {run:false,reason:'This collection already published successfully today',inputSha256};
 return {run:true,reason:'Fresh Work collection ready; no successful publication of this input today',inputSha256};
}
module.exports={parts,gate};
if(require.main===module)(async()=>{
 const r=gate({event:process.env.EVENT_NAME,force:process.env.FORCE_RUN==='true'});
 if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,'run='+r.run+'\n');
 if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,'## Morning trigger\n\n'+r.reason+'\n');console.log(JSON.stringify(r));
})().catch(e=>{if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,'## Morning trigger failed\n\n'+e.message+'\n');console.error(e.message);process.exitCode=1;});
