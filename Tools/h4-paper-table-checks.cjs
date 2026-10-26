const assert=require('node:assert/strict'),T=require('../wwwroot/js/h4-paper-table.js');
const row=(id,n,date='2026-10-22T13:48:00Z')=>({id,status:'tp',resolvedAt:date,lastClose:n,grossR:n,netR:n,frozen:{registeredAt:date,key:'PAIR'+id,side:'long',zone:{qualityPoints:n},entry:n,sl:n,tp:n}});
const rows=[row('a',10),row('b',2),row('c',-1),row('d',null)],before=structuredClone(rows);
for(const key of ['quality','entry','sl','tp','close','gross','net']){
 assert.deepEqual(T.sort(rows,key,'asc').map(s=>s.id),['c','b','a','d'],key);
 assert.deepEqual(T.sort(rows,key,'desc').map(s=>s.id),['a','b','c','d'],key);
}
assert.deepEqual(T.sort([row('2',1),row('10',1)],'instrument','asc').map(s=>s.id),['2','10']);
const dst=[row('a',1,'2026-10-25T02:30:00+02:00'),row('b',1,'2026-10-25T02:15:00+01:00')];assert.deepEqual(T.sort(dst,'registered','asc').map(s=>s.id),['a','b'],'UTC instants, not rendered Prague clock strings');
const missing=[row('a',NaN,'invalid'),row('b',2),row('c',Infinity)];assert.equal(T.sort(missing,'registered','desc').at(-1).id,'a');assert.equal(T.sort(missing,'net','desc')[0].id,'b');
for(const key of Object.keys(T.columns))for(const dir of ['asc','desc'])assert.deepEqual(T.sort(rows,key,dir).map(s=>s.id),T.sort([...rows].reverse(),key,dir).map(s=>s.id),'Stable tie IDs');
const many=Array.from({length:43},(_,i)=>row(String(i),43-i)),sorted=T.sort(many,'entry','asc'),pages=[sorted.slice(0,20),sorted.slice(20,40),sorted.slice(40)].flat();assert.deepEqual(pages.map(s=>s.frozen.entry),Array.from({length:43},(_,i)=>i+1));assert.equal(new Set(pages.map(s=>s.id)).size,43);
assert.deepEqual(rows,before,'Sorting cannot mutate the model or exported ledger');assert.throws(()=>T.sort(rows,'__proto__'));assert.throws(()=>T.sort(rows,'net','other'));assert.deepEqual(T.sort([]),[]);
console.log('PASS paper tables: all numeric/text/date/status columns, Prague DST instants, unknowns last both ways, deterministic ties, global ordering before pagination, immutable ledger.');
