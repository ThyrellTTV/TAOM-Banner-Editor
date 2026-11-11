import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectedIndices,selectionBounds,translateLayers,scaleLayers,rotateLayers,mirrorLayers,alignLayers,reorderLayers,snapTranslation,layerBounds,resizeFrame,resizeHandleAt,resizeCursor,resizeLayers,rotateHandleAt,pointerAngle,rotateFromOrigin,reflectLayer} from '../public/layer-editing.mjs';
const layer=(x,y=764)=>({x,y,width:100,height:100,rotation:0,mirror:0});
test('group transforms preserve relative positions, signed sizes and the unselected background',()=>{
  const layers=[layer(764),layer(600),layer(800)],background=structuredClone(layers[0]);layers[2].width=-100;
  assert.deepEqual(selectedIndices(layers,[0,1,2,2,99]),[1,2]);translateLayers(layers,[1,2],64,-32);assert.equal(layers[2].x-layers[1].x,200);
  alignLayers(layers,[1,2],'y','canvas');assert.equal(selectionBounds(layers,[1,2]).y,764);
  scaleLayers(layers,[1,2],2);assert.equal(layers[2].width,-200);assert.equal(layers[2].x-layers[1].x,400);
  rotateLayers(layers,[1,2],90);assert.equal(layers[1].x,layers[2].x);assert.equal(layers[1].y-layers[2].y,400);
  mirrorLayers(layers,[1,2]);assert.equal(layers[1].mirror,1);assert.deepEqual(layers[0],background);
});
test('snapping aligns a group to canvas/other-layer guides, supports grid targets and can be bypassed',()=>{
  const layers=[layer(764),layer(600),layer(800),layer(1100)];
  const snapped=snapTranslation(layers,[1,2],61,0,{threshold:6});assert.equal(snapped.dx,64);assert.equal(snapped.guides.x,764);
  const free=snapTranslation(layers,[1,2],61,7,{enabled:false});assert.deepEqual(free,{dx:61,dy:7,guides:{}});
  const grid=snapTranslation([layer(764),layer(123,123)],[1],4,4,{grid:16,threshold:3});assert.equal(grid.dx,5);assert.equal(grid.dy,5);assert.equal(grid.guides.x,128);
  const other=snapTranslation([layer(764),layer(500),layer(900)],[1],397,0,{threshold:5});assert.equal(other.dx,400);
});
test('rotated signed layers have correct world bounds and group ordering cannot cross the background',()=>{
  const value={...layer(500),width:-200,height:100,rotation:90},bounds=layerBounds(value);assert.ok(Math.abs(bounds.width-100)<1e-8);assert.ok(Math.abs(bounds.height-200)<1e-8);
  const layers=[layer(0),layer(100),layer(200),layer(300)],result=reorderLayers(layers,[1,2],1,2);assert.deepEqual(layers.map(l=>l.x),[0,300,100,200]);assert.deepEqual(result.selection,[2,3]);assert.equal(result.selected,3);
  const back=reorderLayers(layers,result.selection,-1,result.selected);assert.deepEqual(layers.map(l=>l.x),[0,100,200,300]);assert.deepEqual(back.selection,[1,2]);
});
test('edge handles stretch one axis and corner handles scale proportionally around the opposite side',()=>{
  const layers=[layer(764),{...layer(700,700),width:200,height:-100}],frame=resizeFrame(layers,[1]);
  assert.deepEqual(resizeHandleAt(frame,801,700,6),{hx:1,hy:0});assert.deepEqual(resizeHandleAt(frame,600,651,6),{hx:-1,hy:-1});assert.equal(resizeHandleAt(frame,700,700,6),null);
  const origin=structuredClone(layers);resizeLayers(origin,layers,[1],frame,{hx:1,hy:0},50,30);assert.deepEqual([layers[1].x,layers[1].y,layers[1].width,layers[1].height],[725,700,250,-100]);
  resizeLayers(origin,layers,[1],frame,{hx:-1,hy:-1},-100,-50);assert.deepEqual([layers[1].x,layers[1].y,layers[1].width,layers[1].height],[650,675,300,-150]);
  resizeLayers(origin,layers,[1],frame,{hx:1,hy:0},-500,0);assert.equal(layers[1].width,1);assert.equal(layers[1].x,601);
});
test('rotated layers resize along their own axes and groups resize about the fixed edge',()=>{
  const layers=[layer(764),{...layer(700,700),width:200,height:100,rotation:90}],frame=resizeFrame(layers,[1]);
  assert.deepEqual(resizeHandleAt(frame,700,600,6),{hx:1,hy:0});assert.equal(resizeCursor(frame,{hx:1,hy:0}),'ns-resize');
  const origin=structuredClone(layers);resizeLayers(origin,layers,[1],frame,{hx:1,hy:0},0,-50);assert.deepEqual([layers[1].x,layers[1].y,layers[1].width],[700,675,250]);
  const group=[layer(764),layer(600),layer(800)],groupFrame=resizeFrame(group,[1,2]),before=structuredClone(group);
  resizeLayers(before,group,[1,2],groupFrame,{hx:1,hy:0},300,0);assert.equal(group[1].x-group[1].width/2,550);assert.equal(group[1].width,200);assert.equal(group[2].x+group[2].width/2,1150);assert.equal(group[1].height,100);
});
test('corner rotation zone sits outside the box and rotates from the drag-start state with optional snapping',()=>{
  const layers=[layer(764),{...layer(700,700),width:200,height:100,rotation:350}],frame=resizeFrame(layers,[1]);
  const flat={...frame,rotation:0};assert.deepEqual(rotateHandleAt(flat,815,640,6),{hx:1,hy:-1});assert.equal(rotateHandleAt(flat,790,700,6),null);assert.equal(rotateHandleAt(flat,900,700,6),null);
  assert.equal(pointerAngle(frame,700,600),90);
  const origin=structuredClone(layers);rotateFromOrigin(origin,layers,[1],22.4);assert.equal(layers[1].rotation,12);rotateFromOrigin(origin,layers,[1],-30);assert.equal(layers[1].rotation,320);
  rotateFromOrigin(origin,layers,[1],22.4,{snap:15});assert.equal(layers[1].rotation,15);assert.deepEqual([layers[1].x,layers[1].y],[700,700]);
  const group=[layer(764),layer(600),layer(800)],before=structuredClone(group);rotateFromOrigin(before,group,[1,2],90);assert.equal(group[1].x,700);assert.equal(group[1].y,864);assert.equal(group[2].y,664);
});
test('opposite-side copies reflect position, mesh and rotation across the canvas centre line',()=>{
  const source={...layer(600,500),rotation:30,mirror:0},h=reflectLayer(source,'x'),v=reflectLayer(source,'y');
  assert.deepEqual([h.x,h.y,h.mirror,h.rotation],[928,500,1,330]);assert.deepEqual([v.x,v.y,v.mirror,v.rotation],[600,1028,1,150]);
  assert.deepEqual(reflectLayer(h,'x'),source);assert.equal(source.x,600);
});
