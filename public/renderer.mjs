import {BANNER_SIZE,EDITABLE_GUIDE_SIZE,bannerViewport,bannerToCanvas} from './banner-space.mjs';
import {selectionBounds} from './layer-editing.mjs';
export class BannerRenderer {
  constructor(library) {
    this.library=library;
    this.icons=new Map(library.icons.map(i=>[i.id,i]));
    this.backgrounds=new Map(library.backgrounds.map(i=>[i.id,i]));
    this.colors=new Map(library.colors.map(i=>[i.id,i]));
    this.masks=new Map(); this.tints=new Map(); this.backgroundMasks=new Map();
  }
  color(id) { return this.colors.get(id)?.hex || '#adbeef'; }
  rgb(id) { const h=this.color(id); return [1,3,5].map(i=>parseInt(h.slice(i,i+2),16)); }
  async mask(id) {
    if(!this.masks.has(id)&&this.masks.size>=128)this.masks.delete(this.masks.keys().next().value);
    if(!this.masks.has(id)) this.masks.set(id,(async()=>{
      const image=new Image(); image.src='/api/mask/'+id+'.png';
      await image.decode();
      const c=document.createElement('canvas'); c.width=image.width;c.height=image.height;
      const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
      return ctx.getImageData(0,0,c.width,c.height);
    })());
    return this.masks.get(id);
  }
  backgroundMask(id) {
    if(this.backgroundMasks.has(id)) return this.backgroundMasks.get(id);
    const meshes=this.library.assets.meshes[this.backgrounds.get(id)?.mesh];
    if(!meshes) throw new Error('Background mesh unavailable: '+id);
    const size=512, out=new ImageData(size,size);
    const all=meshes.flatMap(m=>m.positions);
    const xs=all.map(v=>v[0]),ys=all.map(v=>v[1]);
    const xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(...ys),ymax=Math.max(...ys);
    for(const mesh of meshes) {
      const vertices=mesh.positions.map(([x,y],i)=>[(x-xmin)/(xmax-xmin)*size,(ymax-y)/(ymax-ymin)*size,(mesh.colors[i]?.[0]??255)/255,(mesh.colors[i]?.[3]??255)/255]);
      for(let i=0;i<mesh.indices.length;i+=3) {
        const [a,b,c]=mesh.indices.slice(i,i+3).map(k=>vertices[k]);
        const det=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
        if(!det) continue;
        const left=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0]))),right=Math.min(size,Math.ceil(Math.max(a[0],b[0],c[0])));
        const top=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1]))),bottom=Math.min(size,Math.ceil(Math.max(a[1],b[1],c[1])));
        for(let y=top;y<bottom;y++) for(let x=left;x<right;x++) {
          const wa=((b[1]-c[1])*(x+.5-c[0])+(c[0]-b[0])*(y+.5-c[1]))/det;
          const wb=((c[1]-a[1])*(x+.5-c[0])+(a[0]-c[0])*(y+.5-c[1]))/det,wc=1-wa-wb;
          if(wa<-.00001||wb<-.00001||wc<-.00001) continue;
          const j=(y*size+x)*4;
          out.data[j]=255*(wa*a[2]+wb*b[2]+wc*c[2]);
          out.data[j+3]=255*(wa*a[3]+wb*b[3]+wc*c[3]);
        }
      }
    }
    this.backgroundMasks.set(id,out); return out;
  }
  async tinted(layer,background=false) {
    const key=[background?'bg':'icon',layer.meshId,layer.colorId,layer.colorId2,layer.stroke].join(':');
    if(this.tints.has(key)) return this.tints.get(key);
    const raw=background?this.backgroundMask(layer.meshId):await this.mask(layer.meshId);
    const canvas=document.createElement('canvas');canvas.width=raw.width;canvas.height=raw.height;
    const ctx=canvas.getContext('2d'),out=new ImageData(raw.width,raw.height);
    const main=this.rgb(layer.colorId),second=this.rgb(layer.colorId2);
    const icon=this.icons.get(layer.meshId),material=this.library.assets.materials[icon?.material];
    for(let j=0;j<raw.data.length;j+=4) {
      const r=raw.data[j]/255,g=raw.data[j+1]/255,a=raw.data[j+3]/255;
      const alpha=background?a:a*(layer.stroke*r+g);
      for(let k=0;k<3;k++) out.data[j+k]=background?main[k]*r+second[k]*(1-r):second[k]*r+main[k]*g;
      out.data[j+3]=!background && material?.flags?.includes('alpha_test') && alpha<material.alphaTest ? 0 : alpha*255;
    }
    ctx.putImageData(out,0,0);
    if(this.tints.size>=128) this.tints.delete(this.tints.keys().next().value);
    this.tints.set(key,canvas);return canvas;
  }
  async render(canvas,layers,{span=BANNER_SIZE,selected=-1,selection=[],snapLines={},grid=0,guides=false,shape='square'}={}) {
    const revision=canvas._revision=(canvas._revision||0)+1;
    const images=await Promise.all(layers.map((l,i)=>this.tinted(l,i===0).catch(()=>null)));
    if(canvas._revision!==revision) return;
    const ctx=canvas.getContext('2d');const w=canvas.width,h=canvas.height,view=bannerViewport(w,h,span),s=view.scale;
    ctx.clearRect(0,0,w,h);ctx.save();
    if(shape==='shield') {ctx.beginPath();ctx.arc(w/2,h/2,Math.min(w,h)*.47,0,Math.PI*2);ctx.closePath();ctx.clip();}
    else if(shape==='pennant') {ctx.beginPath();ctx.moveTo(w*.16,0);ctx.lineTo(w*.84,0);ctx.lineTo(w*.84,h*.82);ctx.lineTo(w*.5,h);ctx.lineTo(w*.16,h*.82);ctx.closePath();ctx.clip();}
    ctx.translate(view.left,view.top);ctx.scale(s,s);
    layers.forEach((l,i)=>{
      if(!images[i]) return;
      ctx.save();ctx.translate(l.x,l.y);ctx.rotate(-l.rotation*Math.PI/180);ctx.scale(l.mirror?-1:1,1);
      ctx.drawImage(images[i],-l.width/2,-l.height/2,l.width,l.height);ctx.restore();
    });ctx.restore();
    if(grid>0){
      const step=grid*Math.max(1,Math.ceil(6/(grid*s)));ctx.save();ctx.strokeStyle='#ffffff10';ctx.lineWidth=1;
      for(let value=Math.ceil(viewportStart(span)/step)*step;value<=viewportStart(span)+span;value+=step){const p=bannerToCanvas(value,value,w,h,span);ctx.beginPath();ctx.moveTo(p.x,0);ctx.lineTo(p.x,h);ctx.moveTo(0,p.y);ctx.lineTo(w,p.y);ctx.stroke();}ctx.restore();
    }
    if(guides) {
      ctx.save();ctx.strokeStyle='#ffffff22';ctx.lineWidth=1;ctx.setLineDash([5,6]);
      ctx.beginPath();ctx.moveTo(w/2,0);ctx.lineTo(w/2,h);ctx.moveTo(0,h/2);ctx.lineTo(w,h/2);ctx.stroke();ctx.restore();
      const guide=EDITABLE_GUIDE_SIZE*s;
      ctx.save();ctx.strokeStyle='#deb67688';ctx.setLineDash([5,6]);ctx.strokeRect((w-guide)/2,(h-guide)/2,guide,guide);
      if(w>=400&&span>EDITABLE_GUIDE_SIZE){ctx.fillStyle='#deb676';ctx.font='12px Segoe UI, sans-serif';ctx.fillText('512 guide',(w-guide)/2+7,(h-guide)/2+17);}
      ctx.restore();
    }
    const picks=selection.length?selection:selected>=0?[selected]:[];
    for(const index of picks)if(layers[index]) {
      const l=layers[index],position=bannerToCanvas(l.x,l.y,w,h,span);ctx.save();ctx.translate(position.x,position.y);ctx.rotate(-l.rotation*Math.PI/180);
      ctx.strokeStyle='#deb676';ctx.lineWidth=1.5;ctx.setLineDash([6,4]);ctx.strokeRect(-l.width*s/2,-l.height*s/2,l.width*s,l.height*s);
      ctx.setLineDash([]);ctx.fillStyle='#f3d49e';
      for(const x of [-1,1])for(const y of [-1,1])ctx.fillRect(x*l.width*s/2-3,y*l.height*s/2-3,6,6);
      ctx.restore();
    }
    if(picks.length>1){const box=selectionBounds(layers,picks),point=bannerToCanvas(box.left,box.top,w,h,span);ctx.save();ctx.strokeStyle='#8dc9db';ctx.setLineDash([3,4]);ctx.strokeRect(point.x,point.y,box.width*s,box.height*s);ctx.restore();}
    ctx.save();ctx.strokeStyle='#74dded';ctx.lineWidth=1.5;ctx.setLineDash([7,3]);
    if(Number.isFinite(snapLines.x)){const p=bannerToCanvas(snapLines.x,764,w,h,span);ctx.beginPath();ctx.moveTo(p.x,0);ctx.lineTo(p.x,h);ctx.stroke();}
    if(Number.isFinite(snapLines.y)){const p=bannerToCanvas(764,snapLines.y,w,h,span);ctx.beginPath();ctx.moveTo(0,p.y);ctx.lineTo(w,p.y);ctx.stroke();}ctx.restore();
  }
  hit(l,x,y) {
    const angle=l.rotation*Math.PI/180,dx=x-l.x,dy=y-l.y;
    let tx=dx*Math.cos(angle)-dy*Math.sin(angle),ty=dx*Math.sin(angle)+dy*Math.cos(angle);
    if(l.mirror)tx=-tx;
    return Math.abs(tx)<=Math.abs(l.width)/2&&Math.abs(ty)<=Math.abs(l.height)/2;
  }
}
function viewportStart(span){return (BANNER_SIZE-span)/2;}
