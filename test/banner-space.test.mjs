import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bannerViewport,bannerToCanvas,canvasToBanner,BANNER_SIZE,EDITABLE_GUIDE_SIZE} from '../public/banner-space.mjs';
import {BannerRenderer} from '../public/renderer.mjs';

test('the reported 600-unit Hýarthulionath symbol fits the full canvas and extends beyond the 512 crop',()=>{
  assert.equal(BANNER_SIZE,1528);assert.equal(EDITABLE_GUIDE_SIZE,512);
  // House of Hýarthulionath: icon 10016, 600x600, centred at (764,800).
  const corners=[[764-600/2,800-600/2],[764+600/2,800+600/2]];
  const full=corners.map(([x,y])=>bannerToCanvas(x,y,1024,1024));
  assert.ok(full.every(p=>p.x>0&&p.y>0&&p.x<1024&&p.y<1024));
  const cropped=corners.map(([x,y])=>bannerToCanvas(x,y,1024,1024,512));
  assert.ok(cropped[0].x<0&&cropped[0].y<0&&cropped[1].x>1024&&cropped[1].y>1024);
  assert.deepEqual(bannerToCanvas(764,764,1024,1024),{x:512,y:512});
});

test('pointer mapping stays aligned with drawing across crops and non-square display sizes',()=>{
  for(const [width,height] of [[1024,1024],[600,400]])for(const span of [512,1024,1528]){
    for(const [x,y] of [[764,764],[440,1090],[0,1528]]){
      const p=bannerToCanvas(x,y,width,height,span),back=canvasToBanner(p.x,p.y,width,height,span);
      assert.ok(Math.abs(back.x-x)<1e-9&&Math.abs(back.y-y)<1e-9);
    }
    assert.deepEqual(canvasToBanner(width/2,height/2,width,height,span),{x:764,y:764});
  }
  assert.throws(()=>bannerViewport(1024,1024,0));
});

test('renderer defaults to full canvas, draws the guide as an overlay, and uses a round shield',async()=>{
  const calls=[];
  const ctx=Object.fromEntries(['clearRect','save','restore','translate','scale','rotate','drawImage','beginPath','moveTo','lineTo','stroke','strokeRect','fillRect','fillText','setLineDash','closePath','clip','arc'].map(name=>[name,(...args)=>calls.push([name,...args])]));
  const canvas={width:1024,height:1024,getContext:()=>ctx};
  const renderer=new BannerRenderer({icons:[],backgrounds:[],colors:[]});renderer.tinted=async()=>({});
  await renderer.render(canvas,[{x:765,y:765,width:650,height:650,rotation:0,mirror:0}],{guides:true});
  assert.ok(calls.some(([name,x,y])=>name==='scale'&&x===1024/1528&&y===1024/1528));
  assert.equal(calls.filter(([name])=>name==='clip').length,0);
  assert.ok(calls.some(([name,,,width])=>name==='strokeRect'&&width===512*1024/1528));
  calls.length=0;
  await renderer.render(canvas,[],{shape:'shield'});
  assert.ok(calls.some(([name,x,y,r])=>name==='arc'&&x===512&&y===512&&r===1024*.47));
  assert.equal(calls.filter(([name])=>name==='clip').length,1);
});
