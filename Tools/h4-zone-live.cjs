// Recheck SQL-backed incremental evidence before publishing a zone-only sidecar.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const ny=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
function aligned(t){if(!Number.isSafeInteger(t)||t%3600!==0)return false;const s=ny.format(new Date(t*1000)),date=s.slice(0,10),h=Number(s.slice(-2)),d=new Date(date+'T00:00:00Z').getUTCDay();return (h+7)%4===0&&d!==6&&!(d===0&&h<17)&&!(d===5&&h>=17);}
function complete(t,next,at){if(!aligned(t))return false;const local=ny.format(new Date(t*1000)),d=local.slice(0,10),friday=new Date(d+'T00:00:00Z').getUTCDay()===5&&local.slice(-2)==='13';return ((aligned(next)&&next===t+14400)||friday)&&t+14400<=at/1000-60&&!(d.slice(5,7)==='12'&&d.slice(8)>='24')&&!(d.slice(5,7)==='01'&&d.slice(8)<='02');}
function columns(raw){
 assert.ok(['rows','columns'].includes(raw.format),'Unsupported H4 raw format');
 const keys=['t','o','h','l','c','v'],b=raw.bars,n=raw.count;assert.ok(Number.isInteger(n)&&n>=2&&n<=96);
 if(raw.format==='rows'){assert.ok(Array.isArray(b)&&b.length===n);for(const row of b)for(const key of keys)assert.ok(Object.hasOwn(row,key),'Missing raw H4 row field');return Object.fromEntries(keys.map(key=>[key,b.map(row=>row[key])]));}
 for(const key of keys)assert.ok(Array.isArray(b[key])&&b[key].length===n,'H4 column count');return b;
}
function merge(prices,live){
 if(!live?.rows?.length)return {rule:'oanda-h4-boundary-v1',acceptedRows:0,receiptIds:[]};
 assert.equal(live.rule,'oanda-h4-boundary-v1');const receipts=new Map();
 for(const r of live.receipts){assert.equal(sha(r.payloadText),r.receiptId);assert.ok(!receipts.has(r.receiptId));const payload=JSON.parse(r.payloadText),at=Date.parse(r.receivedAt);assert.equal(payload.schemaVersion,1);const fetched=Date.parse(payload.fetchedAt);assert.ok(fetched>=at-1800000&&fetched<=at+60000);const captures=new Map();
  for(const c of payload.captures){const raw=JSON.parse(c.rawJson),captured=Date.parse(c.capturedAt);assert.ok(captured>=at-1800000&&captured<=at+60000&&captured<=fetched+60000);assert.equal(raw.success,true);assert.equal(raw.interval,'4h');const bars=columns(raw);assert.ok(prices[raw.symbol.replace(/^OANDA:/,'')]);assert.ok(!captures.has(raw.symbol));captures.set(raw.symbol,{raw,bars,captured});}
  assert.ok(r.status==null||['Accepted','PartialConflict'].includes(r.status),'Unaccepted receipt');
  const admission=r.admission||'symbol-isolated-conflict-v1';assert.ok(['symbol-isolated-conflict-v1','bar-isolated-conflict-v2'].includes(admission),'Unknown H4 admission policy');
  const blocked=new Set(r.blockedSymbols||[]),quarantined=new Set();
  for(const q of r.quarantinedBars||[]){assert.ok(captures.get(q.symbol)?.bars.t.includes(q.startUnix),'Quarantine missing original raw evidence');quarantined.add(q.symbol+':'+q.startUnix);}
  if(r.status==='PartialConflict')assert.ok(admission==='bar-isolated-conflict-v2'?quarantined.size>0:blocked.size>0,'Partial receipt requires explicit blocked symbols or quarantined bars');
  if(r.status==='Accepted')assert.equal(quarantined.size,0,'Accepted receipt cannot conceal quarantined bars');
  receipts.set(r.receiptId,{at,captures,blocked,quarantined});
 }
 const grouped=new Map();for(const b of live.rows){const r=receipts.get(b.receiptId),c=r?.captures.get(b.symbol);assert.ok(c,'Missing raw live H4 evidence');assert.ok(!r.blocked.has(b.symbol),'Conflicted symbol cannot enter publication');assert.ok(!r.quarantined.has(b.symbol+':'+b.timestamp),'Quarantined candle cannot enter publication');const a=c.bars,i=a.t.indexOf(b.timestamp);assert.ok(i>=0&&complete(a.t[i],a.t[i+1],c.captured),'Unverified live H4 boundary');for(const [field,col]of Object.entries({open:'o',high:'h',low:'l',close:'c',volume:'v'}))assert.equal(b[field],a[col][i],'Live SQL/raw OHLCV mismatch');assert.ok(b.low>0&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close));
  const key=b.symbol.replace(/^OANDA:/,'');assert.equal(prices[key].symbol,b.symbol);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push({...b,date:new Date(b.timestamp*1000).toISOString(),endDate:new Date((b.timestamp+14400)*1000).toISOString(),receivedAt:new Date(r.at).toISOString()});
 }
 for(const [key,rows]of grouped){const p=prices[key],bars=new Map(p.bars.map(b=>[b.timestamp,b]));for(const b of rows){if(bars.has(b.timestamp)){for(const f of ['open','high','low','close','volume'])assert.equal(bars.get(b.timestamp)[f],b[f],'Live/backfill price conflict');}else bars.set(b.timestamp,b);}
  p.bars=[...bars.values()].sort((a,b)=>a.timestamp-b.timestamp).slice(-2200);p.asOfUtc=rows.map(r=>r.receivedAt).sort().at(-1);p.observedAt=p.asOfUtc;p.latestDate=p.bars.at(-1).date;p.latestClose=p.bars.at(-1).close;p.validatedBarCount+=rows.length;p.liveRule=live.rule;p.liveBarCount=rows.length;
 }
 return {rule:live.rule,acceptedRows:live.rows.length,receiptIds:[...receipts.keys()].sort(),newestReceivedAt:[...receipts.values()].map(r=>new Date(r.at).toISOString()).sort().at(-1),exchangeCalendarValidated:false};
}
module.exports={aligned,complete,merge,columns};
