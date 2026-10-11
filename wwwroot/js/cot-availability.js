(function(root,factory){
    if(typeof module==='object'&&module.exports)module.exports=factory();
    else root.CotAvailability=factory();
}(typeof globalThis==='object'?globalThis:this,function(){
    // CFTC release 9147-25. Dates are conservatively available at next UTC midnight:
    // the source supplies a publication DAY, not an exact timestamp or vintage.
    const source='https://www.cftc.gov/PressRoom/PressReleases/9147-25';
    const published=Object.freeze({'2025-09-30':'2025-11-19','2025-10-07':'2025-11-21',
        '2025-10-14':'2025-11-25','2025-10-21':'2025-12-02','2025-10-28':'2025-12-05',
        '2025-11-04':'2025-12-09','2025-11-10':'2025-12-10','2025-11-18':'2025-12-12',
        '2025-11-25':'2025-12-15','2025-12-02':'2025-12-17','2025-12-09':'2025-12-19',
        '2025-12-16':'2025-12-23','2025-12-23':'2025-12-29'});
    const cutoff=date=>Date.parse(date.length===10?date+'T00:00:00Z':date);
    function metadata(report){
        const publication=published[report.date];
        // Derived FX states may become computable later than either raw publication.
        // Never backdate a derived state to its positions date's release schedule.
        if(publication&&!Number.isFinite(report.relativeCot))return {availableAt:new Date(cutoff(publication)+86400000).toISOString(),
            publicationDate:publication,availabilitySource:'verified-publication-day',source};
        const value=report.availableAt;
        if(!value||!Number.isFinite(cutoff(value))||cutoff(value)<cutoff(report.date))
            return {availableAt:null,availabilitySource:'unknown'};
        return {availableAt:value,availabilitySource:report.availabilitySource||'unknown'};
    }
    function known(reports,date){
        const end=cutoff(date);
        return reports.filter(r=>Number.isFinite(cutoff(r.date))).map(r=>({...r,...metadata(r)}))
            .filter(r=>r.availableAt&&cutoff(r.availableAt)<=end&&cutoff(r.date)<=end)
            .sort((a,b)=>a.date.localeCompare(b.date));
    }
    function latest(reports,date){return known(reports,date).at(-1)||null;}
    function indexAt(reports,report,date,group='commercial',lookback=52){
        if(!report)return null;
        // Relative FX states and synthetic fixtures do not carry raw futures positions.
        if(!Number.isFinite(report[group]?.net))return report[group]?.index??null;
        const window=known(reports,date).filter(r=>r.date<=report.date).slice(-lookback);
        if(window.length<lookback||window.some(r=>!Number.isFinite(r[group]?.net)))return null;
        const nets=window.map(r=>r[group].net),min=Math.min(...nets),max=Math.max(...nets);
        return min===max?null:Math.round(100*(report[group].net-min)/(max-min)*100)/100;
    }
    // Descriptive history from today's archive; not a publication/vintage reconstruction.
    function positionsKnown(reports,date){
        const end=cutoff(date);
        return reports.filter(r=>Number.isFinite(cutoff(r.date))&&cutoff(r.date)<=end)
            .map(r=>({...r,...metadata(r)})).sort((a,b)=>a.date.localeCompare(b.date));
    }
    function positionsIndexAt(reports,report,date,group='commercial',lookback=52){
        if(!report)return null;
        if(!Number.isFinite(report[group]?.net))return report[group]?.index??null;
        const window=positionsKnown(reports,date).filter(r=>r.date<=report.date).slice(-lookback);
        if(window.length<lookback||window.some(r=>!Number.isFinite(r[group]?.net)))return null;
        const values=window.map(r=>r[group].net),min=Math.min(...values),max=Math.max(...values);
        return min===max?null:Math.round(100*(report[group].net-min)/(max-min)*100)/100;
    }
    return {metadata,known,latest,indexAt,positionsKnown,positionsIndexAt,cutoff,published,source};
}));
