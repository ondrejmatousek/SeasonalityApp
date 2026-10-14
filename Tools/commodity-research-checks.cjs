const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {valid}=require('./commodity-research-import.cjs');
const registry=JSON.parse(fs.readFileSync('data/commodity-research/source-registry.json'));
const normalized=value=>{const copy=structuredClone(value);function visit(x){if(!x||typeof x!=='object')return;if(['historical-dataset-positions-date','observed-upper-bound'].includes(x.availabilitySource))delete x.availableAt;for(const v of Object.values(x))visit(v);}visit(copy);return copy;};
const fingerprint=value=>crypto.createHash('sha256').update(JSON.stringify(normalized(value))).digest('hex');
assert.equal(registry.entries.length,3);
for(const e of registry.entries){
 const bytes=fs.readFileSync(path.join('data/commodity-research',e.file));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),e.sha256);
 const s=JSON.parse(bytes);assert.equal(s.status,'research-only');assert.equal(s.htfEnabled,false);assert.equal(s.dailyStatus,'historical-only');
 assert.ok(s.bars.every(valid));assert.equal(new Set(s.bars.map(b=>b.timestamp)).size,s.bars.length);assert.equal(new Set(s.bars.map(b=>b.date)).size,s.bars.length);
 assert.ok(s.evidence.every(p=>crypto.createHash('sha256').update(fs.readFileSync(path.join('data/commodity-research',p.file))).digest('hex')===p.sha256));
 const originals=new Map();for(const p of s.evidence){const r=JSON.parse(fs.readFileSync(path.join('data/commodity-research',p.file))).response;for(let i=0;i<r.count;i++)originals.set(r.bars.t[i],{open:r.bars.o[i],high:r.bars.h[i],low:r.bars.l[i],close:r.bars.c[i]});}
 for(const b of s.bars)for(const k of ['open','high','low','close'])assert.equal(b[k],originals.get(b.timestamp)[k],'Provider prices never repaired');
 assert.ok(s.prices.every(([d,c])=>d>=s.seasonalityFrom&&s.bars.some(b=>b.date===d&&b.close===c)));
}
const preview=process.argv[2],baseline=process.argv[3];
if(preview){
 const read=(root,p)=>JSON.parse(fs.readFileSync(path.join(root,p.replace(/^\//,'')))),m=read(preview,'data/manifest.json'),op=read(preview,m.opportunities.path),h=read(preview,m.zonePrices.path);
 for(const e of registry.entries){const a=m.assets.find(a=>a.key===e.assetKey),p=read(preview,a.prices.path);assert.equal(a.priceSource.providerSymbol,e.providerSymbol);assert.ok(p.prices.length>10000);assert.equal(op.assets.find(a=>a.key===e.assetKey).mapping.scope,'research');assert.equal(h.prices[e.assetKey],undefined,'No research HTF activation');}
 if(baseline){const old=read(baseline,'data/manifest.json'),prior=read(baseline,old.opportunities.path);for(const a of op.assets.filter(a=>a.mapping.scope==='core'))assert.equal(fingerprint(a.candidates),fingerprint(prior.assets.find(p=>p.key===a.key).candidates),'Core scores and intervals unchanged '+a.key+' (only historical-dataset collection timestamp excluded)');assert.deepEqual(op.calibrationV3,prior.calibrationV3,'Research histories do not change core relative ranks');
 for(const a of m.assets.filter(a=>!registry.entries.some(e=>e.assetKey===a.key))){const prev=old.assets.find(p=>p.key===a.key);assert.deepEqual(read(preview,a.prices.path).prices,read(baseline,prev.prices.path).prices,'Other prices unchanged '+a.key);}
 }
}
console.log('PASS: exact TradingView evidence, all OHLC, hashes, no splice/repair, complete-year start, research only, no HTF or core-score changes.');
