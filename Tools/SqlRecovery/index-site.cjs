// Windows checkout contains both tracked Data/ and data/ paths. Preserve the
// lowercase publication paths in Git; do not introduce a Linux-only case split.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve('data/generated/site');function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const files=walk(root),hashes=execFileSync('git',['hash-object','-w','--no-filters','--stdin-paths'],{input:files.map(f=>f.split(path.sep).join('/')).join('\n')+'\n',encoding:'utf8'}).trim().split('\n');if(hashes.length!==files.length)throw Error('Hash count mismatch');
const index=files.map((file,i)=>{const relative='data/generated/site/'+path.relative(root,file).split(path.sep).join('/');return '100644 '+hashes[i]+'\t'+relative+'\n';}).join('');
execFileSync('git',['update-index','--index-info'],{input:index,encoding:'utf8'});console.log(JSON.stringify({indexedPublicFiles:files.length,canonicalCase:'data/generated/site'}));
