const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const F=require('../wwwroot/js/h4-history-format.js');
const root=process.argv[2],read=p=>JSON.parse(fs.readFileSync(path.join(root,p))),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const m=read('data/manifest.json'),z=read(m.zonePrices.path.slice(1)),index=read(m.backtestHistory.path.slice(1));
assert.equal(m.dukascopy.provider,'Dukascopy');assert.equal(m.dukascopy.priceSide,'BID');
assert.equal(m.backtestHistory.provider,'Dukascopy');assert.equal(z.h4.provider,'Dukascopy');
const active=Object.entries(z.prices).filter(([,p])=>p.h4?.status==='ready');assert.equal(active.length,49);
assert.equal(Object.keys(index.prices).length,49);let count=0;
for(const [key,p] of active){
 assert.equal(p.h4.provider,'Dukascopy');assert.ok(p.h4.symbol.startsWith('DUKASCOPY:'));
 const entry=index.prices[key].h4,raw=fs.readFileSync(path.join(root,entry.historyPath.slice(1))),h=F.decode(JSON.parse(raw));
 assert.equal(sha(raw),entry.sha256);assert.equal(h.provider,'Dukascopy');assert.equal(h.symbol,p.h4.symbol);
 assert.equal(h.bars.length,entry.count);assert.ok(h.bars.length>=100);
 assert.deepEqual(h.bars.slice(-p.h4.bars.length),p.h4.bars,'Live and backtest must use identical candles');
 assert.equal(new Set(h.bars.map(b=>b.timestamp)).size,h.bars.length);
 for(let i=1;i<h.bars.length;i++)assert.ok(h.bars[i].timestamp>h.bars[i-1].timestamp);
 count+=h.bars.length;
}
assert.equal(count,m.backtestHistory.bars);
console.log(JSON.stringify({checks:'PASS single Dukascopy H4 provider, 49 instruments, source identity, SHA256, unique chronological bars and exact live/backtest parity',bars:count}));
