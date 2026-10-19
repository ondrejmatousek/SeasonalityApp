const assert=require('node:assert/strict'),T=require('../wwwroot/js/trade-zone-table.js');
const row=(id,distance,key='EURUSD',quality=1,seasonal='supports',cot='confirms')=>({key,distancePct:distance,zone:{id,timeframe:'D1',qualityPoints:quality,confirmedAt:'2026-10-'+String(Number(id)+1).padStart(2,'0')},context:{seasonal,cot}});
const rows=[row('1',10,'USDJPY',3),row('2',2,'AUDUSD',1,'against','against'),row('3',0,'EURUSD',2,'neutral','neutral'),row('4',null,'GBPUSD',null,'unknown','insufficient')],before=JSON.stringify(rows);
assert.deepEqual(T.sort(rows).map(r=>r.distancePct),[0,2,10,null]);assert.deepEqual(T.sort(rows,'distance','desc').map(r=>r.distancePct),[10,2,0,null]);
assert.deepEqual(T.sort(rows,'instrument','asc').map(r=>r.key),['AUDUSD','EURUSD','GBPUSD','USDJPY']);
assert.deepEqual(T.sort(rows,'quality','desc').map(r=>r.zone.qualityPoints),[3,2,1,null]);
for(const k of ['seasonal','cot']){assert.equal(T.sort(rows,k,'asc')[0].zone.id,'1');assert.equal(T.sort(rows,k,'desc')[0].zone.id,'2');assert.equal(T.sort(rows,k,'desc').at(-1).zone.id,'4');}
assert.equal(T.sort(rows,'newest','desc')[0].zone.id,'4');
const tied=[row('2',0),row('1',0)];assert.deepEqual(T.sort(tied).map(r=>r.zone.id),['1','2']);
const many=Array.from({length:43},(_,i)=>row(String(i),43-i));const sorted=T.sort(many);
const pages=[1,2,3].flatMap(p=>T.paginate(sorted,p,20).rows);assert.deepEqual(pages.map(r=>r.distancePct),Array.from({length:43},(_,i)=>i+1));
assert.equal(new Set(pages.map(r=>r.zone.id)).size,43);assert.equal(T.paginate(sorted,99,20).page,3);assert.equal(T.paginate(sorted,3,20).rows.length,3);
assert.equal(T.paginate([],5,20).page,1);assert.equal(T.paginate([],5,20).start,0);assert.equal(T.paginate(sorted,9,'all').rows.length,43);
assert.equal(T.paginate(sorted.filter(r=>r.distancePct<3),3,20).page,1);assert.equal(JSON.stringify(rows),before);
console.log('PASS: all zone columns, numeric distances, unknowns last in both directions, stable identities, immutable inputs, global sorting before paging and empty/filter bounds.');
