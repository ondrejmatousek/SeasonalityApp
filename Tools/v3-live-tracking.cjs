// Append-only forecasts, close-based outcomes. No database, provider, or scoring changes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ranking=require('../wwwroot/js/opportunity-ranking.js');
const id=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function capture(snapshot,ledger,capturedAt){
    const runId=id([snapshot.exportedAt,snapshot.asOf,snapshot.calibrationV3]);
    if(ledger.runs.some(r=>r.id===runId))return ledger;
    const records=snapshot.assets.flatMap(a=>a.candidates.filter(c=>c.scoringV3).map(c=>{
        const v=c.scoringV3,v1=ranking.rank(a,c,{history:20,asOf:snapshot.asOf,evaluationAt:snapshot.exportedAt,today:snapshot.asOf});
        return {id:id([runId,a.key,c.direction,c.startDate,c.endDate]),timestamp:capturedAt,dataTimestamp:snapshot.exportedAt,
            instrument:a.key,direction:c.direction,entryWindow:{start:c.startDate,end:c.endDate},
            V1:v1.value,V2Raw:v.rawScore,V3Display:v.displayScore,percentile:v.percentile,components:v.components,
            confidence:v.confidence,exposureFamily:a.mapping.exposureFamily,priceKey:a.mapping.priceKey,
            tradingProfile:a.mapping.executionKind==='futures-profile',
            prospective:capturedAt.slice(0,10)<c.startDate,outcome:null};
    }));
    ledger.runs.push({id:runId,timestamp:capturedAt,asOf:snapshot.asOf,version:snapshot.calibrationV3.version,
        calibration:snapshot.calibrationV3,records});return ledger;
}
function outcome(record,prices,asOf){
    const {start,end}=record.entryWindow;
    if(asOf<=end)return null; // Never mark an in-progress period completed.
    const rows=prices.filter(([d])=>d>=start&&d<=end);
    if(rows.length<2||rows.some((r,i)=>!(r[1]>0)||i&&Date.parse(r[0])-Date.parse(rows[i-1][0])>7*86400000)||
        Date.parse(rows[0][0])-Date.parse(start)>7*86400000||Date.parse(end)-Date.parse(rows.at(-1)[0])>7*86400000)return null;
    const sign=record.direction==='up'?1:-1,returns=rows.map(r=>sign*(r[1]/rows[0][1]-1)*100),directionalReturn=returns.at(-1);
    return {entryDate:rows[0][0],exitDate:rows.at(-1)[0],directionalReturn,MAE:Math.max(0,-Math.min(...returns)),
        MFE:Math.max(0,...returns),winLoss:directionalReturn>0?'win':directionalReturn<0?'loss':'flat',
        priceType:'daily close; not execution P&L; no costs or intraday extremes'};
}
function update(ledger,readPrices,asOf,evaluatedAt){
    const cache=new Map();
    for(const run of ledger.runs)for(const r of run.records){
        if(r.outcome||!r.prospective)continue;
        if(!cache.has(r.priceKey))cache.set(r.priceKey,readPrices(r.priceKey));
        const value=outcome(r,cache.get(r.priceKey)||[],asOf);
        if(value)r.outcome={...value,evaluatedAt}; // Do not revise completed observations silently.
    }
    return ledger;
}
if(require.main===module){
    const dir=path.resolve(process.argv[2]),ledgerPath=path.resolve(process.argv[3]||'artifacts/v3-live-ledger/ledger.json');
    const manifest=JSON.parse(fs.readFileSync(path.join(dir,'data/manifest.json'))),snapshot=JSON.parse(fs.readFileSync(path.join(dir,manifest.opportunities.path)));
    const ledger=fs.existsSync(ledgerPath)?JSON.parse(fs.readFileSync(ledgerPath)): {schemaVersion:1,runs:[]};
    const capturedAt=new Date().toISOString();capture(snapshot,ledger,capturedAt);
    update(ledger,key=>{const a=manifest.assets.find(a=>a.key===key);return a?JSON.parse(fs.readFileSync(path.join(dir,a.prices.path))).prices:[];},snapshot.asOf,capturedAt);
    fs.mkdirSync(path.dirname(ledgerPath),{recursive:true});fs.writeFileSync(ledgerPath,JSON.stringify(ledger));
    fs.writeFileSync(path.join(dir,'data/screener/v3-live-ledger.json'),JSON.stringify(ledger));
    console.log(`V3 live ledger: ${ledger.runs.length} immutable runs, ${ledger.runs.reduce((n,r)=>n+r.records.length,0)} forecasts; retained outcomes are never recomputed.`);
}
module.exports={capture,outcome,update};
