// Immutable, checksum-pinned accepted backfill; no provider requests or price repair.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const root='artifacts/tradingview-backfill-36-v1',seed='data/market-history/tradingview-backfill-36-v1.json.gz';
function pack(){
 const registry=JSON.parse(fs.readFileSync(path.join(root,'test-source-registry.json'))),files={};
 for(const name of ['test-source-registry.json',...registry.entries.map(e=>e.seasonalitySource)])files[name]=fs.readFileSync(path.join(root,name),'utf8');
 const bytes=zlib.gzipSync(JSON.stringify({schemaVersion:1,files}),{level:9});fs.mkdirSync(path.dirname(seed),{recursive:true});fs.writeFileSync(seed,bytes);
 fs.writeFileSync(seed+'.sha256',hash(bytes)+'\n');console.log(JSON.stringify({seed,bytes:bytes.length,files:Object.keys(files).length,sha256:hash(bytes)}));
}
function restore(target=root,{state='data/market-state'}={}){
 const bytes=fs.readFileSync(seed);if(hash(bytes)!==fs.readFileSync(seed+'.sha256','utf8').trim())throw Error('Historical seed checksum mismatch');
 const payload=JSON.parse(zlib.gunzipSync(bytes));if(payload.schemaVersion!==1)throw Error('Unknown seed schema');
 const registry=JSON.parse(payload.files['test-source-registry.json']);
 const allowed=new Set(['test-source-registry.json',...registry.entries.map(e=>e.seasonalitySource)]);
 if(allowed.size!==37||Object.keys(payload.files).length!==37)throw Error('Seed must contain the audited 36 series');
 for(const [name,body]of Object.entries(payload.files)){
  const f=path.resolve(target,name);if(!allowed.has(name)||!f.startsWith(path.resolve(target)+path.sep))throw Error('Unsafe seed path');
  if(fs.existsSync(f)&&fs.readFileSync(f,'utf8')!==body)throw Error('Refusing to replace different historical seed '+name);
  fs.mkdirSync(path.dirname(f),{recursive:true});if(!fs.existsSync(f))fs.writeFileSync(f,body,{flag:'wx'});
 }
 // Only cumulative overlays are mutable, and loadSeries verifies their identities/checksums.
 const supplemental=require('./market-daily-ingest.cjs').supplementalEntries();
 if(fs.existsSync(state))for(const name of fs.readdirSync(state)){
  if(!/^[A-Z]+\.json$/.test(name)||![...registry.entries,...supplemental].some(e=>name===e.logicalSymbol+'.json'))throw Error('Unknown market-state file');
  const dest=path.join(target,'daily-ingestion',name);fs.mkdirSync(path.dirname(dest),{recursive:true});
  const incoming=fs.readFileSync(path.join(state,name));if(fs.existsSync(dest)&&!incoming.equals(fs.readFileSync(dest)))throw Error('Existing working overlay differs from committed state');
  fs.writeFileSync(dest,incoming);
  const e=[...registry.entries,...supplemental].find(e=>name===e.logicalSymbol+'.json');
  require('./market-daily-ingest.cjs').loadSeries(target,e,path.join(target,'daily-ingestion'));
 }
 return registry;
}
module.exports={pack,restore,root};
if(require.main===module){try{process.argv.includes('--pack')?pack():restore();}catch(e){console.error(e.message);process.exitCode=1;}}
