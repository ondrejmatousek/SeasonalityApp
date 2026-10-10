(function(root,factory){
    if(typeof module==='object'&&module.exports)module.exports=factory();
    else root.OpportunityRanking=factory();
}(typeof globalThis==='object'?globalThis:this,function(){
    // Fixed research-priority heuristic, not fitted to outcomes or a calibrated probability.
    // Neutral pseudo-counts damp small samples; overlapping components are NOT independent votes.
    const weights=Object.freeze({seasonal:45,validation:25,cot:20,quality:10});
    const clamp=(n,lo=0,hi=1)=>Math.max(lo,Math.min(hi,n));
    const days=(a,b)=>(Date.parse(a)-Date.parse(b))/86400000;
    function counts(s){
        const n=s?.count??0,k=s?.successes??0;
        if(!Number.isInteger(n)||!Number.isInteger(k)||n<0||k<0||k>n)throw new Error('Invalid ranking counts');
        return {n,k};
    }
    function damped(s,strength=4){const {n,k}=counts(s);return (k+strength/2)/(n+strength);}
    function support(s,direction,strength=4){
        const value=damped(s,strength),{n}=counts(s);
        const agrees=Number.isFinite(s?.median)&&(direction==='up'?s.median>0:s.median<0);
        return n&&!agrees?Math.min(.5,value):value;
    }
    function label(value){
        if(value>=8)return 'Silnější podklady';
        if(value>=7)return 'K bližšímu průzkumu';
        if(value>=6)return 'Smíšené podklady';
        return 'Slabé / omezené podklady';
    }
    function rank(asset,candidate,{history=10,asOf,today=asOf}={}){
        if(![5,10,20].includes(history)||!['up','down'].includes(candidate.direction)||!Number.isFinite(Date.parse(asOf))||!Number.isFinite(Date.parse(today)))throw new Error('Invalid ranking settings');
        const h=candidate.histories?.[history];if(!h)throw new Error('Missing ranking history');
        const s=h.seasonal,v=candidate.validation,c=h.cot,b=h.baseline;
        const sn=counts(s).n,vn=counts(v).n,cn=counts(c).n,bn=counts(b).n;
        const age=days(asOf,asset.lastDate),snapshotAge=days(today,asOf);
        const pricesFresh=Number.isFinite(age)&&age>=0&&age<=7;
        const ref=candidate.cotReference,refAge=days(asOf,ref?.date);
        const currentCot=!!ref&&Number.isFinite(ref.index)&&ref.index>=0&&ref.index<=100&&Number.isFinite(refAge)&&refAge>=7&&refAge<=21;
        const snapshotFresh=snapshotAge>=0&&snapshotAge<=2;
        // Coverage counts refer to usable historical years, not the number of weekly reports.
        const coverage=[clamp(sn/history),clamp(vn/8),sn?clamp(bn/sn):0,pricesFresh&&currentCot&&snapshotFresh?1:0];
        const values={seasonal:support(s,candidate.direction),validation:support(v,candidate.direction),
            cot:currentCot?support(c,candidate.direction,8):.5,quality:coverage.reduce((a,b)=>a+b,0)/4};
        const components=Object.entries(weights).map(([key,weight])=>({key,weight,value:100*values[key],contribution:weight*values[key]}));
        const raw=1+9*components.reduce((sum,p)=>sum+p.contribution,0)/100;
        const limits=[];
        const limit=(max,code)=>limits.push({max,code});
        if(!sn)limit(1,'no-seasonal-sample');else if(sn<5)limit(5,'short-seasonal-sample');else if(sn<8)limit(7,'limited-seasonal-sample');
        if(vn<5)limit(6,'short-validation');
        if(vn&&(v.successes/vn<=.5||!Number.isFinite(v.median)||(candidate.direction==='up'?v.median<=0:v.median>=0)))limit(5.5,'validation-disagrees');
        if(sn&&(s.successes/sn<=.5||!Number.isFinite(s.median)||(candidate.direction==='up'?s.median<=0:s.median>=0)))limit(5.5,'seasonal-disagrees');
        // A gradual ceiling distinguishes 0/1/6 similar years without treating any as sufficient.
        if(!currentCot)limit(6,'no-current-cot');else if(cn<8)limit(6+cn/8,'limited-cot-sample');
        if(currentCot&&cn>=8&&(c.successes/cn<=.5||!Number.isFinite(c.median)||(candidate.direction==='up'?c.median<=0:c.median>=0)))limit(6.5,'cot-disagrees');
        if(!pricesFresh)limit(5,'stale-prices');
        if(!snapshotFresh)limit(5,'stale-snapshot');
        const ceiling=Math.min(10,...limits.map(l=>l.max)),uncapped=Math.round(raw*10)/10;
        const value=Math.round(clamp(Math.min(raw,ceiling),1,10)*10)/10;
        return {version:'research-priority-v1',value,uncapped,ceiling,label:label(value),components,limits,
            capped:raw>ceiling,coverage,currentCot,pricesFresh,snapshotFresh};
    }
    return {rank,weights,damped,label};
}));
