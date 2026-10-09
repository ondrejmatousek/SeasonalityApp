const assert = require('node:assert/strict');
const {summarize,median}=require('../wwwroot/js/screener-metrics.js');
assert.equal(median([]),null);assert.equal(median([4,1,3,2]),2.5);
const rows=[];
for(let year=2010;year<=2025;year++) for(let offset=0;offset<=75;offset++) {
    const date=new Date(Date.UTC(year,0,1+offset));rows.push([date.toISOString().slice(0,10),100+offset]);
}
const stats=summarize(rows,'2026-01-01',30,'10');
assert.equal(stats.count,10);assert.equal(stats.winRate,100);assert.ok(Math.abs(stats.mean-30)<1e-8);
assert.equal(stats.medianDrop,0);assert.deepEqual(stats.years,[2016,2017,2018,2019,2020,2021,2022,2023,2024,2025]);
assert.equal(summarize(rows,'2026-01-01',30,'all').count,16);
assert.equal(summarize(rows.filter(r=>r[0]<'2025-01-10'),'2026-01-01',30,'10').count,9,'Incomplete years excluded');
assert.equal(summarize(rows.filter(r=>!r[0].startsWith('2025-01-1')),'2026-01-01',30,'10').count,9,'Internal gaps excluded');
assert.equal(summarize(rows.map(([d,p])=>[d,200-p]),'2026-01-01',30,'10').winRate,0);
assert.equal(summarize([],'2026-01-01',30,'10').median,null);
const cross=[];
for(let offset=0;offset<=45;offset++)cross.push([new Date(Date.UTC(2024,11,15+offset)).toISOString().slice(0,10),100+offset]);
assert.equal(summarize(cross,'2025-12-15',30,'10').count,1,'December window crosses into next year');
assert.equal(summarize(cross,'2025-01-01',30,'10').count,0,'Future/incomplete outcome never used');
const leap=[['2023-02-28',100],['2023-03-07',110],['2023-03-14',120]];
assert.equal(summarize(leap,'2024-02-29',14,'10').count,1,'Leap day maps to Feb 28');
console.log('Screener checks passed: returns, median, lookbacks, gaps, incomplete windows, year crossing and leap days.');
