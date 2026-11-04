import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectedIndices,selectionBounds,translateLayers,scaleLayers,rotateLayers,mirrorLayers,alignLayers,reorderLayers,snapTranslation,layerBounds} from '../public/layer-editing.mjs';
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
