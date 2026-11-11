// Headless banner renderer for CLI/AI workflows. Mirrors public/renderer.mjs:
// same shader colour rules, mesh-weight backgrounds and 1528-unit transform,
// so a proposal can be previewed without opening the editor window.
import path from 'node:path';
import sharp from 'sharp';
import {decode} from './public/banner-code.mjs';
import {BANNER_SIZE,BANNER_CENTRE} from './public/banner-space.mjs';

const MASK_SIZE=384;

export function rasterizeBackground(meshes,size=512){
  const out={width:size,height:size,data:new Uint8ClampedArray(size*size*4)};
  const all=meshes.flatMap(m=>m.positions),xs=all.map(v=>v[0]),ys=all.map(v=>v[1]);
  const xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(...ys),ymax=Math.max(...ys);
  for(const mesh of meshes){
    const vertices=mesh.positions.map(([x,y],i)=>[(x-xmin)/(xmax-xmin)*size,(ymax-y)/(ymax-ymin)*size,(mesh.colors[i]?.[0]??255)/255,(mesh.colors[i]?.[3]??255)/255]);
    for(let i=0;i<mesh.indices.length;i+=3){
      const [a,b,c]=mesh.indices.slice(i,i+3).map(k=>vertices[k]);
      const det=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(!det)continue;
      const left=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0]))),right=Math.min(size,Math.ceil(Math.max(a[0],b[0],c[0])));
      const top=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1]))),bottom=Math.min(size,Math.ceil(Math.max(a[1],b[1],c[1])));
      for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){
        const wa=((b[1]-c[1])*(x+.5-c[0])+(c[0]-b[0])*(y+.5-c[1]))/det,wb=((c[1]-a[1])*(x+.5-c[0])+(a[0]-c[0])*(y+.5-c[1]))/det,wc=1-wa-wb;
        if(wa<-.00001||wb<-.00001||wc<-.00001)continue;
        const j=(y*size+x)*4;out.data[j]=255*(wa*a[2]+wb*b[2]+wc*c[2]);out.data[j+3]=255*(wa*a[3]+wb*b[3]+wc*c[3]);
      }
    }
  }
  return out;
}
const rgb=hex=>[1,3,5].map(i=>parseInt(String(hex||'#adbeef').slice(i,i+2),16));
export function tint(raw,{main,second,stroke=0,background=false,alphaTest=null}){
  const out=new Uint8ClampedArray(raw.data.length);
  for(let j=0;j<raw.data.length;j+=4){
    const r=raw.data[j]/255,g=raw.data[j+1]/255,a=raw.data[j+3]/255,alpha=background?a:a*(stroke*r+g);
    for(let k=0;k<3;k++)out[j+k]=background?main[k]*r+second[k]*(1-r):second[k]*r+main[k]*g;
    out[j+3]=!background&&alphaTest!=null&&alpha<alphaTest?0:alpha*255;
  }
  return {width:raw.width,height:raw.height,data:out};
}
// Inverse-maps each output pixel into the layer image (bilinear) and composites source-over.
export function drawLayer(target,size,image,layer,span=BANNER_SIZE){
  const scale=size/span,offset=size/2-BANNER_CENTRE*scale;
  const angle=layer.rotation*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle);
  const w=layer.width||1,h=layer.height||1,reach=Math.hypot(w,h)/2;
  const x0=Math.max(0,Math.floor((layer.x-reach)*scale+offset)),x1=Math.min(size,Math.ceil((layer.x+reach)*scale+offset));
  const y0=Math.max(0,Math.floor((layer.y-reach)*scale+offset)),y1=Math.min(size,Math.ceil((layer.y+reach)*scale+offset));
  const {width:iw,height:ih,data}=image;
  const sample=(x,y,c)=>data[(y*iw+x)*4+c];
  for(let py=y0;py<y1;py++)for(let px=x0;px<x1;px++){
    const bx=(px+.5-offset)/scale,by=(py+.5-offset)/scale,dx=bx-layer.x,dy=by-layer.y;
    let u=dx*cos-dy*sin,v=dx*sin+dy*cos;if(layer.mirror)u=-u;
    const fx=(u/w+.5)*iw-.5,fy=(v/h+.5)*ih-.5;
    if(fx<-.5||fy<-.5||fx>iw-.5||fy>ih-.5)continue;
    const xa=Math.max(0,Math.min(iw-1,Math.floor(fx))),ya=Math.max(0,Math.min(ih-1,Math.floor(fy))),xb=Math.min(iw-1,xa+1),yb=Math.min(ih-1,ya+1);
    const tx=Math.max(0,Math.min(1,fx-xa)),ty=Math.max(0,Math.min(1,fy-ya));
    const weights=[[xa,ya,(1-tx)*(1-ty)],[xb,ya,tx*(1-ty)],[xa,yb,(1-tx)*ty],[xb,yb,tx*ty]];
    let a=0;const col=[0,0,0];
    for(const [sx,sy,wt] of weights){const sa=sample(sx,sy,3)/255*wt;a+=sa;for(let c=0;c<3;c++)col[c]+=sample(sx,sy,c)*sa;}
    if(a<=0)continue;
    const j=(py*size+px)*4,da=target[j+3]/255,oa=a+da*(1-a);
    for(let c=0;c<3;c++)target[j+c]=(col[c]+target[j+c]*da*(1-a))/oa;
    target[j+3]=oa*255;
  }
}
export function createBannerRenderer({library,assets,dataRoot}){
  const icons=new Map(library.icons.map(i=>[i.id,i])),backgrounds=new Map(library.backgrounds.map(b=>[b.id,b])),colors=new Map(library.colors.map(c=>[c.id,c]));
  const masks=new Map(),bgMasks=new Map(),atlases=new Map();
  const textureFile=material=>{const texture=assets.textures[assets.materials[material]?.slots?.['0']],image=texture?.images?.[0];return image?path.join(dataRoot,image.slice(1)):null;};
  // Decoded atlases are large (64 MB at 4K); keep only the few most recent.
  function atlas(file){
    if(atlases.has(file)){const hit=atlases.get(file);atlases.delete(file);atlases.set(file,hit);return hit;}
    const promise=sharp(file,{limitInputPixels:false}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    atlases.set(file,promise);while(atlases.size>3)atlases.delete(atlases.keys().next().value);return promise;
  }
  async function iconMask(id,size=MASK_SIZE){
    const key=id+':'+size;if(masks.has(key))return masks.get(key);
    const icon=icons.get(id),file=icon&&textureFile(icon.material);if(!file)throw new Error('Symbol artwork is unavailable: '+id);
    const promise=(async()=>{const {data:full,info:meta}=await atlas(file),cell=meta.width/4;
      const {data,info}=await sharp(full,{raw:{width:meta.width,height:meta.height,channels:4}}).extract({left:icon.index%4*cell,top:Math.floor(icon.index/4)*cell,width:cell,height:cell}).resize(size,size).raw().toBuffer({resolveWithObject:true});
      return {width:info.width,height:info.height,data};})();
    masks.set(key,promise);promise.catch(()=>masks.delete(key));return promise;
  }
  function backgroundMask(id){
    if(!bgMasks.has(id)){const meshes=assets.meshes[backgrounds.get(id)?.mesh];if(!meshes)throw new Error('Background mesh unavailable: '+id);bgMasks.set(id,rasterizeBackground(meshes));}
    return bgMasks.get(id);
  }
  const hex=id=>colors.get(id)?.hex;
  // crop: visible span in banner units centred on 764 — 512 is the in-game emblem area, 'full' the whole 1528 canvas.
  async function render(code,{size=768,shape='square',background='#1b1d22',crop='full'}={}){
    const span=crop==='full'||crop==null?BANNER_SIZE:Number(crop);if(!(span>0))throw new Error('Invalid crop: '+crop);
    const layers=typeof code==='string'?decode(code):code,target=new Uint8ClampedArray(size*size*4),warnings=[];
    for(const [i,layer] of layers.entries()){
      try{
        if(!colors.has(layer.colorId)||!colors.has(layer.colorId2))warnings.push('Layer '+i+': unknown colour id '+[layer.colorId,layer.colorId2].filter(c=>!colors.has(c)).join(', '));
        const material=i?assets.materials[icons.get(layer.meshId)?.material]:null;
        const raw=i===0?backgroundMask(layer.meshId):await iconMask(layer.meshId);
        drawLayer(target,size,tint(raw,{main:rgb(hex(layer.colorId)),second:rgb(hex(layer.colorId2)),stroke:layer.stroke,background:i===0,alphaTest:material?.flags?.includes('alpha_test')?material.alphaTest:null}),layer,span);
      }catch(error){warnings.push('Layer '+i+': '+error.message);}
    }
    if(shape==='shield'){const r=size*.47;for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(Math.hypot(x+.5-size/2,y+.5-size/2)>r)target[(y*size+x)*4+3]=0;}
    const png=await sharp(Buffer.from(target),{raw:{width:size,height:size,channels:4}}).flatten({background}).png().toBuffer();
    return {png,warnings};
  }
  // Monochrome preview cell (fill white, stroke grey) used for contact sheets.
  async function iconPreview(id,size=160){
    const raw=await iconMask(id,size),out=Buffer.alloc(size*size*4);
    for(let j=0;j<raw.data.length;j+=4){const r=raw.data[j]/255,g=raw.data[j+1]/255,a=raw.data[j+3]/255;out[j]=out[j+1]=out[j+2]=Math.round(255*(g+r*.45)/Math.max(.001,g+r));out[j+3]=Math.round(255*a*Math.min(1,r+g));}
    return {width:size,height:size,data:out};
  }
  return {render,iconMask,iconPreview,icons,colors};
}
