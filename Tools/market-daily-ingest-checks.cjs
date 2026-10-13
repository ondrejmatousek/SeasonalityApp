const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {ingest,validateBar,auditCompletion}=require('./market-daily-ingest.cjs');
const source=path.resolve('artifacts/tradingview-backfill-36-v1'),root=fs.mkdtempSync(path.join(os.tmpdir(),'seasonality-daily-ingest-'));
const registry=JSON.parse(fs.readFileSync(path.join(source,'test-source-registry.json'),'utf8'));
fs.copyFileSync(path.join(source,'test-source-registry.json'),path.join(root,'test-source-registry.json'));
for(const e of registry.entries){const f=path.join(root,e.seasonalitySource);fs.mkdirSync(path.dirname(f),{recursive:true});fs.copyFileSync(path.join(source,e.seasonalitySource),f);}
const entry=s=>registry.entries.find(e=>e.logicalSymbol===s), now=Date.parse('2026-10-13T12:00:00Z');
function bar(s='EURUSD') {const e=entry(s);return {symbol:s,provider:e.provider,providerSymbol:e.providerSymbol,sourceIdentity:e.sourceIdentity,timeframe:'1D',timestamp:Date.parse('2026-10-11T21:00:00Z')/1000,open:1,high:1.2,low:.9,close:1.1,completed:true,sessionEnd:'2026-10-12T21:00:00Z'};}
function run(bars,options={}) {const f=path.join(root,'input.json');fs.writeFileSync(f,JSON.stringify({schemaVersion:1,generatedAt:'2026-10-13T10:00:00Z',bars}));return ingest({input:f,root,now,...options});}
assert.equal(registry.entries.filter(e=>e.status==='canonical-test-candidate').length,25);
const eur=entry('EURUSD'),b=bar();
for(const changes of [{provider:'Yahoo'},{providerSymbol:'FX:EURUSD'},{sourceIdentity:'YAHOO'},{timeframe:'1H'},{timestamp:'123'},{close:1.3},{open:0},{completed:false},{sessionEnd:'2026-10-14T21:00:00Z'},{sessionEnd:'2026-10-12T20:00:00Z'}])assert.throws(()=>validateBar({...b,...changes},eur,now,now));
// DST contracts are timezone based, not a fixed UTC offset.
validateBar({...b,timestamp:Date.parse('2026-01-05T22:00:00Z')/1000,sessionEnd:'2026-01-06T22:00:00Z'},eur,now,now);
assert.throws(()=>validateBar({...b,timestamp:Date.parse('2026-01-05T21:00:00Z')/1000,sessionEnd:'2026-01-06T21:00:00Z'},eur,now,now));
let r=run([b]);assert.equal(r.inserted,1,JSON.stringify(r));assert.equal(r.failed,0);assert.equal(r.instruments[0].appendedAfterHistoricalTail,true);
const daily=path.join(root,'daily-ingestion/EURUSD.json'),before=fs.readFileSync(daily);
r=run([b]);assert.equal(r.skipped,1);assert.deepEqual(fs.readFileSync(daily),before);
r=run([{...b,close:1.15}]);assert.equal(r.failed,1);assert.match(r.instruments[0].reason,/OHLC_CONFLICT/);assert.deepEqual(fs.readFileSync(daily),before);
// A conflict rolls back other prospective bars in that same instrument, not other instruments.
const next={...b,timestamp:Date.parse('2026-10-12T21:00:00Z')/1000,sessionEnd:'2026-10-13T21:00:00Z'};
const futureNow=Date.parse('2026-10-14T12:00:00Z');
fs.writeFileSync(path.join(root,'input.json'),JSON.stringify({schemaVersion:1,generatedAt:'2026-10-14T10:00:00Z',bars:[next,{...b,close:1.15},bar('GBPUSD')]}));
r=ingest({input:path.join(root,'input.json'),root,now:futureNow});assert.equal(r.failed,2);assert.equal(r.inserted,1);assert.deepEqual(fs.readFileSync(daily),before);
r=run([bar('EURAUD')]);assert.equal(r.notEnabled,1);assert.equal(r.inserted,0);
r=run([bar('EURAUD')],{includeReview:true});assert.equal(r.inserted,1);
r=run([bar('SPX')],{includeReview:true});assert.equal(r.inserted,1);assert.match(JSON.parse(fs.readFileSync(path.join(root,'daily-ingestion/SPX.json'),'utf8')).htfPolicy,/close-only/);
r=run([b,b]);assert.equal(r.failed,2);
r=run([{...b,provider:'Yahoo'}]);assert.equal(r.failed,1);assert.equal(r.providerSplice,false);
// Actual repository envelope dialect and index alias, without inventing completion.
const ndx=JSON.parse(fs.readFileSync(path.join(root,entry('NDX').seasonalitySource),'utf8')).bars.at(-1);
const input=path.join(root,'input.json');fs.writeFileSync(input,JSON.stringify({schemaVersion:1,timeframe:'1D',fetchedAt:'2026-10-13T10:00:00Z',bars:[{...ndx,symbol:'NASDAQ100',provider:'NASDAQ',providerSymbol:'NASDAQ:NDX',assetClass:'index',timeframe:'1D',status:'ok'}]}));
r=ingest({input,root,now});assert.equal(r.skipped,1);assert.equal(r.instruments[0].symbol,'NDX');
fs.writeFileSync(input,JSON.stringify({schemaVersion:2,fetchedAt:'2026-10-13T10:00:00Z',bars:[]}));assert.throws(()=>ingest({input,root,now}),/schemaVersion/);
assert.throws(()=>validateBar({...b,status:'error'},eur,now,now),/status/);
// An unknown new cash/futures session must fail closed without explicit completion evidence.
assert.throws(()=>validateBar({...bar('NDX'),completed:undefined,status:'ok',sessionEnd:undefined},entry('NDX'),now,now),/explicit evidence/);
// Actual producer audit, tied to the exact collection and provider bar.
const cash={...bar('NDX'),symbol:'NASDAQ100',date:'2026-10-12',timestamp:Date.parse('2026-10-12T13:30:00Z')/1000,status:'ok',sessionEnd:null};
const observed=Date.parse('2026-10-13T05:31:41.620Z');
const audit={schemaVersion:1,runs:[{checkedAt:new Date(observed).toISOString(),sources:[{id:'session',url:'https://indexes.nasdaq.com/docs/Methodology_NDX.pdf',finding:'Documented index session'},{id:'calendar',url:'https://www.nasdaq.com/market-activity/stock-market-holiday-schedule',finding:'Reviewed trading calendar'}],entries:[{...cash,method:'documented_session_and_bar_timestamp',reason:'Session/calendar checked and documented completion window has elapsed',timezone:'America/New_York',sourceIds:['session','calendar']}]}]};
const evidence=auditCompletion(cash,observed,audit);
validateBar({...cash,symbol:'NDX',sourceIdentity:entry('NDX').sourceIdentity},entry('NDX'),observed,now,null,evidence);
assert.throws(()=>auditCompletion(cash,observed,null),/unavailable/);
assert.throws(()=>auditCompletion({...cash,timestamp:cash.timestamp+1},observed,audit),/missing/);
assert.throws(()=>auditCompletion(cash,observed+1000,audit),/timestamp mismatch/);
assert.throws(()=>validateBar({...cash,symbol:'NDX',sourceIdentity:entry('NDX').sourceIdentity,completed:false},entry('NDX'),observed,now,null,evidence));
const openAudit=structuredClone(audit);openAudit.runs[0].checkedAt='2026-10-12T18:00:00Z';
assert.throws(()=>auditCompletion(cash,Date.parse(openAudit.runs[0].checkedAt),openAudit),/not elapsed/);
for(const e of registry.entries)assert.deepEqual(fs.readFileSync(path.join(root,e.seasonalitySource)),fs.readFileSync(path.join(source,e.seasonalitySource)));
console.log('PASS: 25 initial identities, strict schema/OHLC, NY17 DST, immutable history, append, idempotency, instrument conflict isolation, provider-splice rejection, conditional/research gating, SPX HTF restriction. Synthetic tests only. Evidence: '+root);
