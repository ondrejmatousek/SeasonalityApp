// Synchronous SHA-256 for the unchanged paper engine's hash callback in a Worker.
// The downloaded snapshot is additionally verified with native Web Crypto.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.BacktestSha256=factory();})(typeof globalThis==='object'?globalThis:this,()=>{
 'use strict';
 const k=[],initial=[];for(let p=2;k.length<64;p++){let prime=true;for(let d=2;d*d<=p;d++)if(p%d===0){prime=false;break;}if(prime){if(initial.length<8)initial.push((Math.sqrt(p)%1*4294967296)>>>0);k.push((Math.cbrt(p)%1*4294967296)>>>0);}}
 const r=(x,n)=>(x>>>n)|(x<<(32-n));
 return text=>{
  const bytes=new TextEncoder().encode(text),length=Math.ceil((bytes.length+9)/64)*64,padded=new Uint8Array(length);padded.set(bytes);padded[bytes.length]=128;
  const view=new DataView(padded.buffer);view.setUint32(length-8,Math.floor(bytes.length/536870912));view.setUint32(length-4,bytes.length*8>>>0);
  const h=initial.slice(),w=new Uint32Array(64);
  for(let offset=0;offset<length;offset+=64){for(let i=0;i<16;i++)w[i]=view.getUint32(offset+i*4);for(let i=16;i<64;i++){const x=w[i-15],y=w[i-2];w[i]=(w[i-16]+(r(x,7)^r(x,18)^(x>>>3))+w[i-7]+(r(y,17)^r(y,19)^(y>>>10)))>>>0;}
   let [a,b,c,d,e,f,g,z]=h;for(let i=0;i<64;i++){const t1=(z+(r(e,6)^r(e,11)^r(e,25))+((e&f)^(~e&g))+k[i]+w[i])>>>0,t2=((r(a,2)^r(a,13)^r(a,22))+((a&b)^(a&c)^(b&c)))>>>0;z=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}[a,b,c,d,e,f,g,z].forEach((v,i)=>h[i]=(h[i]+v)>>>0);
  }return h.map(v=>v.toString(16).padStart(8,'0')).join('');
 };
});
