(() => {
    const root=document.querySelector('.seasonality-page'),type=document.getElementById('screener-asset-class');
    if(!root||!type)return;
    const group=document.getElementById('screener-commodity-group'),label=document.getElementById('screener-commodity-group-label');
    function changed(){
        label.hidden=type.value!=='commodity';
        root.dispatchEvent(new CustomEvent('screener-market-filter-change'));
    }
    type.addEventListener('change',changed);group.addEventListener('change',changed);changed();
})();
