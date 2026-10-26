const fs=require('node:fs'),path=require('node:path');
const [input,output]=process.argv.slice(2);fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});
const envelope=input==='--unavailable'?null:JSON.parse(fs.readFileSync(input,'utf8'));
const report=envelope?.state?.report;
if(input!=='--unavailable'&&!report?.ready)throw Error('Research report missing; do not fabricate a reset');
fs.writeFileSync(output,JSON.stringify(report?{...report,researchRevision:envelope.revision,implementationSha256:envelope.state.implementationSha256,audit:{baselinePath:'/data/h4-paper/ledger.json',simulations:envelope.state.simulations,events:envelope.state.events}}:{schemaVersion:1,ready:false,reason:'RESEARCH_UNAVAILABLE',baselineUnaffected:true}));
