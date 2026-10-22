// Move obsolete content-addressed generated JSON outside the publication tree.
// Current manifest references (including nested JSON references) always win.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
function prune(site,backup){
 site=path.resolve(site);backup=path.resolve(backup);const artifacts=path.resolve('artifacts')+path.sep;
 assert.ok(site.startsWith(artifacts)&&backup.startsWith(artifacts)&&!backup.startsWith(site+path.sep)&&backup!==site,'Use isolated artifact paths');
 const live=new Set(['/data/manifest.json']),queue=['/data/manifest.json'];
 function references(v){if(typeof v==='string'&&v.startsWith('/data/')&&v.endsWith('.json')&&!v.includes('..')&&!live.has(v)){live.add(v);queue.push(v);}else if(Array.isArray(v))v.forEach(references);else if(v&&typeof v==='object')Object.values(v).forEach(references);}
 while(queue.length){const url=queue.shift(),file=path.resolve(site,'.'+url);assert.ok(file.startsWith(site+path.sep));if(fs.existsSync(file))references(JSON.parse(fs.readFileSync(file,'utf8')));}
 const moved=[];function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isDirectory())walk(file);else if(/\.[a-f0-9]{20}\.json$/.test(e.name)){const relative=path.relative(site,file),url='/'+relative.split(path.sep).join('/');if(!live.has(url)){const target=path.resolve(backup,relative);assert.ok(target.startsWith(backup+path.sep));assert.ok(!fs.existsSync(target),'Backup collision');fs.mkdirSync(path.dirname(target),{recursive:true});const bytes=fs.statSync(file).size;fs.renameSync(file,target);moved.push({path:url,bytes});}}}}
 walk(path.join(site,'data'));return {moved:moved.length,bytes:moved.reduce((n,f)=>n+f.bytes,0),recoverableAt:backup};
}
module.exports={prune};if(require.main===module)console.log(JSON.stringify(prune(process.argv[2],process.argv[3])));
