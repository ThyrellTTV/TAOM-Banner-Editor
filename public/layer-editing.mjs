export function selectedIndices(layers,selection,primary=0){
  const values=[...new Set(selection||[primary])].filter(i=>Number.isInteger(i)&&i>=0&&i<layers.length).sort((a,b)=>a-b);
  return values.some(i=>i>0)?values.filter(i=>i>0):[0];
}
export function layerBounds(layer){
  const angle=layer.rotation*Math.PI/180,w=Math.abs(layer.width*Math.cos(angle))+Math.abs(layer.height*Math.sin(angle)),h=Math.abs(layer.width*Math.sin(angle))+Math.abs(layer.height*Math.cos(angle));
  return {left:layer.x-w/2,right:layer.x+w/2,top:layer.y-h/2,bottom:layer.y+h/2,x:layer.x,y:layer.y,width:w,height:h};
}
export function selectionBounds(layers,indices){
  const bounds=indices.map(i=>layerBounds(layers[i])),left=Math.min(...bounds.map(b=>b.left)),right=Math.max(...bounds.map(b=>b.right)),top=Math.min(...bounds.map(b=>b.top)),bottom=Math.max(...bounds.map(b=>b.bottom));
  return {left,right,top,bottom,x:(left+right)/2,y:(top+bottom)/2,width:right-left,height:bottom-top};
}
export function translateLayers(layers,indices,dx,dy){for(const i of indices){layers[i].x=Math.round(layers[i].x+dx);layers[i].y=Math.round(layers[i].y+dy);}}
export function scaleLayers(layers,indices,fx,fy=fx){
  const pivot=selectionBounds(layers,indices);for(const i of indices){const l=layers[i];l.x=Math.round(pivot.x+(l.x-pivot.x)*fx);l.y=Math.round(pivot.y+(l.y-pivot.y)*fy);l.width=Math.round(l.width*fx)||Math.sign(l.width)||1;l.height=Math.round(l.height*fy)||Math.sign(l.height)||1;}
}
export function rotateLayers(layers,indices,degrees){
  const pivot=selectionBounds(layers,indices),a=degrees*Math.PI/180;for(const i of indices){const l=layers[i],x=l.x-pivot.x,y=l.y-pivot.y;l.x=Math.round(pivot.x+x*Math.cos(a)+y*Math.sin(a));l.y=Math.round(pivot.y-x*Math.sin(a)+y*Math.cos(a));l.rotation+=degrees;}
}
export function mirrorLayers(layers,indices){const pivot=selectionBounds(layers,indices);for(const i of indices){const l=layers[i];l.x=Math.round(2*pivot.x-l.x);l.mirror=1-l.mirror;if(indices.length>1)l.rotation=-l.rotation;}}
export function alignLayers(layers,indices,axis,target='selection'){
  const bounds=selectionBounds(layers,indices),center=target==='canvas'?764:bounds[axis];
  if(target==='canvas'){translateLayers(layers,indices,axis==='x'?center-bounds.x:0,axis==='y'?center-bounds.y:0);}
  else for(const i of indices)layers[i][axis]=Math.round(center);
}
export function reorderLayers(layers,indices,delta,primary){
  const selected=new Set(indices.filter(i=>i>0).map(i=>layers[i])),active=layers[primary];
  if(delta>0){for(let i=layers.length-2;i>=1;i--)if(selected.has(layers[i])&&!selected.has(layers[i+1]))[layers[i],layers[i+1]]=[layers[i+1],layers[i]];}
  else for(let i=2;i<layers.length;i++)if(selected.has(layers[i])&&!selected.has(layers[i-1]))[layers[i-1],layers[i]]=[layers[i],layers[i-1]];
  return {selection:layers.flatMap((l,i)=>selected.has(l)?[i]:[]),selected:layers.indexOf(active)};
}
export function snapTranslation(layers,indices,dx,dy,{enabled=true,grid=0,threshold=8,guide512=false}={}){
  if(!enabled)return {dx:Math.round(dx),dy:Math.round(dy),guides:{}};
  const bounds=selectionBounds(layers,indices),selected=new Set(indices),targets={x:[0,764,1528],y:[0,764,1528]};
  if(guide512){targets.x.push(508,1020);targets.y.push(508,1020);}
  layers.forEach((layer,index)=>{if(index===0||selected.has(index))return;const b=layerBounds(layer);targets.x.push(b.left,b.x,b.right);targets.y.push(b.top,b.y,b.bottom);});
  const deltas={x:dx,y:dy},guides={};
  for(const axis of ['x','y']){
    const values=axis==='x'?[bounds.left+dx,bounds.x+dx,bounds.right+dx]:[bounds.top+dy,bounds.y+dy,bounds.bottom+dy];let best=null;
    for(const target of targets[axis])for(const value of values){const correction=target-value;if(Math.abs(correction)<=threshold&&(!best||Math.abs(correction)<Math.abs(best.correction)))best={correction,target};}
    if(grid>0){const value=bounds[axis]+deltas[axis],target=Math.round(value/grid)*grid,correction=target-value;if(Math.abs(correction)<=threshold&&(!best||Math.abs(correction)<Math.abs(best.correction)))best={correction,target};}
    if(best){deltas[axis]+=best.correction;guides[axis]=best.target;}
  }
  return {dx:Math.round(deltas.x),dy:Math.round(deltas.y),guides};
}
