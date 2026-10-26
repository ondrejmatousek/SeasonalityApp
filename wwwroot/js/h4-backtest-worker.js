'use strict';
importScripts('market-candles.js','trade-zones.js','fm-order-blocks.js','fm-trade-zones.js','h4-paper.js','backtest-sha256.js','h4-backtest.js');
onmessage=async({data})=>{
 try{
  if(!/^\/data\/screener\/zone-prices\.[a-f0-9]{20}\.json$/.test(data.path))throw Error('Neplatný zdroj H4.');
  const response=await fetch(data.path);if(!response.ok)throw Error('H4 HTTP '+response.status);const text=await response.text();
  const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');
  if(!data.path.includes(sha256.slice(0,20)))throw Error('Hash cenového snapshotu nesouhlasí.');
  const result=H4Backtest.run({...data,snapshot:JSON.parse(text),sha256},progress=>postMessage({kind:'progress',progress}));
  postMessage({kind:'result',result});
 }catch(e){postMessage({kind:'error',message:e.message});}
};
