import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) { c ^= b; for (let i=0;i<8;i++) c=(c>>>1)^((c&1)?0xedb88320:0); }
  return (c^0xffffffff)>>>0;
}
function chunk(type,data) {
  const name=Buffer.from(type), length=Buffer.alloc(4), crc=Buffer.alloc(4);
  length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name,data])));
  return Buffer.concat([length,name,data,crc]);
}
const segments=[[23,12,41,12],[27,12,27,29],[27,29,14,46],[14,46,17,51],[17,51,47,51],[47,51,50,46],[50,46,37,29],[37,29,37,12],[21,39,43,39]];
function distance(x,y,[a,b,c,d]) {
  const t=Math.max(0,Math.min(1,((x-a)*(c-a)+(y-b)*(d-b))/((c-a)**2+(d-b)**2)));
  return Math.hypot(x-a-t*(c-a),y-b-t*(d-b));
}
for (const size of [180,192,512]) {
  const raw=Buffer.alloc(size*(1+size*3));
  for(let y=0;y<size;y++) for(let x=0;x<size;x++){
    const px=(x+.5)*80/size-8,py=(y+.5)*80/size-8;
    const d=Math.min(...segments.map(s=>distance(px,py,s)));
    const alpha=Math.max(0,Math.min(1,(2-d)*size/80+.5));
    const offset=y*(1+size*3)+1+x*3;
    [20,27,33].forEach((v,i)=>raw[offset+i]=Math.round(v+alpha*([130,177,255][i]-v)));
  }
  const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=2;
  writeFileSync(new URL('../dist/app-icon-'+size+'.png',import.meta.url),Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),chunk("IDAT",deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]));
}
