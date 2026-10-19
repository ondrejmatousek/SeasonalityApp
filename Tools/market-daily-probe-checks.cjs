// Starts the actual isolated .NET host. Random token stays in child env/memory only.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const url='http://127.0.0.1:54183/api/market-daily/probe',key=crypto.randomBytes(32).toString('base64url');
const bundle=path.resolve(process.env.MARKET_DAILY_PROBE_TEST_BUNDLE||'artifacts/tradingview-backfill-36-v1/analytics-sources-v1/manifest.json');
// Refresh only test-envelope freshness, never provider bars or the stored daily JSON.
// Deployment regressions must remain runnable when no market collection has run recently.
const payload=JSON.parse(fs.readFileSync('data/market-daily/latest.json'));
payload.fetchedAt=new Date().toISOString();const input=Buffer.from(JSON.stringify(payload));
function snapshot(){const dirs=['data/market-state','data/commodity-research/validated'];return dirs.flatMap(d=>fs.readdirSync(d).filter(f=>f.endsWith('.json')).map(f=>{const p=path.join(d,f);return [p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')];}));}
const before=snapshot();let child,logs='';
async function stop(){if(!child)return;const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,5000))]);child=null;}
async function start(enabled,serverKey=key,readyStatus=enabled?401:404){logs='';child=spawn('dotnet',['bin/Release/net10.0/SeasonalityApp.dll','--market-daily-probe-only'],{windowsHide:true,env:{...process.env,ASPNETCORE_URLS:'http://127.0.0.1:54183',ASPNETCORE_ENVIRONMENT:'Development',MarketDailyProbe__Enabled:String(enabled),MARKET_DAILY_PROBE_TOKEN:serverKey,MarketData__BundlePath:bundle,ConnectionStrings__DefaultConnection:''}});child.stdout.on('data',b=>logs+=b.toString());child.stderr.on('data',b=>logs+=b.toString());for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('Probe host failed (logs withheld to protect environment)');try{const r=await fetch(url);if(r.status===readyStatus)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Probe host did not become ready');}
async function post(body,token=key,type='application/json'){return fetch(url,{method:'POST',headers:{'Content-Type':type,...(token?{Authorization:'Bearer '+token}:{})},body:typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body)});}
(async()=>{try{
 await start(false);let r=await post(input);assert.equal(r.status,404);assert.equal((await r.json()).code,'MARKET_DAILY_PROBE_DISABLED');
 const auditUrl='http://127.0.0.1:54183/api/data-runs/receipts',origin='https://delightful-ground-010f3d910.5.azurestaticapps.net';
 r=await fetch(auditUrl,{headers:{Origin:origin}});assert.equal(r.status,503);assert.equal((await r.json()).ready,false);assert.equal(r.headers.get('access-control-allow-origin'),origin);assert.equal(r.headers.get('cache-control'),'no-store');
 r=await fetch(auditUrl,{headers:{Origin:'https://untrusted.example'}});assert.equal(r.headers.get('access-control-allow-origin'),null);assert.equal((await fetch(auditUrl,{method:'POST'})).status,405);
 await stop();
 await start(true,'',503);assert.equal((await post(input)).status,503);await stop();
 await start(true);assert.equal((await post(input,null)).status,401);assert.equal((await post(input,'wrong-token')).status,401);
 r=await post(input);const receipt=await r.json();assert.equal(r.status,200,JSON.stringify(receipt));assert.equal(receipt.receivedBars,39);assert.equal(receipt.persisted,false);assert.equal(receipt.analyticsTriggered,false);assert.equal(receipt.completionValidated,false);assert.equal(receipt.payloadSha256,crypto.createHash('sha256').update(input).digest('hex'));
 assert.equal((await(await post(input)).json()).receiptId,receipt.receiptId);
 const badSchema=structuredClone(payload);badSchema.schemaVersion='1';assert.equal((await post(badSchema)).status,400);
 const stale=structuredClone(payload);stale.fetchedAt=new Date(Date.now()-25*3600000).toISOString();assert.equal((await post(stale)).status,400);
 const wrong=structuredClone(payload);wrong.bars[0].provider='Yahoo';assert.equal((await post(wrong)).status,400);
 const badPrice=structuredClone(payload);badPrice.bars[0].close=badPrice.bars[0].high+1;assert.equal((await post(badPrice)).status,400);
 const badTime=structuredClone(payload);badTime.bars[0].timestamp='123';assert.equal((await post(badTime)).status,400);
 const unfinished=structuredClone(payload);unfinished.bars[0].completed=false;assert.equal((await post(unfinished)).status,400);
 const duplicate=structuredClone(payload);duplicate.bars=[payload.bars[0],payload.bars[0]];assert.equal((await post(duplicate)).status,400);
 assert.equal((await post('{"schemaVersion":1,"schemaVersion":1}')).status,400);
 assert.equal((await post('{')).status,400);assert.equal((await post(input,key,'text/plain')).status,415);
 assert.equal((await post(' '.repeat(262145))).status,413);
 let limited=false;for(let i=0;i<32;i++){if((await post(input,'wrong-token')).status===429){limited=true;break;}}assert.ok(limited,'IP rate limit must reject excess requests');
 assert.ok(!logs.includes(key),'Never log credentials');assert.deepEqual(snapshot(),before,'No market state/history writes');
 console.log('PASS: actual .NET startup without SQL; disabled/authenticated POST, exact payload receipt, invalid input rejection, request size cap, no writes/jobs/token logging.');
}finally{await stop();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
