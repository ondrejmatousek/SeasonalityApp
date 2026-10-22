// Stage a verified generated base. Preserve every previous output in artifacts.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const source=path.resolve('artifacts/sql-recovered-base'),target=path.resolve('data/generated/site'),backup=path.resolve('artifacts/sql-recovery-previous-site');
assert.ok(fs.existsSync(path.join(source,'data/manifest.json'))&&!fs.existsSync(backup));
const m=JSON.parse(fs.readFileSync(path.join(source,'data/manifest.json')));assert.equal(m.assets.find(a=>a.key==='AAPL').prices.lastDate,'2026-10-21');assert.equal(m.zonePrices.h4,undefined,'Commit the base only; H4 is SQL-exported by hosting');
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
for(const file of walk(target)){const relative=path.relative(target,file),saved=path.resolve(backup,relative);assert.ok(saved.startsWith(backup+path.sep));fs.mkdirSync(path.dirname(saved),{recursive:true});fs.renameSync(file,saved);}
const files=walk(source);for(const file of files){const dest=path.resolve(target,path.relative(source,file));assert.ok(dest.startsWith(target+path.sep));fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(file,dest);}
console.log(JSON.stringify({staged:files.length,previousOutputsPreserved:backup}));
