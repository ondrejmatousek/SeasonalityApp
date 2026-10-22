// Display-only timezone. All provider bars and coordinates remain in UTC.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.MarketChartTime=factory();})(typeof globalThis==='object'?globalThis:this,()=>{
 'use strict';const timeZone='Europe/Prague';
 const instant=value=>typeof value==='number'?new Date(value*1000):typeof value==='string'?new Date(value.includes('T')?value:value+'T00:00:00Z'):new Date(Date.UTC(value.year,value.month-1,value.day));
 const formatter=new Intl.DateTimeFormat('cs-CZ',{timeZone,year:'2-digit',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZoneName:'shortOffset'});
 function format(value){return formatter.format(instant(value))+' · Praha';}
 const formats=[{year:'numeric'},{month:'short'},{day:'numeric',month:'numeric'},{hour:'2-digit',minute:'2-digit',hourCycle:'h23'},{hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}].map(options=>new Intl.DateTimeFormat('cs-CZ',{timeZone,...options}));
 // Lightweight Charts TickMarkType: Year=0, Month=1, DayOfMonth=2, Time=3, TimeWithSeconds=4.
 function tick(value,type){return (formats[type]||formats[3]).format(instant(value));}
 return {timeZone,format,tick};
});
