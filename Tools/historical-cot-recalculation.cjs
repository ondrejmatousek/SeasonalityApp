// Read-only comparison of immutable snapshots. No SQL, source updates or scoring changes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const load=dir=>{const manifest=JSON.parse(fs.readFileSync(path.join(dir,'data/manifest.json')));return JSON.parse(fs.readFileSync(path.join(dir,manifest.opportunities.path)));};
const before=load(process.argv[2]),after=load(process.argv[3]),rows=[];
for(const asset of after.assets.filter(a=>a.dataStatus==='validated-ranking-ready')){
    const oldAsset=before.assets.find(a=>a.key===asset.key);assert.ok(oldAsset);
    for(const candidate of asset.candidates){
        const old=oldAsset.candidates.find(c=>c.direction===candidate.direction);
        assert.ok(old);assert.deepEqual([candidate.startDate,candidate.endDate],[old.startDate,old.endDate],'COT cannot change selection');
        for(const k of ['S','R','M'])assert.equal(candidate.scoringV2.components[k],old.scoringV2.components[k],`${asset.key} ${k} unchanged`);
        assert.deepEqual(candidate.scoringV2.weights,old.scoringV2.weights);
        const v=candidate.scoringV2,p=old.scoringV2;
        rows.push({instrument:asset.key,direction:candidate.direction,start:candidate.startDate,end:candidate.endDate,
            similar:v.samples.similar,other:v.samples.other,C:v.components.C,raw:v.rawScore,oldSimilar:p.samples.similar,oldOther:p.samples.other,oldC:p.components.C,oldRaw:p.rawScore});
    }
}
rows.sort((a,b)=>b.raw-a.raw);
console.log(JSON.stringify({asOf:after.asOf,coreCandidates:rows.length,totalSimilar:rows.reduce((n,r)=>n+r.similar,0),totalOther:rows.reduce((n,r)=>n+r.other,0),rows},null,2));
