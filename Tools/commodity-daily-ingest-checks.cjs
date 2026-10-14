// Isolated synthetic append tests. Never write to production state or historical evidence.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {ingest,supplementalEntries,loadSeries}=require('./market-daily-ingest.cjs');
const {restore}=require('./market-history-seed.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'commodity-daily-'));
restore(root);
const entries=supplementalEntries(),now=Date.parse('2026-10-16T12:00:00Z'),observed='2026-10-16T10:00:00Z';
const old=entries.map(e=>loadSeries(root,e,path.join(root,'daily-ingestion')).historical.bars.at(-1));
const bars=entries.map((e,i)=>({...old[i],symbol:e.logicalSymbol,provider:e.provider,providerSymbol:e.providerSymbol,sourceIdentity:e.sourceIdentity,timeframe:'1D',assetClass:'futures',timestamp:old[i].timestamp+86400,date:new Date((old[i].timestamp+86400)*1000).toISOString().slice(0,10),completed:true,status:'ok',sessionEnd:new Date((old[i].timestamp+86400+23*3600)*1000).toISOString()}));
const input=path.join(root,'commodity.json');
function run(b,options={}){fs.writeFileSync(input,JSON.stringify({schemaVersion:1,timeframe:'1D',fetchedAt:observed,bars:b}));return ingest({root,input,includeReview:true,now,...options});}
let r=run(bars);assert.equal(r.inserted,3,JSON.stringify(r));assert.equal(r.failed,0);
const overlay=path.join(root,'daily-ingestion'),bytes=entries.map(e=>fs.readFileSync(path.join(overlay,e.logicalSymbol+'.json')));
r=run(bars);assert.equal(r.skipped,3);assert.equal(r.inserted,0);
entries.forEach((e,i)=>assert.deepEqual(fs.readFileSync(path.join(overlay,e.logicalSymbol+'.json')),bytes[i]));
r=run([{...bars[0],close:bars[0].close+.25},bars[1]]);assert.equal(r.failed,1);assert.equal(r.skipped,1);assert.match(r.instruments[0].reason,/OHLC_CONFLICT/);
for(const changes of [{provider:'Yahoo'},{providerSymbol:'OANDA:WHEATUSD'},{sourceIdentity:'CBOT_TRADINGVIEW'},{date:'2026-10-15'},{completed:false},{close:bars[0].high+1}]){r=run([{...bars[0],...changes}]);assert.equal(r.failed,1,JSON.stringify(changes));}
const next={...bars[0],timestamp:bars[0].timestamp+86400,date:new Date((bars[0].timestamp+86400)*1000).toISOString().slice(0,10),sessionEnd:null};
r=run([next]);assert.equal(r.failed,1);assert.match(r.instruments[0].reason,/audit unavailable/);
r=run([{...next,sessionEnd:'2026-10-17T00:00:00Z'}]);assert.equal(r.failed,1);
// Documented completion must be tied to this provider bar and exact fetchedAt.
const auditDir=path.join(root,'audit');fs.mkdirSync(auditDir);
const audit={schemaVersion:1,runs:[{checkedAt:observed,sources:[{id:'session',url:'https://www.cmegroup.com/',finding:'Synthetic test of documented session evidence'},{id:'calendar',url:'https://www.cmegroup.com/tools-information/holiday-calendar.html',finding:'Synthetic test calendar evidence'}],entries:[{...next,method:'documented_session_and_bar_timestamp',reason:'Synthetic fixture only: documented session/calendar acceptance window elapsed',timezone:'America/Chicago',sourceIds:['session','calendar']}]}]};
fs.writeFileSync(path.join(auditDir,'2026-10-16.json'),JSON.stringify(audit));
r=run([next]);assert.equal(r.inserted,1,JSON.stringify(r));
r=run([next]);assert.equal(r.skipped,1);
// Independent documented evidence in the actual Work dialect can authorize NEW bars.
const newWorkBar={...next,timestamp:next.timestamp+86400,date:new Date((next.timestamp+86400)*1000).toISOString().slice(0,10),id:entries[0].id,canonicalIdentity:entries[0].id};
const workEntry={symbol:newWorkBar.symbol,provider:newWorkBar.provider,providerSymbol:newWorkBar.providerSymbol,canonicalIdentity:entries[0].id,selectedDate:newWorkBar.date,timestamp:newWorkBar.timestamp,completed:true,status:'ok',error:null,timezone:'America/Chicago',completionMethod:'documented_session_and_bar_timestamp',completionEvidence:'Synthetic independent exchange session and calendar evidence; no reliance on previously accepted historical OHLC',sourceEvidence:audit.runs[0].sources,rawResponse:{success:true,symbol:newWorkBar.providerSymbol,interval:'1D',bars:[{t:newWorkBar.timestamp,o:newWorkBar.open,h:newWorkBar.high,l:newWorkBar.low,c:newWorkBar.close}]}};
const workAudit={schemaVersion:1,runs:[{checkedAt:observed,entries:[workEntry]}]},auditPath=path.join(auditDir,'2026-10-16.json');
fs.writeFileSync(auditPath,JSON.stringify(workAudit));r=run([newWorkBar]);assert.equal(r.inserted,1,JSON.stringify(r));
const further={...newWorkBar,timestamp:newWorkBar.timestamp+86400,date:new Date((newWorkBar.timestamp+86400)*1000).toISOString().slice(0,10)};
const historyOnly=structuredClone(workAudit);Object.assign(historyOnly.runs[0].entries[0],{timestamp:further.timestamp,selectedDate:further.date,completionMethod:'documented_session_and_bar_timestamp_with_existing_validated_history'});
fs.writeFileSync(auditPath,JSON.stringify(historyOnly));r=run([further]);assert.equal(r.failed,1);assert.match(r.instruments[0].reason,/method\/reason/);
r=run([{...bars[1],canonicalIdentity:'wrong-source'}]);assert.equal(r.failed,1);assert.match(r.instruments[0].reason,/canonical identity/);
r=run([bars[1]],{researchOnly:true});assert.equal(r.skipped,1);
const registry=JSON.parse(fs.readFileSync(path.join(root,'test-source-registry.json'))),eur=registry.entries.find(e=>e.logicalSymbol==='EURUSD');
r=run([{...bars[0],symbol:'EURUSD',provider:eur.provider,providerSymbol:eur.providerSymbol}],{researchOnly:true});assert.equal(r.failed,1);assert.match(r.instruments[0].reason,/extension accepts only/);
for(const e of entries){const s=loadSeries(root,e,overlay);assert.equal(s.historical.status,'research-only');assert.equal(s.historical.htfEnabled,false);assert.equal(s.daily.productionActive,false);assert.ok(s.rows.length>s.historical.bars.length);}
// Restore persisted supplemental overlays using the same production bootstrap validation.
const seed=require('./market-history-seed.cjs'),state=path.join(root,'persisted-state'),restored=path.join(root,'restored');fs.mkdirSync(state);
for(const e of entries)fs.copyFileSync(path.join(overlay,e.logicalSymbol+'.json'),path.join(state,e.logicalSymbol+'.json'));
seed.restore(restored,{state});for(const e of entries)assert.deepEqual(loadSeries(restored,e,path.join(restored,'daily-ingestion')).rows,loadSeries(root,e,overlay).rows);
// Integration: prices include the overlay, repeated rebuild doesn't mutate persisted
// OHLC, and HTF/core scope remains unchanged. Captured old bars are duplicate fixtures.
const {prepare}=require('./prepare-market-sources.cjs');
const baseInput=path.join(root,'base.json');
const captured=entries.map((e,i)=>({...old[i],symbol:e.logicalSymbol,provider:e.provider,providerSymbol:e.providerSymbol,timeframe:'1D',assetClass:'futures',status:'ok',completed:true}));
fs.writeFileSync(baseInput,JSON.stringify({schemaVersion:1,timeframe:'1D',fetchedAt:new Date().toISOString(),bars:captured}));
let bundle=prepare({root,input:baseInput});assert.equal(bundle.ingestion.skipped,3);assert.equal(bundle.ingestion.failed,0);
for(const e of entries){const meta=bundle.entries.find(a=>a.assetKey===e.logicalSymbol),s=JSON.parse(fs.readFileSync(path.join(root,'analytics-sources-v1',meta.file)));assert.equal(meta.dailyStatus,'daily-connected');assert.equal(meta.dailySource,baseInput);assert.equal(meta.id,e.id);assert.equal(meta.status,'research-only');assert.equal(meta.htfEnabled,false);assert.deepEqual(s.htfBars,[]);const stored=loadSeries(root,e,overlay);assert.equal(s.prices.at(-1)[1],stored.rows.at(-1).close);assert.equal(s.prices.at(-1)[0],stored.rows.at(-1).date);}
const persisted=entries.map(e=>fs.readFileSync(path.join(overlay,e.logicalSymbol+'.json')));prepare({root,input:baseInput});entries.forEach((e,i)=>assert.deepEqual(fs.readFileSync(path.join(overlay,e.logicalSymbol+'.json')),persisted[i]));
fs.writeFileSync(baseInput,JSON.stringify({schemaVersion:1,timeframe:'1D',fetchedAt:new Date().toISOString(),bars:[{...captured[0],provider:'Yahoo'},...captured.slice(1)]}));bundle=prepare({root,input:baseInput});assert.equal(bundle.ingestion.failed,1);assert.equal(bundle.entries.find(a=>a.assetKey===entries[0].logicalSymbol).dailyStatus,'daily-error');assert.equal(bundle.entries.find(a=>a.assetKey===entries[1].logicalSymbol).dailyStatus,'daily-connected');
console.log('PASS: three exact research identities, append/idempotency, conflict isolation, no provider splice, completion evidence, research restriction; synthetic fixtures only.');
