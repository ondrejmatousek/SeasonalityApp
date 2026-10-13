const fs=require('node:fs'),path=require('node:path'),health=require('./daily-health.cjs');
const dir='artifacts/daily-health',file=path.join(dir,'latest.json');
let h=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):health.create();
// The prior day's committed report must not mask a build/restore failure today.
if(h.sourceCommit!==(process.env.SOURCE_COMMIT||process.env.GITHUB_SHA)||h.status==='running')h=health.create();
if(process.env.JOB_STATUS!=='success'||process.env.PUBLISH_OUTCOME!=='success'){
 const error='Morning workflow failed: '+(process.env.FAILURE_STAGE||'see failed Actions step')+'; last good analytics retained.';
 if(!h.errors.includes(error))h.errors.push(error);
 h.eligibleForPublication=false;h.published=false;
}
health.finish(h);health.write(dir,h);
if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,health.summary(h));
