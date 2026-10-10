(function(root,factory){
    const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.OpportunitySorting=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
    const defaults={instrument:'asc',score:'desc',date:'asc',direction:'asc',validation:'desc','cot-rate':'desc',adverse:'asc',note:'asc',training:'desc',cot:'desc'};
    function selection(value){const [field,order]=value.split(':');return {field,direction:order||defaults[field]||'desc'};}
    function comparator(value,history,note){
        const {field,direction}=selection(value),sign=direction==='asc'?1:-1;
        function metric(row){
            const h=row.c.histories?.[history];
            switch(field){
                case 'instrument':return row.a.key;
                case 'score':return row.r.value;
                case 'date':return row.c.startsIn;
                case 'direction':return row.c.direction;
                case 'validation':return h?.seasonal.count>=8?h.seasonal.rate:null;
                case 'cot-rate':return h?.cot.count>=8?h.cot.rate:null;
                case 'cot':return h?.cot.count>=8?h.cot.uncertainty?.[0]:null;
                case 'adverse':return h?.seasonal.medianAdverse;
                case 'note':return note(row.a,row.c);
                default:return row.c.score;
            }
        }
        const missing=x=>x==null||(typeof x==='number'&&!Number.isFinite(x));
        return (x,y)=>{
            const a=metric(x),b=metric(y),am=missing(a),bm=missing(b);
            if(am!==bm)return am?1:-1;
            const difference=am?0:typeof a==='string'?a.localeCompare(b,'cs'):a-b;
            return difference*sign||(field==='score'?y.r.uncapped-x.r.uncapped:0)||x.c.startsIn-y.c.startsIn||x.a.key.localeCompare(y.a.key)||x.c.direction.localeCompare(y.c.direction);
        };
    }
    return {defaults,selection,comparator};
});
