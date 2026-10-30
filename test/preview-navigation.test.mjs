import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setupPreviewNavigation} from '../public/preview-navigation.mjs';
import {canvasToBanner} from '../public/banner-space.mjs';

function fixture(){
  const viewport=new EventTarget(),doc=new EventTarget(),win=new EventTarget();
  const captures=new Set(),classes=new Set(),artboard={style:{}};
  viewport.classList={toggle:(name,on)=>on?classes.add(name):classes.delete(name)};
  viewport.clientHeight=300;viewport.getBoundingClientRect=()=>({left:0,top:0,width:400,height:300});
  viewport.setPointerCapture=id=>captures.add(id);viewport.hasPointerCapture=id=>captures.has(id);viewport.releasePointerCapture=id=>captures.delete(id);
  doc.defaultView=win;doc.querySelector=()=>null;
  const canvas={ownerDocument:doc,focus:()=>{doc.activeElement=canvas;},getBoundingClientRect:()=>{
    const [,x,y,zoom]=artboard.style.transform.match(/translate\(([-\d.e+]+)px, ([-\d.e+]+)px\) scale\(([-\d.e+]+)\)/).map(Number);
    return {left:200+x-100*zoom,top:150+y-100*zoom,width:200*zoom,height:200*zoom};
  }};
  const zoomIn={},zoomOut={},resetButton={},readout={};
  const navigation=setupPreviewNavigation({canvas,artboard,viewport,zoomIn,zoomOut,resetButton,readout});
  function fire(target,type,values={}){const event=new Event(type,{cancelable:true});Object.assign(event,values);target.dispatchEvent(event);return event;}
  return {viewport,doc,win,canvas,artboard,zoomIn,zoomOut,resetButton,readout,navigation,fire,classes,captures};
}

test('Ctrl+wheel zoom is anchored at the pointer and never reaches layer resizing',()=>{
  const f=fixture();let resizeEvents=0;f.viewport.addEventListener('wheel',()=>resizeEvents++);
  const position=()=>{const r=f.canvas.getBoundingClientRect();return canvasToBanner(250-r.left,170-r.top,r.width,r.height);};
  const before=position();
  const event=f.fire(f.viewport,'wheel',{ctrlKey:true,deltaMode:0,deltaY:-120,clientX:250,clientY:170});
  assert.equal(event.defaultPrevented,true);assert.equal(resizeEvents,0);assert.notEqual(f.readout.textContent,'100%');
  const after=position();assert.ok(Math.abs(before.x-after.x)<1e-8&&Math.abs(before.y-after.y)<1e-8);
  f.fire(f.viewport,'wheel',{deltaMode:0,deltaY:-120,clientX:250,clientY:170});assert.equal(resizeEvents,1);
});

test('zoom buttons clamp the view, and Fit restores its original transform',()=>{
  const f=fixture();for(let i=0;i<100;i++)f.zoomIn.onclick();
  assert.equal(f.readout.textContent,'1600%');assert.equal(f.zoomIn.disabled,true);
  for(let i=0;i<100;i++)f.zoomOut.onclick();assert.equal(f.readout.textContent,'25%');assert.equal(f.zoomOut.disabled,true);
  f.resetButton.onclick();assert.equal(f.artboard.style.transform,'translate(0px, 0px) scale(1)');assert.equal(f.readout.textContent,'100%');assert.equal(f.resetButton.disabled,true);
});

test('middle-drag and Space+drag pan without passing through to layer editing',()=>{
  const f=fixture();let layerStarts=0;f.viewport.addEventListener('pointerdown',()=>layerStarts++);
  f.fire(f.viewport,'pointerdown',{button:1,pointerId:7,clientX:150,clientY:100});
  f.fire(f.viewport,'pointermove',{pointerId:7,clientX:190,clientY:80});
  assert.equal(layerStarts,0);assert.equal(f.artboard.style.transform,'translate(40px, -20px) scale(1)');assert.ok(f.classes.has('preview-panning'));
  f.fire(f.viewport,'pointerup',{pointerId:7});assert.equal(f.captures.size,0);assert.ok(!f.classes.has('preview-panning'));
  f.fire(f.doc,'keydown',{code:'Space',key:' '});
  f.fire(f.viewport,'pointerdown',{button:0,pointerId:8,clientX:190,clientY:80});
  f.fire(f.viewport,'pointermove',{pointerId:8,clientX:200,clientY:90});
  assert.equal(layerStarts,0);assert.equal(f.artboard.style.transform,'translate(50px, -10px) scale(1)');
  f.fire(f.win,'blur');assert.ok(!f.classes.has('preview-panning'));assert.ok(!f.classes.has('preview-pan-ready'));
  f.fire(f.viewport,'pointerdown',{button:0,pointerId:9,clientX:200,clientY:90});assert.equal(layerStarts,1);
});

test('Ctrl+0 resets navigation while the canvas is focused',()=>{
  const f=fixture();f.canvas.focus();f.zoomIn.onclick();
  assert.equal(f.fire(f.doc,'keydown',{ctrlKey:true,key:'0'}).defaultPrevented,true);
  assert.equal(f.readout.textContent,'100%');
});
