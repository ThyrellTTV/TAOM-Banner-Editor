import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {factionModel,findClan,nearestColors,hexToLab,deltaE,chooseMode,bakeMask,validateCode,contactSheet,slugify} from '../ai-workflow.mjs';
import {tint,drawLayer,rasterizeBackground} from '../node-renderer.mjs';

const layer=(mesh,c1,c2,w=1528,h=1528,x=764,y=764)=>[mesh,c1,c2,w,h,x,y,1,0,0].join('.');
const library={
  groups:[{id:210,name:'Rohan Alpha',source:'Module'},{id:6,name:'Shape',source:'Native'},{id:1,name:'Backgrounds',source:'Native'}],
  icons:[{id:21004,group:210,source:'Module'},{id:21005,group:210,source:'Module'},{id:600,group:6,source:'Native'}],
  backgrounds:[{id:11,mesh:'bg_11',group:1}],
  colors:[{id:1,hex:'#ffffff',source:'Native',forSigil:true,forBackground:false},{id:2,hex:'#135200',source:'Module',forSigil:false,forBackground:true},{id:3,hex:'#ff0000',source:'Native',forSigil:true,forBackground:true}],
  banners:[
    {key:'k::Kingdom::vlandia::banner_key',id:'vlandia',name:'Rohan',kind:'Kingdom',attribute:'banner_key',culture:'Culture.vlandia',superFaction:'',code:layer(11,2,2)+'.'+layer(21004,1,1,500,500)},
    {key:'c::Faction::clan_a::banner_key',id:'clan_a',name:'House of A',kind:'Clan',attribute:'banner_key',culture:'',superFaction:'Kingdom.vlandia',code:layer(11,2,2)+'.'+layer(21005,1,1,500,500)},
    {key:'x::Faction::clan_vlandia_1::banner_key',id:'clan_vlandia_1',name:'House of Eorl',kind:'Clan',attribute:'banner_key',culture:'',superFaction:'',format:'xslt-attribute',code:layer(11,3,2)+'.'+layer(600,1,1,500,500)},
    {key:'c::Faction::loner::banner_key',id:'loner',name:'Loner',kind:'Clan',attribute:'banner_key',culture:'Culture.other',superFaction:'',code:layer(11,2,2)}]};

test('kingdom membership uses super_faction, then native definitions, then culture',()=>{
  const {kingdoms,clanIndex}=factionModel(library,{kingdoms:{}},new Map([['clan_vlandia_1',{superFaction:'Kingdom.vlandia',culture:'Culture.vlandia'}]]));
  const rohan=kingdoms.get('vlandia');
  assert.deepEqual(rohan.clans.map(c=>c.id).sort(),['clan_a','clan_vlandia_1']);
  assert.equal(clanIndex.get('clan_vlandia_1').via,'native super_faction');
  assert.equal(clanIndex.get('loner').kingdom,null);
  assert.equal(rohan.groups[0].id,210);assert.equal(rohan.groups[0].banners,2);
});
test('faction-map overrides add and exclude icon groups',()=>{
  const {kingdoms}=factionModel(library,{kingdoms:{vlandia:{groups:[999],excludeGroups:[6]}}},new Map([['clan_vlandia_1',{superFaction:'Kingdom.vlandia'}]]));
  const ids=kingdoms.get('vlandia').groups.map(g=>g.id);
  assert.ok(ids.includes(999));assert.ok(!ids.includes(6));assert.equal(ids.at(-1),999);
});
test('clan lookup by id, exact name and unique substring; ambiguity is reported',()=>{
  assert.equal(findClan(library,'clan_a')[0].id,'clan_a');
  assert.equal(findClan(library,'house of eorl')[0].id,'clan_vlandia_1');
  assert.throws(()=>findClan(library,'house'),/Several clans/);
  assert.throws(()=>findClan(library,'nobody'),/No clan/);
  assert.equal(findClan(library,'kingdom:vlandia')[0].key,'k::Kingdom::vlandia::banner_key');
  assert.throws(()=>findClan(library,'kingdom:nowhere'),/No kingdom banner/);
});
test('palette snapping is perceptual and honours player flags',()=>{
  assert.ok(deltaE(hexToLab('#ffffff'),[100,0,0])<.5);
  assert.equal(nearestColors(library,'#fe0101')[0].id,3);
  assert.equal(nearestColors(library,'#f0f0f0',{background:true})[0].id!==1,true);
  assert.deepEqual(nearestColors(library,'#000000',{module:true}).map(c=>c.id),[2]);
});
test('validateCode flags unknown meshes and colours',()=>{
  assert.deepEqual(validateCode(library,library.banners[0].code).problems,[]);
  const {problems}=validateCode(library,layer(21004,1,1)+'.'+layer(11,9,1));
  assert.equal(problems.length,3);
});
const image=(w,h,fn)=>{const data=Buffer.alloc(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++)data.set(fn(x,y),(y*w+x)*4);return {data,width:w,height:h};};
test('mask mode detection: transparent, dark-on-light and light-on-dark',()=>{
  assert.equal(chooseMode(image(20,20,(x,y)=>x<10?[0,0,0,0]:[255,255,255,255])),'alpha');
  assert.equal(chooseMode(image(20,20,(x,y)=>x>5&&x<15?[0,0,0,255]:[250,250,250,255])),'dark-on-light');
  assert.equal(chooseMode(image(20,20,(x,y)=>x>5&&x<15?[255,255,255,255]:[5,5,5,255])),'light-on-dark');
});
test('baked masks are white with coverage in alpha, levels remove JPEG noise, bad modes warn',()=>{
  const src=image(20,20,(x,y)=>x>5&&x<15?[10,10,10,255]:[240,240,240,255]);
  const baked=bakeMask(src,{mode:'dark-on-light'});
  assert.equal(baked.data[(10*20+10)*4+3],255);assert.equal(baked.data[3],0);assert.equal(baked.data[0],255);
  assert.deepEqual(baked.warnings,[]);
  assert.match(bakeMask(src,{mode:'light-on-dark'}).warnings.join(),/border/);
});
test('tint follows the shader rules for icons and backgrounds',()=>{
  const raw={width:1,height:2,data:Buffer.from([0,255,0,255, 255,0,0,255])};
  const icon=tint(raw,{main:[10,20,30],second:[200,100,0],stroke:0});
  assert.deepEqual([...icon.data.slice(0,4)],[10,20,30,255]);assert.equal(icon.data[7],0);
  assert.equal(tint(raw,{main:[10,20,30],second:[200,100,0],stroke:1}).data[7],255);
  const bg=tint({width:1,height:1,data:Buffer.from([255,0,0,255])},{main:[1,2,3],second:[9,9,9],background:true});
  assert.deepEqual([...bg.data],[1,2,3,255]);
});
test('drawLayer places, mirrors and rotates in banner space',()=>{
  const size=100,arrow=image(10,10,(x)=>x<5?[255,0,0,255]:[0,0,0,0]);
  const place=extra=>{const t=new Uint8ClampedArray(size*size*4);drawLayer(t,size,arrow,{x:764,y:764,width:764,height:764,rotation:0,mirror:0,...extra});return t;};
  const alphaAt=(t,x,y)=>t[(y*size+x)*4+3];
  const plain=place({});assert.ok(alphaAt(plain,35,50)>200);assert.equal(alphaAt(plain,65,50),0);assert.equal(alphaAt(plain,10,50),0);
  const mirrored=place({mirror:1});assert.equal(alphaAt(mirrored,35,50),0);assert.ok(alphaAt(mirrored,65,50)>200);
  const rotated=place({rotation:90});assert.ok(alphaAt(rotated,50,65)>200||alphaAt(rotated,50,35)>200);assert.equal(alphaAt(rotated,35,50)>200&&alphaAt(rotated,65,50)>200,false);
});
test('background meshes rasterise vertex red and alpha',()=>{
  const mask=rasterizeBackground([{positions:[[0,0],[1,0],[1,1],[0,1]],indices:[0,1,2,0,2,3],colors:[[255,0,0,255],[255,0,0,255],[255,0,0,255],[255,0,0,255]]}],16);
  assert.equal(mask.data[(8*16+8)*4],255);assert.equal(mask.data[(8*16+8)*4+3],255);
});
test('contact sheets compose labelled tiles',async()=>{
  const png=await contactSheet([{image:image(4,4,()=>[255,0,0,255]),label:'a'},{image:await sharp({create:{width:4,height:4,channels:4,background:'#00ff00'}}).png().toBuffer(),label:'b'}],{columns:2,tile:32,title:'t'});
  const meta=await sharp(png).metadata();assert.equal(meta.width,2*40+8);assert.equal(meta.format,'png');
  assert.equal(slugify('Ælfwiging Hall!'),'aelfwiging-hall');assert.equal(slugify('Rhûn Þing'),'rhun-thing');
});
