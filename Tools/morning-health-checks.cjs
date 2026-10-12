const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const health=require('./daily-health.cjs'),ui=require('../wwwroot/js/daily-health-status.js');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'seasonality-health-'));
for(const [date,cron]of [['2026-01-12T05:00:00Z','0 5 * * *'],['2026-07-12T04:00:00Z','0 4 * * *'],['2026-03-29T04:00:00Z','0 4 * * *'],['2026-10-25T05:00:00Z','0 5 * * *']]){
 assert.equal(health.scheduleGate(cron,new Date(date)),true);
 assert.equal(health.scheduleGate(cron==='0 4 * * *'?'0 5 * * *':'0 4 * * *',new Date(date)),false);
 assert.equal(health.scheduleGate(cron,new Date(Date.parse(date)+95*60000)),true,'Late job must still select the correct seasonal cron');
}
assert.equal(health.scheduleGate(undefined,new Date(),true),true);
const input=path.join(temp,'input.json'),at='2026-10-12T01:00:00Z';fs.writeFileSync(input,JSON.stringify({schemaVersion:1,timeframe:'1D',fetchedAt:at,bars:[]}));
assert.equal(health.marketFreshness(input,new Date('2026-10-12T04:00:00Z')),at);
assert.throws(()=>health.marketFreshness(input,new Date('2026-10-13T04:00:00Z')),/24 hours/);
assert.throws(()=>health.marketFreshness(input,new Date('2026-10-11T04:00:00Z')),/future/);
const registry={entries:[{logicalSymbol:'EURUSD',assetClass:'forex'},{logicalSymbol:'NDX',assetClass:'index'},{logicalSymbol:'WTI',assetClass:'commodity'}]};
const report={instruments:[{symbol:'EURUSD',received:1,failed:0},{symbol:'NDX',received:1,failed:0},{symbol:'WTI',received:1,failed:1,reason:'OHLC conflict'}]};
assert.deepEqual(health.ingestionGate(report,registry).errors,[]);assert.equal(health.ingestionGate(report,registry).warnings.length,1);
report.instruments[0].failed=1;report.instruments[0].reason='OHLC conflict';assert.equal(health.ingestionGate(report,registry).errors.length,1);
report.instruments.shift();assert.match(health.ingestionGate(report,registry).errors.join(),/missing daily instrument/);
report.providerSplice=true;assert.match(health.ingestionGate(report,registry).errors.join(),/splice/);
for(let i=1;i<=9;i++){const h=health.create(new Date(`2026-10-${String(i).padStart(2,'0')}T04:00:00Z`),'test');health.finish(h,new Date(`2026-10-${String(i).padStart(2,'0')}T04:01:00Z`));health.write(temp,h);}
assert.equal(JSON.parse(fs.readFileSync(path.join(temp,'history.json'))).runs.length,7);
const h=JSON.parse(fs.readFileSync(path.join(temp,'latest.json')));assert.equal(h.durationSeconds,60);
assert.equal(ui.displayState(h,Date.parse(h.runFinishedAt)), 'ok');assert.equal(ui.displayState(h,Date.parse(h.staleAfter)+1),'failed');
assert.equal(ui.displayState({...h,status:'warning'},Date.parse(h.runFinishedAt)), 'warning');assert.equal(ui.displayState({...h,status:'failed'},Date.parse(h.runFinishedAt)), 'failed');assert.equal(ui.displayState(null),'failed');
const publish=require('./publish-morning-data.cjs').publish;
assert.throws(()=>publish({destination:'.'}),/specific subtree/);
h.mode='live';h.status='failed';h.eligibleForPublication=false;health.write(temp,h);
assert.deepEqual(publish({healthDir:temp,destination:'data/generated/test-health-only'}),{published:false,healthOnly:true});assert.equal(fs.existsSync('data/generated/test-health-only'),false);
// Exercise the real critical routing gate with isolated minimal static files.
const site=path.join(temp,'site');fs.mkdirSync(path.join(site,'data'),{recursive:true});
const identity={AAPL:['Yahoo',null],EURUSD:['OANDA','OANDA:EURUSD'],NDX:['NASDAQ','NASDAQ:NDX'],SPX:['S&P','SP:SPX'],XAUUSD:['OANDA','OANDA:XAUUSD'],WTI:['NYMEX','NYMEX:CL1!']};
const assets=Object.entries(identity).map(([key,[provider,providerSymbol]])=>({key,assetClass:key==='AAPL'?'equity':key==='EURUSD'?'forex':['NDX','SPX'].includes(key)?'index':'commodity',stockProviders:key==='AAPL'?['Yahoo']:null,
 prices:{path:'/data/'+key+'.json',count:1,lastDate:'2026-10-09'},priceSource:{provider,providerSymbol,id:key==='AAPL'?null:'source:'+key,sourceIdentity:key==='AAPL'?'existing-stock-sql':'test:'+key}}));
const manifest={assets,stockSnapshotAt:'2026-10-12T04:00:00Z',opportunities:{path:'/data/op.json'},htfConfluence:{path:'/data/htf.json'},contracts:{test:{lastDate:'2026-10-06'}}};
const writeFixtures=()=>{fs.writeFileSync(path.join(site,'data/manifest.json'),JSON.stringify(manifest));for(const a of assets)fs.writeFileSync(path.join(site,a.prices.path),JSON.stringify({priceSource:a.priceSource,prices:[['2026-10-09',1]]}));};
fs.writeFileSync(path.join(site,'data/op.json'),JSON.stringify({assets:[{key:'EURUSD',mapping:{scope:'core',priceKey:'EURUSD'},candidates:[{}]}]}));
fs.writeFileSync(path.join(site,'data/htf.json'),JSON.stringify({prices:Object.fromEntries(assets.map(a=>[a.key,{status:'ready',zones:[],priceSeriesId:a.priceSource.id}]))}));
writeFixtures();const check=()=>{const r=health.create(new Date('2026-10-12T04:01:00Z'));r.mode='live';r.stocks.status='ok';r.cot.status='ok';return health.checkOutputs(site,r,new Date('2026-10-12T04:01:00Z'));};assert.doesNotThrow(check);
for(const [key,field,bad]of [['EURUSD','provider','Yahoo'],['NDX','providerSymbol','OANDA:NAS100USD'],['SPX','providerSymbol','OANDA:SPX500USD']]){const a=assets.find(a=>a.key===key),old=a.priceSource[field];a.priceSource[field]=bad;writeFixtures();assert.throws(check,/routing failed/);a.priceSource[field]=old;}
assets[0].stockProviders=['Stooq'];writeFixtures();assert.throws(check,/Yahoo stock SQL/);assets[0].stockProviders=['Yahoo'];writeFixtures();
fs.writeFileSync(path.join(site,'data/EURUSD.json'),JSON.stringify({priceSource:{...assets[1].priceSource,provider:'Yahoo'}}));assert.throws(check,/splice/);
const workflow=fs.readFileSync('.github/workflows/seasonality-update.yml','utf8');assert.ok(!/deploy@|web-apps-deploy/.test(workflow));assert.match(workflow,/git add -f artifacts\/daily-health/);assert.match(workflow,/if: always\(\)/);
console.log('PASS: DST/late scheduling, JSON freshness, critical versus research failures, missing core symbols, provider splice gate, 7-run history, saved-report staleness and fail-safe publication.');
