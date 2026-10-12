const fs=require('node:fs'),path=require('node:path'),{pilot,bootstrap}=require('./twelve-data-adapter.cjs'),{pack}=require('./twelve-pilot-bundle.cjs');
async function run(root,publicFile,out){
    if(!process.env.TWELVE_DATA_API_KEY)throw Error('TWELVE_DATA_API_KEY is not configured');
    if(!path.resolve(out).startsWith(path.resolve('artifacts')+path.sep)||path.resolve(root)===path.resolve(out))throw Error('Separate private artifact output required');
    const publicKey=fs.readFileSync(publicFile),start=Date.now(),results=[];
    fs.mkdirSync(out,{recursive:true});
    try{for(const key of pilot){try{let state;do{try{state=await bootstrap(root,key);console.log(JSON.stringify(state));}catch(e){if(e.message.startsWith('Minute audit budget reached')){console.log('Pilot waits for its per-minute credit budget.');await new Promise(r=>setTimeout(r,10000));}else throw e;}if(Date.now()-start>10*60000)throw Error('Pilot time budget exceeded; retained evidence can be resumed');}while(!state?.historyFetchComplete);
        const series=JSON.parse(fs.readFileSync(path.join(root,key,'series.json')));results.push({key,status:'history-fetched',firstDate:series.firstDate,lastDate:series.lastDate,bars:series.count,pages:state.pages,covers2006To2025:series.covers2006To2025,timezone:series.metadata.exchangeTimezone||null,sessionVerified:false,activationAllowed:false,missingWeekdays:series.flags.missingWeekdays.length,outliers:series.flags.outliers.length,weekendDates:series.flags.weekendDates.length,excludedCurrent:series.flags.excludedCurrent.length});
    }catch(e){results.push({key,status:'failed',error:e.message});console.log(JSON.stringify({key,status:'failed',error:e.message}));}}
    }finally{
        fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify({asOf:new Date().toISOString(),live:true,productionChanged:false,results},null,2));
        if(fs.existsSync(root))fs.writeFileSync(path.join(out,'evidence.encrypted.json'),JSON.stringify(pack(root,publicKey)));
    }
    console.log(JSON.stringify({completed:results.filter(r=>r.status==='history-fetched').length,failed:results.filter(r=>r.status==='failed').length,productionChanged:false}));
    if(results.some(r=>r.status==='failed'))process.exitCode=1;
}
module.exports={run};
if(require.main===module)run(...process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});
