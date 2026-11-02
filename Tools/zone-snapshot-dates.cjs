const assert=require('node:assert/strict');
function validateDates(manifest,prices,opportunities){
 assert.equal(prices.asOf,manifest.zonePrices.asOf,'Price snapshot must retain its own actual evaluation date');
 if(manifest.cotSnapshotAt&&prices.asOf!==opportunities.asOf){
  assert.equal(opportunities.exportedAt,manifest.cotSnapshotAt,'New context must identify its independent COT observation');
  assert.equal(manifest.exportedAt,manifest.cotSnapshotAt);
  const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Prague'}).format(new Date(manifest.cotSnapshotAt));
  assert.equal(opportunities.asOf,date);assert.ok(prices.asOf<=opportunities.asOf,'Price snapshot cannot come from the future');
 }else assert.equal(prices.asOf,opportunities.asOf);
}
module.exports={validateDates};
