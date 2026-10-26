'use strict';
importScripts('market-candles.js','trade-zones.js','fm-order-blocks.js','fm-trade-zones.js','h4-paper.js','backtest-sha256.js','h4-backtest.js','h4-history-format.js');
onmessage=async({data})=>{
 try{
  if(!/^\/data\/(?:screener\/zone-prices|backtesting\/h4-history-index)\.[a-f0-9]{20}\.json$/.test(data.path))throw Error('Neplatný zdroj H4.');
  const response=await fetch(data.path);if(!response.ok)throw Error('H4 HTTP '+response.status);const text=await response.text();
  const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');
  if(!data.path.includes(sha256.slice(0,20)))throw Error('Hash cenového snapshotu nesouhlasí.');
  const snapshot=JSON.parse(text),priceHashes={};
  if(snapshot.kind==='backtest-history-v1')for(const [keyIndex,key]of data.keys.entries()){
   const h=snapshot.prices[key]?.h4;if(!h||!new RegExp('^/data/backtesting/h4-'+key+'\\.[a-f0-9]{20}\\.json$').test(h.historyPath)||!/^\w{6}$/.test(key))throw Error('Neplatný soubor historie '+key);
   postMessage({kind:'progress',progress:{phase:'load',key,keyIndex,totalKeys:data.keys.length}});
   const r=await fetch(h.historyPath);if(!r.ok)throw Error('Historie '+key+' HTTP '+r.status);const raw=await r.text(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))].map(b=>b.toString(16).padStart(2,'0')).join('');
   if(hash!==h.sha256||!h.historyPath.includes(hash.slice(0,20)))throw Error('Hash historie nesouhlasí: '+key);
   const price=H4HistoryFormat.decode(JSON.parse(raw));if(price.symbol!==h.symbol||price.provider!=='OANDA'||price.bars.length!==h.count)throw Error('Identita/počet historie nesouhlasí: '+key);priceHashes[key]=hash;snapshot.prices[key]={h4:price};
  }
  const result=H4Backtest.run({...data,snapshot,sha256},progress=>postMessage({kind:'progress',progress}));result.source.priceHashes=priceHashes;
  postMessage({kind:'result',result});
 }catch(e){postMessage({kind:'error',message:e.message});}
};
