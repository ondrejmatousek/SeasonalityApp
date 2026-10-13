const fs=require('node:fs'),path=require('node:path');
const day=t=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Prague'}).format(new Date(t));
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
function scheduleGate(schedule,now=new Date(),manual=false){
 if(manual)return true;
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Prague',hour:'2-digit',hourCycle:'h23'}).format(now);
 // Match the correct seasonal cron even if GitHub starts the job late.
 const offset=(Number(parts)-now.getUTCHours()+24)%24;
 const target=offset===2?'0 4 * * *':'0 5 * * *';
 return schedule===target;
}
function create(now=new Date(),sourceCommit=process.env.SOURCE_COMMIT||process.env.GITHUB_SHA||'local'){
 return {schemaVersion:1,status:'running',runDate:day(now),runStartedAt:now.toISOString(),runFinishedAt:null,sourceCommit,
  marketDailyFetchedAt:null,market:{status:'pending',received:0,inserted:0,duplicates:0,failed:0,failedSymbols:[]},
  stocks:{status:'pending'},cot:{status:'pending'},seasonality:{status:'pending'},htf:{status:'pending'},scoring:{status:'pending'},staticExport:{status:'pending'},
  seasonalityCandidates:0,htfZones:0,screenerRows:0,instrumentChecks:[],warnings:[],errors:[],published:false};
}
function marketFreshness(input,now=new Date()){
 const p=read(input),at=p.fetchedAt||p.generatedAt,t=Date.parse(at);
 if(!Number.isFinite(t)||t>+now+60000||+now-t>24*3600000)throw Error('Market daily JSON is missing, future-dated or older than 24 hours');
 if(p.schemaVersion!==1||p.timeframe!=='1D'||!Array.isArray(p.bars))throw Error('Market daily schema invalid');
 return at;
}
function ingestionGate(report,registry){
 const core=new Set(registry.entries.filter(e=>e.assetClass==='forex'||['NDX','SPX'].includes(e.logicalSymbol)).map(e=>e.logicalSymbol));
 const failed=report.instruments.filter(r=>r.failed),errors=failed.filter(r=>core.has(r.symbol)).map(r=>r.symbol+': '+r.reason);
 for(const symbol of core)if(!report.instruments.some(r=>r.symbol===symbol&&r.received>0))errors.push(symbol+': missing daily instrument');
 if(report.providerSplice)errors.push('Provider splice detected');
 return {errors,warnings:failed.filter(r=>!core.has(r.symbol)).map(r=>r.symbol+': '+r.reason)};
}
function stockRefreshAudit(audit){
 if(!audit||!Array.isArray(audit.yahooSucceeded)||!Array.isArray(audit.yahooFailed)||!Array.isArray(audit.failedSymbols)||!Array.isArray(audit.yahooEmpty)||!Number.isFinite(Date.parse(audit.finishedAt)))throw Error('Missing or invalid stock refresh evidence');
 const warnings=[];
 if(audit.yahooFailed.length||audit.failedSymbols.length||audit.yahooEmpty.length)warnings.push('Yahoo stock refresh: '+audit.yahooFailed.length+' Yahoo failures; '+audit.failedSymbols.length+' unresolved symbols; '+audit.yahooEmpty.length+' empty responses');
 if(audit.yahooFailed.includes('AAPL')||!audit.yahooSucceeded.includes('AAPL'))throw Error('AAPL Yahoo refresh failed or returned no completed prices; refusing stale-stock publication');
 return warnings;
}
function checkOutputs(dir,h,now=new Date()){
 const m=read(path.join(dir,'data/manifest.json')),op=read(path.join(dir,m.opportunities.path)),htf=read(path.join(dir,m.htfConfluence.path));
 const expected={AAPL:['Yahoo',null],EURUSD:['OANDA','OANDA:EURUSD'],NDX:['NASDAQ','NASDAQ:NDX'],SPX:['S&P','SP:SPX'],XAUUSD:['OANDA','OANDA:XAUUSD'],WTI:['NYMEX','NYMEX:CL1!']};
 for(const [symbol,[provider,providerSymbol]]of Object.entries(expected)){
  const a=m.assets.find(a=>a.key===symbol),s=a?.priceSource||{},p=htf.prices[symbol],research=['XAUUSD','WTI'].includes(symbol);
  const error=!a||s.provider!==provider||(providerSymbol&&s.providerSymbol!==providerSymbol)||!a.prices.count||s.status==='unavailable';
  h.instrumentChecks.push({symbol,historicalSource:s.historicalSource||s.sourceIdentity,dailySource:s.dailySource,lastBarDate:a?.prices.lastDate||null,
   seasonalitySource:s.id||s.sourceIdentity,htfSource:p?.priceSeriesId||p?.provider||null,provider:s.provider,providerSymbol:s.providerSymbol,status:error?'failed':research?'research/review':'ok'});
  if(error)(research?h.warnings:h.errors).push('Source routing failed '+symbol);
 }
 // Validate EVERY routed source, not just the six displayed checks.
 for(const a of m.assets.filter(a=>['forex','index','commodity'].includes(a.assetClass)&&a.priceSource?.id)){
  const s=a.priceSource,data=read(path.join(dir,a.prices.path));
  if(data.priceSource?.id!==s.id||data.priceSource?.provider!==s.provider||data.priceSource?.providerSymbol!==s.providerSymbol)h.errors.push('Provider/source splice '+a.key);
  const core=a.assetClass==='forex'||['NDX','SPX'].includes(a.key);
  if(core&&Date.parse(day(now))-Date.parse(a.prices.lastDate)>4*86400000)h.errors.push('Stale market bars '+a.key);
 }
 const apple=m.assets.find(a=>a.key==='AAPL'),age=Date.parse(day(now))-Date.parse(apple?.prices.lastDate);
 if(h.mode==='live'&&(!apple?.stockProviders?.length||apple.stockProviders.some(p=>p!=='Yahoo')))h.errors.push('AAPL is not exclusively from the Yahoo stock SQL pipeline');
 if(!Number.isFinite(age)||age>4*86400000)h.errors.push('AAPL stock prices older than 4 calendar days');
 const stamp=Date.parse(m.stockSnapshotAt||m.sourceSnapshotAt||m.exportedAt);
 if(!Number.isFinite(stamp)||+now-stamp>36*3600000||stamp>+now+60000)h.errors.push('Stock SQL snapshot is stale or invalid');
 h.stocks={...h.stocks,snapshotAt:new Date(stamp).toISOString(),lastBarDate:apple?.prices.lastDate,status:h.errors.some(e=>/AAPL|Stock SQL/.test(e))?'failed':h.stocks.status};
 for(const a of op.assets.filter(a=>a.mapping.scope==='core')){
  const p=htf.prices[a.mapping.priceKey||a.key];
  if(!p||p.status!=='ready'){h.htf.status='failed';h.errors.push('Core HTF failed '+a.key+': '+(p?.error||'missing output'));}
 }
 for(const [key,p]of Object.entries(htf.prices))if(p.status!=='ready'&&!op.assets.some(a=>a.key===key&&a.mapping.scope==='core'))h.warnings.push('Research HTF '+key+': '+p.error);
 const historicalOnly=m.assets.filter(a=>a.priceSource?.dailyStatus==='historical-only').map(a=>a.key);
 if(historicalOnly.length)h.warnings.push('Research history only; daily refresh not configured: '+historicalOnly.join(', '));
 const awaiting=m.assets.filter(a=>a.priceSource?.dailyStatus==='awaiting-daily').map(a=>a.key);
 if(awaiting.length)h.warnings.push('Research daily ingestion prepared; awaiting validated bars: '+awaiting.join(', '));
 const staleResearch=m.assets.filter(a=>a.priceSource?.dailyStatus==='daily-connected' && Date.parse(day(now))-Date.parse(a.prices.lastDate)>4*86400000).map(a=>a.key);
 if(staleResearch.length)h.warnings.push('Stale research daily bars: '+staleResearch.join(', '));
 h.seasonalityCandidates=op.assets.reduce((n,a)=>n+a.candidates.length,0);h.screenerRows=h.seasonalityCandidates;
 h.htfZones=Object.values(htf.prices).reduce((n,p)=>n+p.zones.length,0);
 const dates=Object.values(m.contracts).map(c=>c.lastDate).filter(Boolean).sort();
 h.cot={...h.cot,latestPositionsDate:dates.at(-1)||null,contracts:Object.keys(m.contracts).length};
 if(!dates.length||Date.parse(day(now))-Date.parse(dates.at(-1))>14*86400000){h.cot.status='warning';h.warnings.push('COT dataset missing or latest positions older than 14 days');}
 if(h.errors.length)throw Error(h.errors.join('; '));
 return m;
}
function finish(h,now=new Date()){
 h.runFinishedAt=now.toISOString();h.durationSeconds=Math.round((+now-Date.parse(h.runStartedAt))/1000);
 h.status=h.errors.length?'failed':h.warnings.length?'warning':'ok';
 h.staleAfter=new Date(+now+36*3600000).toISOString();return h;
}
function write(dir,h){
 fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'latest.json'),JSON.stringify(h,null,2));
 fs.writeFileSync(path.join(dir,h.runDate+'.json'),JSON.stringify(h,null,2));
 const files=fs.readdirSync(dir).filter(n=>/^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().reverse().slice(0,7);
 fs.writeFileSync(path.join(dir,'history.json'),JSON.stringify({schemaVersion:1,runs:files.map(n=>read(path.join(dir,n)))},null,2));
}
function summary(h){
 const rows=[['Overall',h.status],...['market','stocks','cot','seasonality','htf','scoring','staticExport'].map(k=>[k,h[k].status]),
 ['Received / inserted / duplicates / failed',`${h.market.received} / ${h.market.inserted} / ${h.market.duplicates} / ${h.market.failed}`],
 ...['EURUSD','AAPL'].map(k=>[k+' last date',h.instrumentChecks.find(c=>c.symbol===k)?.lastBarDate||'unavailable']),['Screener candidates',h.screenerRows],['HTF zones',h.htfZones]];
 return '## Morning analytics\n\n| Check | Result |\n|---|---|\n'+rows.map(r=>'| '+r.join(' | ')+' |').join('\n')+'\n\n'+[...h.errors.map(e=>'ERROR: '+e),...h.warnings.map(e=>'WARNING: '+e)].map(e=>'- '+e.replace(/\n/g,' ')).join('\n')+'\n';
}
module.exports={day,scheduleGate,create,marketFreshness,ingestionGate,stockRefreshAudit,checkOutputs,finish,write,summary};
if(require.main===module&&process.argv.includes('--gate')){
 const run=scheduleGate(process.env.SCHEDULE,new Date(),process.env.EVENT_NAME==='workflow_dispatch');
 if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,'run='+run+'\n');console.log('Prague schedule gate: '+run);
}
