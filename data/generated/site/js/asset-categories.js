(function(root,factory){
    const categories=factory();
    if(typeof module==='object'&&module.exports)module.exports=categories;
    else root.AssetCategories=categories;
}(typeof globalThis==='object'?globalThis:this,function(){
    const classes={all:'Všechny trhy',index:'Indexy',commodity:'Komodity',forex:'Forex',etf:'ETF',crypto:'Krypto',equity:'Akcie'};
    const groups={all:'Všechny komodity',livestock:'Maso a dobytek',dairy:'Mléčné produkty',grains:'Obiloviny a olejniny',softs:'Zemědělské komodity',metals:'Kovy',energy:'Energie',wood:'Dřevo'};
    function matches(asset,assetClass='all',commodityGroup='all'){
        return (assetClass==='all'||asset.assetClass===assetClass)
            && (assetClass!=='commodity'||commodityGroup==='all'||asset.commodityGroup===commodityGroup);
    }
    function label(assetClass='all',commodityGroup='all'){
        return assetClass==='commodity'&&commodityGroup!=='all'?`${classes.commodity} · ${groups[commodityGroup]}`:classes[assetClass];
    }
    return {classes,groups,matches,label};
}));
