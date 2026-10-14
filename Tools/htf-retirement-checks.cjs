const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {migrate}=require('./retire-htf-snapshot.cjs');
const removed=['wwwroot/js/htf-zones.js','wwwroot/js/htf-ui.js','wwwroot/js/htf-chart.js','wwwroot/css/htf.css','Tools/build-htf-confluence.cjs','Tools/htf-checks.cjs','Tools/htf-export-checks.cjs','Tools/htf-browser-checks.cjs','Tools/fetch-htf-ohlc.ps1'];
for(const file of removed)assert.equal(fs.existsSync(file),false,'Retired file '+file);
const view=fs.readFileSync('Views/Seasonality/Index.cshtml','utf8');assert.ok(!view.includes('market-tab-htf')&&!view.includes('market-htf-view'));assert.ok(view.includes('market-tab-zones'));
assert.ok(!fs.readFileSync('Tools/morning-analytics.cjs','utf8').includes('build-htf-confluence'));assert.ok(fs.readFileSync('Tools/morning-analytics.cjs','utf8').includes('build-zone-prices'));
const root=path.resolve('artifacts/htf-retirement-test-'+crypto.randomBytes(8).toString('hex'));fs.mkdirSync(path.join(root,'data/screener'),{recursive:true});
try{
 const old={schemaVersion:1,asOf:'2026-10-14',builtAt:'2026-10-14T01:00:00Z',prices:{TEST:{status:'ready',bars:[{date:'2026-10-13',open:1,high:2,low:.5,close:1.5,volume:42}],weekly:[],zones:[{id:'retired'}]}},assets:[{key:'TEST',mapping:{scope:'research'},matches:[{id:'old'}]}]};
 const prior='/data/screener/htf-confluence.'+'a'.repeat(20)+'.json',m={schemaVersion:1,exportedAt:'2026-10-14T02:00:00Z',htfConfluence:{path:prior},marketDailySql:{receiptId:'unchanged'}};
 fs.writeFileSync(path.join(root,prior.slice(1)),JSON.stringify(old));fs.writeFileSync(path.join(root,'data/manifest.json'),JSON.stringify(m));fs.writeFileSync(path.join(root,'index.html'),'<script id="static-market-manifest" type="application/json">'+JSON.stringify(m)+'</script>');
 const result=migrate(root),next=JSON.parse(fs.readFileSync(path.join(root,'data/manifest.json'))),payload=JSON.parse(fs.readFileSync(path.join(root,result.path.slice(1))));
 assert.equal(result.removed,1);assert.ok(!next.htfConfluence);assert.equal(payload.asOf,old.asOf);assert.equal(payload.builtAt,old.builtAt);assert.equal(next.exportedAt,m.exportedAt);assert.deepEqual(next.marketDailySql,m.marketDailySql);assert.deepEqual(payload.prices.TEST.bars,old.prices.TEST.bars);assert.ok(!payload.prices.TEST.zones&&!payload.assets[0].matches);assert.equal(migrate(root).changed,false);assert.throws(()=>migrate('.'),/requires/);
 console.log('PASS: retired tab/engine/assets/builders removed; derived-only migration preserves exact OHLC, volume, dates, freshness and SQL receipt; idempotent and bounded paths.');
}finally{if(!root.startsWith(path.resolve('artifacts')+path.sep))throw Error('Unsafe owned test cleanup');fs.rmSync(root,{recursive:true});}
