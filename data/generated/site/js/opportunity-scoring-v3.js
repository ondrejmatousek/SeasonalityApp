(function(root,factory){
    const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.OpportunityScoringV3=api;
})(typeof globalThis==='object'?globalThis:this,function(){
    const version='core-relative-v3-live-experimental-1';
    const knots=Object.freeze([[0,1],[25,3.5],[50,5.5],[75,7.5],[90,9],[100,10]]);
    function transform(percentile){
        if(!Number.isFinite(percentile))return null;
        const p=Math.max(0,Math.min(100,percentile));
        for(let i=1;i<knots.length;i++){const [x,y]=knots[i],[a,b]=knots[i-1];if(p<=x)return b+(y-b)*(p-a)/(x-a);}
        return 10;
    }
    // Midrank ties; no artificial ordering between equal raw scores. Constant cohorts are neutral.
    function percentile(raw,reference){
        if(!Number.isFinite(raw)||!reference.length)return null;
        if(reference.length===1||reference[0]===reference.at(-1))return 50;
        let lo=0,hi=0;for(const value of reference){if(value<raw)lo++;if(value<=raw)hi++;}
        return Math.max(0,Math.min(100,100*(lo+Math.max(lo,hi-1))/2/(reference.length-1)));
    }
    function eligible(asset){return asset.dataStatus==='validated-ranking-ready'&&asset.mapping?.status==='validated-ranking-ready';}
    function calibrate(assets){
        // Execution profiles are aliases, not extra votes in the calibration distribution.
        const reference=assets.filter(a=>eligible(a)&&a.mapping.executionKind!=='futures-profile')
            .flatMap(a=>a.candidates.map(c=>c.scoringV2?.rawScore)).filter(Number.isFinite).sort((a,b)=>a-b);
        for(const a of assets)for(const c of a.candidates){
            c.scoringV3=null;if(!eligible(a)||!Number.isFinite(c.scoringV2?.rawScore))continue;
            const v=c.scoringV2,p=percentile(v.rawScore,reference),display=transform(p);
            if(p===null)continue;
            c.scoringV3={version,rawScore:v.rawScore,percentile:p,displayScore:Math.round(display*10)/10,
                components:{...v.components},weights:{...v.weights},confidence:v.confidence,
                referenceCount:reference.length,interpretation:'Relative core candidate strength; not probability of profit'};
        }
        return {version,knots,reference,referenceCount:reference.length,
            policy:'All eligible canonical core windows before UI filters; futures execution aliases excluded; equal raw values use midrank',
            historicalDataMode:'Current working historical dataset; not strict PIT validation'};
    }
    const level=c=>({'nízká':0,'low':0,'střední':1,'medium':1,'vyšší':2,'high':2}[c?.level]??0);
    function compare(x,y){const a=x.c.scoringV3,b=y.c.scoringV3;
        if(!a||!b)return a?-1:b?1:0;
        return b.displayScore-a.displayScore||level(b.confidence)-level(a.confidence)||b.rawScore-a.rawScore||
            x.c.startsIn-y.c.startsIn||x.a.key.localeCompare(y.a.key)||x.c.direction.localeCompare(y.c.direction);
    }
    return {version,knots,transform,percentile,calibrate,eligible,compare,level};
});
