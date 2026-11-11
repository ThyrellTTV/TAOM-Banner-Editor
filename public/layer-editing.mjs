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
// Resize box for edge/corner handles: the layer's own rotated box for one layer, the group's
// axis-aligned bounds for several. Local u-axis is (cos,-sin) on screen, v-axis (sin,cos).
export function resizeFrame(layers,indices){
  if(indices.length===1){const l=layers[indices[0]];return {x:l.x,y:l.y,width:Math.abs(l.width),height:Math.abs(l.height),rotation:l.rotation};}
  const b=selectionBounds(layers,indices);return {x:b.x,y:b.y,width:b.width,height:b.height,rotation:0};
}
const toLocal=(frame,dx,dy)=>{const a=frame.rotation*Math.PI/180;return {u:dx*Math.cos(a)-dy*Math.sin(a),v:dx*Math.sin(a)+dy*Math.cos(a)};};
export function resizeHandleAt(frame,x,y,tolerance){
  const {u,v}=toLocal(frame,x-frame.x,y-frame.y),hw=frame.width/2,hh=frame.height/2;
  const near=(value,half)=>{const d=Math.abs(value)-half;return d<=tolerance&&d>=-Math.min(tolerance,half/2);};
  const onU=near(u,hw),onV=near(v,hh);
  if(onU&&onV)return {hx:Math.sign(u)||1,hy:Math.sign(v)||1};
  if(onU&&Math.abs(v)<=hh)return {hx:Math.sign(u)||1,hy:0};
  if(onV&&Math.abs(u)<=hw)return {hx:0,hy:Math.sign(v)||1};
  return null;
}
// Screen direction of a handle, as a CSS resize cursor.
export function resizeCursor(frame,handle){
  const a=frame.rotation*Math.PI/180,sx=handle.hx*Math.cos(a)+handle.hy*Math.sin(a),sy=-handle.hx*Math.sin(a)+handle.hy*Math.cos(a);
  const step=((Math.round(Math.atan2(sy,sx)/(Math.PI/4))%4)+4)%4;return ['ew-resize','nwse-resize','ns-resize','nesw-resize'][step];
}
// Edge handles resize one axis, corner handles scale both axes by the same factor; the opposite
// edge/corner stays fixed. `origin` is a copy of the layers when the drag started, (dx,dy) the pointer movement.
export function resizeLayers(origin,layers,indices,frame,handle,dx,dy,{min=1,max=8000}={}){
  const {u,v}=toLocal(frame,dx,dy),w=frame.width||1,h=frame.height||1;
  let fx=1,fy=1;
  if(handle.hx&&handle.hy){const f=1+(handle.hx*w*u+handle.hy*h*v)/(w*w+h*h);fx=fy=f;}
  else if(handle.hx)fx=1+handle.hx*u/w;else fy=1+handle.hy*v/h;
  const range=(axis,f)=>{if(f===1)return 1;const sizes=indices.map(i=>Math.abs(origin[i][axis])||1);return Math.min(Math.min(...sizes.map(s=>max/s)),Math.max(Math.max(...sizes.map(s=>min/s)),f));};
  if(handle.hx&&handle.hy){const lo=Math.max(...indices.flatMap(i=>[min/(Math.abs(origin[i].width)||1),min/(Math.abs(origin[i].height)||1)])),hi=Math.min(...indices.flatMap(i=>[max/(Math.abs(origin[i].width)||1),max/(Math.abs(origin[i].height)||1)]));fx=fy=Math.min(hi,Math.max(lo,fx));}
  else{fx=range('width',fx);fy=range('height',fy);}
  const a=frame.rotation*Math.PI/180,cos=Math.cos(a),sin=Math.sin(a),toWorld=(lu,lv)=>({x:lu*cos+lv*sin,y:-lu*sin+lv*cos});
  const anchor=toWorld(-handle.hx*w/2,-handle.hy*h/2);anchor.x+=frame.x;anchor.y+=frame.y;
  for(const i of indices){const o=origin[i],l=layers[i];
    const rel=toLocal(frame,o.x-anchor.x,o.y-anchor.y),moved=toWorld(rel.u*fx,rel.v*fy);
    l.x=Math.round(anchor.x+moved.x);l.y=Math.round(anchor.y+moved.y);
    l.width=Math.round(o.width*fx)||Math.sign(o.width)||1;l.height=Math.round(o.height*fy)||Math.sign(o.height)||1;}
  return {fx,fy};
}
// Rotation zone: just outside a corner of the resize box (beyond the resize handle, within `reach`).
export function rotateHandleAt(frame,x,y,tolerance,reach=tolerance*3.5){
  const {u,v}=toLocal(frame,x-frame.x,y-frame.y),hw=frame.width/2,hh=frame.height/2;
  if(Math.abs(u)<=hw&&Math.abs(v)<=hh)return null;
  const hx=Math.sign(u)||1,hy=Math.sign(v)||1;return Math.hypot(u-hx*hw,v-hy*hh)<=reach?{hx,hy}:null;
}
// Screen angle of a point around the frame centre, counter-clockwise like layer rotation.
export function pointerAngle(frame,x,y){return Math.atan2(frame.y-y,x-frame.x)*180/Math.PI;}
// Rotates from the drag-start copy so repeated moves never accumulate rounding; `snap` rounds the primary layer's final angle.
export function rotateFromOrigin(origin,layers,indices,degrees,{primary=indices[0],snap=0}={}){
  let delta=((degrees%360)+540)%360-180;
  if(snap>0){const base=origin[primary].rotation;delta=Math.round((base+delta)/snap)*snap-base;}
  delta=Math.round(delta);
  for(const i of indices){layers[i].x=origin[i].x;layers[i].y=origin[i].y;layers[i].rotation=origin[i].rotation;}
  rotateLayers(layers,indices,delta);
  for(const i of indices)layers[i].rotation=((layers[i].rotation%360)+360)%360;
  return delta;
}
// Mirror image of a layer across the canvas centre line: axis 'x' swaps left/right, 'y' swaps top/bottom.
// Reflection flips the mesh and negates its rotation; a vertical reflection is that plus a half turn.
export function reflectLayer(layer,axis='x',centre=764){
  const copy={...layer,mirror:1-layer.mirror};
  if(axis==='x'){copy.x=Math.round(2*centre-layer.x);copy.rotation=((360-layer.rotation)%360+360)%360;}
  else{copy.y=Math.round(2*centre-layer.y);copy.rotation=((540-layer.rotation)%360+360)%360;}
  return copy;
}
