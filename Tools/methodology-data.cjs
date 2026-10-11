const fs=require('node:fs'),path=require('node:path'),registry=require('../wwwroot/js/core-market-registry.js'),cot=require('../wwwroot/js/core-cot.js');
module.exports=function(directory,key){
    const root=path.resolve(directory),read=p=>JSON.parse(fs.readFileSync(path.join(root,p.replace(/^\//,'')),'utf8'));
    const manifest=read('data/manifest.json'),asset=manifest.assets.find(a=>a.key===key);if(!asset)throw Error('Unknown asset '+key);
    const prices=read(asset.prices.path).prices.map(([date,close])=>({date,close}));
    const mapping=registry.resolve(asset),markets=asset.cot.markets.map(m=>({...m,reports:read(manifest.contracts[m.contractCode].files['52']).reports}));
    const {reports,...market}=cot.market(mapping,markets,manifest.exportedAt);
    return {asset:{...asset,lastDate:asset.prices.lastDate,market,mapping},prices,reports,manifest};
};
