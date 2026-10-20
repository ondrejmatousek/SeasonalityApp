const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto'),E=require('../wwwroot/js/h4-paper.js');
const [rootArg,previousFile,nextFile]=process.argv.slice(2),root=path.resolve(rootArg),hash=s=>createHash('sha256').update(s).digest('hex'),manifest=JSON.parse(fs.readFileSync(path.join(root,'data/manifest.json'))),p=manifest.zonePrices.path;
if(!/^\/data\/screener\/zone-prices\.[a-f0-9]{20}\.json$/.test(p))throw Error('Unexpected paper source path.');
const snapshot=JSON.parse(fs.readFileSync(root+p)),previous=JSON.parse(fs.readFileSync(previousFile)),now=new Date().toISOString();
const state=E.update(previous.state,{...snapshot,path:p,revision:hash(fs.readFileSync(root+p))},now,hash);
fs.mkdirSync(path.dirname(path.resolve(nextFile)),{recursive:true});fs.writeFileSync(nextFile,JSON.stringify({expectedRevision:previous.revision,state}));
console.log(JSON.stringify({model:E.model,previousRevision:previous.revision,setups:state.setups.length,events:state.events.length,summary:E.summary(state.setups),diagnostics:state.diagnostics.length}));
