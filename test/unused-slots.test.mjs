import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {readPsd} from 'ag-psd';
import {makeWorkspace} from './helpers/workspace.mjs';
import {atlasDetails,stageAtlasEdit,installAtlasEdit,extractCell,maskBounds} from '../atlas-manager.mjs';
import {loadLibrary} from '../library.mjs';

async function temporary(run){const temp=await fs.mkdtemp(path.join(os.tmpdir(),'banner-unused-test-'));try{await run(temp);}finally{const resolved=path.resolve(temp);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('banner-unused-test-'));await fs.rm(resolved,{recursive:true,force:true});}}
async function upload(){const png=await sharp({create:{width:90,height:90,channels:4,background:'#0000'}}).composite([{input:await sharp({create:{width:19,height:37,channels:4,background:'#fff'}}).png().toBuffer(),left:4,top:7}]).png().toBuffer();return {name:'new-emblem.png',dataUrl:'data:image/png;base64,'+png.toString('base64')};}

test('filling an unused slot proposes a collision-free ID, preserves existing cells, then installs XML and a transparent thumbnail',async()=>temporary(async temp=>{
  const f=await makeWorkspace(temp),original=await fs.readFile(f.source);
  let xml=await fs.readFile(f.p.registry,'utf8');xml=xml.replace('<BannerIconGroup id="100"','<!-- keep this comment -->\r\n<BannerIconGroup id="99" name="Empty"/>\r\n<BannerIconGroup id="100"');await fs.writeFile(f.p.registry,xml);
  let native=await fs.readFile(f.p.nativeRegistry,'utf8');native=native.replace('</BannerIconGroup>','<Background id="10003" mesh_name="pattern"/></BannerIconGroup>');await fs.writeFile(f.p.nativeRegistry,native);await fs.writeFile(path.join(f.p.thumbnails,'10004.png'),'Reserved orphan thumbnail');
  const detail=await atlasDetails({...f,material:f.material}),review=await stageAtlasEdit({...f,material:f.material,expected:detail.snapshot,actions:[{type:'center',slot:0},{type:'replace',slot:15,groupId:100,file:await upload()}]});
  assert.deepEqual(review.additions,[{id:10005,slot:15,groupId:100}]);assert.equal(await fs.readFile(f.p.registry,'utf8'),xml);assert.deepEqual(await fs.readFile(f.source),original);await assert.rejects(fs.stat(path.join(f.p.thumbnails,'10005.png')),{code:'ENOENT'});
  const proposed=await fs.readFile(path.join(review.directory,'banner_icons.xml'),'utf8');assert.match(proposed,/id="10005" material_name="example_symbols_west_alpha_01" texture_index="15"/);assert.equal(proposed.replace(/\r\n  <Icon id="10005"[^>]*\/>\r\n/,''),xml);
  const before=readPsd(original,{useImageData:true,skipLayerImageData:true}),after=readPsd(await fs.readFile(path.join(review.directory,review.psd)),{useImageData:true,skipLayerImageData:true});
  for(const slot of Array.from({length:16},(_,i)=>i).filter(i=>i!==0&&i!==15))assert.deepEqual(extractCell(Buffer.from(after.imageData.data),2048,slot),extractCell(Buffer.from(before.imageData.data),2048,slot));
  const bounds=maskBounds(extractCell(Buffer.from(after.imageData.data),2048,15),512,512);assert.equal(bounds.left+bounds.width/2,256);assert.equal(bounds.top+bounds.height/2,256);
  const result=await installAtlasEdit({...f,batchId:review.batchId});assert.equal(result.status,'installed');assert.deepEqual(await fs.readFile(path.join(result.backupDirectory,'banner_icons.xml')),Buffer.from(xml));
  const library=await loadLibrary(f.config.modulePath,f.config.gamePath,f.config);assert.deepEqual(library.icons.map(i=>[i.id,i.index]),[[10000,0],[10002,2],[10005,15]]);assert.equal((await sharp(path.join(f.p.thumbnails,'10005.png')).stats()).isOpaque,false);
}));

test('failure committing the new XML rolls back artwork and removes the newly created thumbnail',async()=>temporary(async temp=>{
  const f=await makeWorkspace(temp),original=await fs.readFile(f.source),xml=await fs.readFile(f.p.registry),detail=await atlasDetails({...f,material:f.material}),review=await stageAtlasEdit({...f,material:f.material,expected:detail.snapshot,actions:[{type:'replace',slot:15,file:await upload()}]});
  const io={...fs,rename:async(from,to)=>{if(to===f.p.registry&&!from.includes('rollback'))throw new Error('Simulated XML commit failure');return fs.rename(from,to);}};
  await assert.rejects(installAtlasEdit({...f,batchId:review.batchId,io}),/Simulated XML/);assert.deepEqual(await fs.readFile(f.source),original);assert.deepEqual(await fs.readFile(f.p.registry),xml);
  await assert.rejects(fs.stat(path.join(f.p.thumbnails,review.additions[0].id+'.png')),{code:'ENOENT'});await assert.rejects(fs.stat(f.p.registry+'.atlas-import.lock'),{code:'ENOENT'});
}));

test('an ID claimed by Native after review prevents installation without modifying module artwork or XML',async()=>temporary(async temp=>{
  const f=await makeWorkspace(temp),original=await fs.readFile(f.source),xml=await fs.readFile(f.p.registry),detail=await atlasDetails({...f,material:f.material}),review=await stageAtlasEdit({...f,material:f.material,expected:detail.snapshot,actions:[{type:'replace',slot:15,file:await upload()}]});
  const native=await fs.readFile(f.p.nativeRegistry,'utf8');await fs.writeFile(f.p.nativeRegistry,native.replace('</BannerIconGroup>','<Background id="'+review.additions[0].id+'" mesh_name="pattern"/></BannerIconGroup>'));
  await assert.rejects(installAtlasEdit({...f,batchId:review.batchId}),/unavailable/);assert.deepEqual(await fs.readFile(f.source),original);assert.deepEqual(await fs.readFile(f.p.registry),xml);await assert.rejects(fs.stat(path.join(f.p.thumbnails,review.additions[0].id+'.png')),{code:'ENOENT'});
}));
