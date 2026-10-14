// One-way migration of DERIVED snapshots only. Never touches SQL/raw prices or freshness.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function migrate(directory){
 const dir=path.resolve(directory),repo=path.resolve('.');
 if(dir!==path.join(repo,'data/generated/site')&&!dir.startsWith(path.join(repo,'artifacts')+path.sep))throw Error('Migration requires generated site or private artifacts subtree');
 const file=path.join(dir,'data/manifest.json'),m=JSON.parse(fs.readFileSync(file));let changed=false;
 if(m.htfConfluence){
  if(!/^\/data\/screener\/htf-confluence\.[a-f0-9]{20}\.json$/.test(m.htfConfluence.path))throw Error('Unsafe retired derived snapshot path');
  const old=JSON.parse(fs.readFileSync(path.join(dir,m.htfConfluence.path.slice(1))));
  const prices=Object.fromEntries(Object.entries(old.prices).map(([key,{zones,...p}])=>[key,p]));
  const payload={schemaVersion:1,modelVersion:'zone-price-snapshot-v1',asOf:old.asOf,builtAt:old.builtAt,prices,assets:old.assets.map(({matches,...a})=>a)};
  const bytes=JSON.stringify(payload),hash=crypto.createHash('sha256').update(bytes).digest('hex').slice(0,20),url='/data/screener/zone-prices.'+hash+'.json',target=path.join(dir,url.slice(1));
  if(fs.existsSync(target)){if(fs.readFileSync(target,'utf8')!==bytes)throw Error('Derived hash collision');}else fs.writeFileSync(target,bytes,{flag:'wx'});
  m.zonePrices={path:url,asOf:payload.asOf,modelVersion:payload.modelVersion};delete m.htfConfluence;
  require('./apply-market-sources.cjs').saveManifest(dir,m);changed=true;
 }
 // Remove only explicitly retired hashed calculation files in this validated output subtree.
 const folder=path.join(dir,'data/screener');let removed=0;
 for(const name of fs.readdirSync(folder))if(/^htf-confluence\.[a-f0-9]{20}\.json$/.test(name)){fs.unlinkSync(path.join(folder,name));removed++;}
 for(const relative of ['js/htf-ui.js','js/htf-chart.js','js/htf-zones.js','css/htf.css']){const old=path.join(dir,relative);if(fs.existsSync(old)){fs.unlinkSync(old);removed++;}}
 return {changed,removed,path:m.zonePrices?.path};
}
module.exports={migrate};if(require.main===module)console.log(JSON.stringify(migrate(process.argv[2])));
