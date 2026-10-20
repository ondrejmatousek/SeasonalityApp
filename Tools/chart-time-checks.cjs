const assert=require('node:assert/strict'),T=require('../wwwroot/js/market-chart-time.js'),sec=s=>Date.parse(s)/1000;
assert.equal(T.timeZone,'Europe/Prague');
assert.match(T.format(sec('2026-10-16T17:00:00Z')),/19:00/);assert.match(T.format(sec('2026-10-16T17:00:00Z')),/GMT\+2/);
assert.match(T.format(sec('2026-01-16T17:00:00Z')),/18:00/);assert.match(T.format(sec('2026-01-16T17:00:00Z')),/GMT\+1/);
const before=T.format(sec('2026-10-25T00:30:00Z')),after=T.format(sec('2026-10-25T01:30:00Z'));assert.match(before,/02:30/);assert.match(after,/02:30/);assert.match(before,/GMT\+2/);assert.match(after,/GMT\+1/);assert.notEqual(before,after,'Repeated autumn hour is disambiguated by offset');
assert.equal(T.tick(sec('2026-10-16T17:00:00Z'),3),'19:00');assert.equal(T.tick(sec('2026-01-16T17:00:00Z'),3),'18:00');assert.equal(T.tick({year:2026,month:10,day:16},0),'2026');
assert.equal(T.format(sec('2026-10-16T17:00:00Z')),T.format('2026-10-16T17:00:00Z'));assert.match(T.format('2026-10-16T17:00:00Z'),/Praha/);
console.log('PASS: Europe/Prague display, summer/winter offsets, autumn repeated-hour disambiguation, native tick formats and unchanged UTC input contract.');
