export const MIN_PREVIEW_ZOOM=.25,MAX_PREVIEW_ZOOM=16;

// CSS transforms apply only to the preview artboard. Banner values, undo history
// and exported canvases never receive this navigation state.
export function setupPreviewNavigation({canvas,artboard,viewport,zoomIn,zoomOut,resetButton,readout}){
  const doc=canvas.ownerDocument,win=doc.defaultView;
  let zoom=1,x=0,y=0,space=false,hover=false,pan=null;
  function update(){
    artboard.style.transform=`translate(${x}px, ${y}px) scale(${zoom})`;
    readout.textContent=Math.round(zoom*100)+'%';
    zoomIn.disabled=zoom>=MAX_PREVIEW_ZOOM;zoomOut.disabled=zoom<=MIN_PREVIEW_ZOOM;
    resetButton.disabled=zoom===1&&x===0&&y===0;
    viewport.classList.toggle('preview-pan-ready',space);
    viewport.classList.toggle('preview-panning',!!pan);
  }
  function zoomAt(factor,clientX,clientY){
    const next=Math.max(MIN_PREVIEW_ZOOM,Math.min(MAX_PREVIEW_ZOOM,zoom*factor));
    const rect=canvas.getBoundingClientRect(),ratio=next/zoom;
    x+=(clientX-(rect.left+rect.width/2))*(1-ratio);
    y+=(clientY-(rect.top+rect.height/2))*(1-ratio);
    zoom=next;update();
  }
  function zoomFromCentre(factor){const r=viewport.getBoundingClientRect();zoomAt(factor,r.left+r.width/2,r.top+r.height/2);}
  function endPan(){
    if(pan&&viewport.hasPointerCapture(pan.id))viewport.releasePointerCapture(pan.id);
    pan=null;update();
  }
  function reset(){endPan();zoom=1;x=y=0;update();}
  viewport.addEventListener('wheel',event=>{
    if(!event.ctrlKey&&!event.metaKey)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(pan)return;
    const unit=event.deltaMode===1?16:event.deltaMode===2?viewport.clientHeight:1;
    zoomAt(Math.exp(-event.deltaY*unit*.0015),event.clientX,event.clientY);
  },{capture:true,passive:false});
  viewport.addEventListener('pointerenter',()=>{hover=true;});
  viewport.addEventListener('pointerleave',()=>{hover=false;});
  viewport.addEventListener('pointerdown',event=>{
    if(event.button!==1&&!(event.button===0&&space))return;
    event.preventDefault();event.stopImmediatePropagation();
    pan={id:event.pointerId,clientX:event.clientX,clientY:event.clientY,x,y};
    viewport.setPointerCapture(event.pointerId);canvas.focus({preventScroll:true});update();
  },true);
  viewport.addEventListener('pointermove',event=>{
    if(!pan||event.pointerId!==pan.id)return;
    event.preventDefault();event.stopImmediatePropagation();
    x=pan.x+event.clientX-pan.clientX;y=pan.y+event.clientY-pan.clientY;update();
  },true);
  for(const type of ['pointerup','pointercancel','lostpointercapture'])viewport.addEventListener(type,event=>{
    if(!pan||event.pointerId!==pan.id)return;
    event.preventDefault();event.stopImmediatePropagation();endPan();
  },true);
  viewport.addEventListener('auxclick',event=>{if(event.button===1)event.preventDefault();});
  doc.addEventListener('keydown',event=>{
    if(event.target.closest?.('input,textarea,select,[contenteditable="true"]')||doc.querySelector('dialog[open]'))return;
    if(!hover&&doc.activeElement!==canvas&&!pan&&!event.target.closest?.('.preview-navigation'))return;
    if((event.ctrlKey||event.metaKey)&&event.key==='0'){event.preventDefault();event.stopImmediatePropagation();reset();}
    else if(event.code==='Space'&&!event.ctrlKey&&!event.metaKey&&!event.target.closest?.('button')){event.preventDefault();space=true;update();}
  },true);
  doc.addEventListener('keyup',event=>{if(event.code==='Space'){space=false;update();}},true);
  win.addEventListener('blur',()=>{space=false;endPan();});
  zoomIn.onclick=()=>zoomFromCentre(1.25);zoomOut.onclick=()=>zoomFromCentre(1/1.25);resetButton.onclick=reset;
  update();
  return {reset};
}
