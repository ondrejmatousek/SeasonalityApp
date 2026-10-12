// Called only AFTER checks. Failed runs publish health only, never analytics/state.
const fs=require('node:fs'),path=require('node:path'),{write}=require('./daily-health.cjs');
function publish({site='artifacts/morning-site',healthDir='artifacts/daily-health',destination='data/generated/site',state='data/market-state',root='artifacts/tradingview-backfill-36-v1'}={}){
 const allowed=path.resolve('data/generated')+path.sep;
 if(!path.resolve(destination).startsWith(allowed)||path.resolve(destination)===path.resolve('data/generated'))throw Error('Publication target must be a specific subtree of data/generated');
 if(fs.existsSync(destination+'.previous'))throw Error('Previous publication backup exists; refusing overwrite');
 const h=JSON.parse(fs.readFileSync(path.join(healthDir,'latest.json')));
 if(h.mode==='safe-rehearsal')throw Error('Safe rehearsal cannot publish');
 if(h.status==='failed'||!h.eligibleForPublication)return {published:false,healthOnly:true};
 const m=JSON.parse(fs.readFileSync(path.join(site,'data/manifest.json'))),files=new Set(['index.html','staticwebapp.config.json','data/manifest.json']);
 for(const a of m.assets)files.add(a.prices.path.replace(/^\//,''));
 for(const c of Object.values(m.contracts))for(const p of Object.values(c.files))files.add(p.replace(/^\//,''));
 for(const key of ['screener','opportunities','htfConfluence','v3LiveTracking'])if(m[key]?.path)files.add(m[key].path.replace(/^\//,''));
 if(fs.existsSync(path.join(site,'data/screener/v3-live-ledger.json')))files.add('data/screener/v3-live-ledger.json');
 // Stage all bytes in a fresh tree first; don't touch last good committed outputs on validation failure.
 const staging=destination+'.staging';if(fs.existsSync(staging))throw Error('Publication staging already exists');fs.mkdirSync(staging,{recursive:true});
 for(const name of files){const src=path.resolve(site,name),dest=path.resolve(staging,name);
  if(!src.startsWith(path.resolve(site)+path.sep)||!dest.startsWith(path.resolve(staging)+path.sep))throw Error('Unsafe publication path');
  fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(src,dest);
 }
 // Destination is precisely the generated site subtree, never repository/workspace root.
 if(fs.existsSync(destination))fs.renameSync(destination,destination+'.previous');
 fs.renameSync(staging,destination);
 if(fs.existsSync(destination+'.previous'))fs.rmSync(path.resolve(destination+'.previous'),{recursive:true});
 fs.mkdirSync(state,{recursive:true});const overlays=path.join(root,'daily-ingestion');
 for(const name of fs.readdirSync(overlays))if(/^[A-Z]+\.json$/.test(name))fs.copyFileSync(path.join(overlays,name),path.join(state,name));
 h.published=true;h.publication='Generated files prepared for commit; hosting remains separate';write(healthDir,h);
 return {published:true,files:files.size};
}
module.exports={publish};
if(require.main===module){try{console.log(JSON.stringify(publish()));}catch(e){console.error(e.message);process.exitCode=1;}}
