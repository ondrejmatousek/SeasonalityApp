importScripts('/js/market-candles.js'+self.location.search,'/js/trade-zones.js'+self.location.search,'/js/strategy-lab.js'+self.location.search);
self.onmessage=({data})=>{
 try{
  const prepared=StrategyLab.prepare(data.instrument),configs=StrategyLab.matrix(data.family).map(c=>({...c,...data.costs})),results=[];
  for(let i=0;i<configs.length;i++){
   const config=StrategyLab.settings(configs[i]),result=StrategyLab.run(prepared,config);
   const stress=StrategyLab.run(prepared,{...config,spreadBps:config.spreadBps*2,commissionBps:config.commissionBps*2,slippageBps:config.slippageBps*2,financingBpsPerDay:config.financingBpsPerDay*2});
   results.push({...result,stressMetrics:stress.metrics});self.postMessage({progress:i+1,total:configs.length});
  }
  self.postMessage({done:true,report:{schemaVersion:1,engineVersion:StrategyLab.version,provenance:data.provenance,researchOnly:true,selectionEligible:false,generatedAt:new Date().toISOString(),symbol:data.instrument.symbol,first:data.instrument.first,last:data.instrument.last,rawSha256:data.instrument.rawSha256,validation:data.instrument.validation,family:data.family,results}});
 }catch(e){self.postMessage({error:e.message});}
};
