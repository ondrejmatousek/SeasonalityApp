// Independently compare the exported raw daily curve with the calendar interpolation used by Seasonality.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const dir=path.resolve(process.argv[2]),read=file=>JSON.parse(fs.readFileSync(path.join(dir,file.replace(/^\//,''))));
const manifest=read('data/manifest.json'),snapshot=read(manifest.opportunities.path),a=snapshot.assets.find(a=>a.key==='USDCAD');
assert.equal(snapshot.config.discovery,'all-completed-years-unsmoothed-v2');
const rows=read(manifest.assets.find(x=>x.key===a.key).prices.path).prices;
const daily=a.displayYears.map(year=>{
    const group=rows.filter(([date])=>Number(date.slice(0,4))===year),base=group[0][1];
    const quotes=group.filter(([date])=>!date.endsWith('02-29')).map(([date,close])=>[(Date.UTC(2001,Number(date.slice(5,7))-1,Number(date.slice(8,10)))-Date.UTC(2001,0,1))/86400000,close/base*100]);
    return Array.from({length:365},(_,day)=>{
        const exact=quotes.find(q=>q[0]===day);if(exact)return exact[1];
        const before=quotes.filter(q=>q[0]<day).at(-1),after=quotes.find(q=>q[0]>day);
        return before&&after?before[1]+(after[1]-before[1])*(day-before[0])/(after[0]-before[0]):(before||after)[1];
    });
});
for(let day=0;day<365;day++)assert.ok(Math.abs(a.curve[day]-daily.reduce((s,c)=>s+c[day],0)/daily.length)<=.000051,'USDCAD raw curve parity at day '+day);
let count=0;
for(const asset of snapshot.assets){
    if(!asset.curve)continue;
    assert.deepEqual(asset.curve,asset.displayCurve);assert.deepEqual(asset.trainingYears,asset.displayYears);
    assert.equal(asset.recentCheckIndependent,false);assert.ok(asset.displayYears.every(y=>y<Number(snapshot.asOf.slice(0,4))));
    const at=d=>asset.curve[((d%365)+365)%365]*Math.pow(asset.curve[364]/asset.curve[0],Math.floor(d/365));
    for(const c of asset.candidates){
        for(let i=-7;i<=7;i++){
            // Export rounds to four decimals; allow only that quantization error.
            assert.ok(c.direction==='up'?at(c.startDay)<=at(c.startDay+i)+.00011:at(c.startDay)>=at(c.startDay+i)-.00011,`${asset.key} raw entry extremum`);
            assert.ok(c.direction==='up'?at(c.endDay)>=at(c.endDay+i)-.00011:at(c.endDay)<=at(c.endDay+i)+.00011,`${asset.key} raw exit extremum`);
        }
        assert.equal(new Set(c.cases.map(s=>s.year)).size,c.cases.length);count++;
    }
}
console.log(JSON.stringify({asOf:snapshot.asOf,rawWindows:count,USDCAD:{years:a.displayYears,intervals:a.candidates.map(c=>({direction:c.direction,start:c.startDate,end:c.endDate}))},rawCurveParity:true,duplicateYears:false},null,2));
