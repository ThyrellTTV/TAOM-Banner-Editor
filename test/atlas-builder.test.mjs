import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {readPsd,initializeCanvas} from 'ag-psd';
import {preparePng,buildAtlases,alphaBounds,factionSlug} from '../atlas-builder.mjs';
initializeCanvas(undefined,(width,height)=>({width,height,data:new Uint8ClampedArray(width*height*4)}));
async function fixture({width=100,height=80,left=60,top=6,w=9,h=7,alpha=255}={}){
  const raw=Buffer.alloc(width*height*4);
  for(let y=top;y<top+h;y++)for(let x=left;x<left+w;x++){const i=(y*width+x)*4;raw[i]=240;raw[i+1]=110;raw[i+2]=20;raw[i+3]=alpha;}
  return sharp(raw,{raw:{width,height,channels:4}}).png().toBuffer();
}
function coverageBounds(art){const raw=Buffer.from(art.gameMask);for(let p=0;p<raw.length;p+=4)raw[p+3]=Math.max(raw[p],raw[p+1]);return alphaBounds(raw,art.width,art.height);}
test('asymmetric transparent margins are removed; small odd artwork is centred without upscaling',async()=>{
  const art=await preparePng({name:'odd.png',data:await fixture()});
  assert.deepEqual(art.trimmedBounds,{left:60,top:6,width:9,height:7});assert.equal(art.scale,1);
  assert.deepEqual(art.subpixelShift,{x:.5,y:.5});assert.equal(art.width,10);assert.equal(art.height,8);
  const bounds=coverageBounds(art);assert.equal(bounds.left+bounds.width/2,art.width/2);assert.equal(bounds.top+bounds.height/2,art.height/2);
});
test('large artwork is reduced proportionally to fit a 512px cell',async()=>{
  const art=await preparePng({name:'large.png',data:await fixture({width:1600,height:1000,left:20,top:30,w:1537,h:767})});
  assert.ok(art.width<=512&&art.height<=512);assert.equal(art.scale,512/1537);
  assert.ok(Math.abs(art.width/1537-art.height/767)<.002);
});
test('half-transparent edges retain coverage and optional outline fits inside padding',async()=>{
  const art=await preparePng({name:'soft.png',data:await fixture({w:10,h:8,alpha:128})},{padding:16,outline:3});
  assert.equal(art.gameMask[(3*art.width+3)*4+1],128);
  assert.ok(art.gameMask.some((v,i)=>i%4===0&&v>0));assert.ok(art.width<=480&&art.height<=480);
});
test('opaque monochrome art supports luminance masks and warns in transparency mode',async()=>{
  const png=await sharp({create:{width:16,height:16,channels:4,background:'#000'}}).composite([{input:await sharp({create:{width:4,height:6,channels:4,background:'#fff'}}).png().toBuffer(),left:8,top:2}]).png().toBuffer();
  const masked=await preparePng({name:'mono.png',data:png},{mode:'light-on-dark'});
  assert.deepEqual(masked.trimmedBounds,{left:8,top:2,width:4,height:6});assert.equal(masked.warnings.length,0);
  assert.equal((await preparePng({name:'mono.png',data:png})).warnings.length,1);
});
test('builds verified 2048px layered PSDs, splits 17 PNGs, centres every cell, and preserves module files',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'taom-atlas-test-'));
  try{
    const source=path.join(temp,'module','AssetSources','BannerIcons');await fs.mkdir(source,{recursive:true});
    const xmlFile=path.join(temp,'module','ModuleData','banner_icons.xml');await fs.mkdir(path.dirname(xmlFile),{recursive:true});
    const originalXml='<base><BannerIconData><BannerIconGroup id="100" name="Gondor"><Icon id="10000" material_name="taom_banners_gondor_alpha_01" texture_index="0"/></BannerIconGroup>\n    <BannerColors/>\n</BannerIconData></base>';
    await fs.writeFile(xmlFile,originalXml);
    const existing=path.join(source,'taom_banners_gondor_alpha_01.psd');await fs.writeFile(existing,'keep existing file');
    const png=await fixture();const files=Array.from({length:17},(_,i)=>({name:'symbol-'+i+'.png',data:png}));
    const result=await buildAtlases({files,faction:'Gondor',category:'alpha',sourceDirectory:source,outputDirectory:path.join(temp,'builds')});
    assert.equal(result.atlases.length,2);assert.equal(result.atlases[0].name,'taom_banners_gondor_alpha_02');assert.equal(result.atlases[1].cells.length,1);
    assert.equal(await fs.readFile(existing,'utf8'),'keep existing file');
    assert.equal(result.registration.icons,17);assert.equal(result.registration.installed,true);
    assert.equal(await fs.readFile(result.registration.xmlBackup,'utf8'),originalXml);
    const changedXml=await fs.readFile(xmlFile,'utf8');
    for(const atlas of result.atlases){
      const psd=readPsd(await fs.readFile(atlas.installedPath),{useImageData:true,skipThumbnail:true});
      assert.equal(psd.width,2048);assert.equal(psd.height,2048);assert.equal(psd.imageResources.gridAndGuidesInformation.guides.length,6);
      assert.equal(psd.children[1].hidden,true);assert.equal(psd.children[2].children.length,atlas.cells.length);
      atlas.cells.forEach((cell,index)=>{
        assert.equal(cell.textureIndex,index);assert.equal(cell.centre.x,(index%4)*512+256);assert.equal(cell.centre.y,Math.floor(index/4)*512+256);
        const b=cell.placedBounds;assert.equal(b.left+b.width/2,cell.centre.x);assert.equal(b.top+b.height/2,cell.centre.y);
        const layer=psd.children[2].children[index];assert.equal(layer.left,b.left);assert.equal(layer.top,b.top);
        const data=Buffer.from(layer.imageData.data);for(let p=0;p<data.length;p+=4)data[p+3]=Math.max(data[p],data[p+1]);
        const visible=alphaBounds(data,layer.imageData.width,layer.imageData.height);
        assert.equal(layer.left+visible.left+visible.width/2,cell.centre.x);assert.equal(layer.top+visible.top+visible.height/2,cell.centre.y);
      });
      for(const cell of atlas.cells){
        assert.ok(changedXml.includes(`<Icon id="${cell.iconId}" material_name="${atlas.name}" texture_index="${cell.textureIndex}" />`));
        const thumbnail=await sharp(cell.installedThumbnail).ensureAlpha().raw().toBuffer({resolveWithObject:true});
        assert.equal(thumbnail.info.width,256);assert.equal(thumbnail.info.height,256);
        assert.equal(thumbnail.data[3],0);assert.ok(thumbnail.data.some((value,i)=>i%4===3&&value>0));
        for(let i=0;i<thumbnail.data.length;i+=4)if(thumbnail.data[i+3])assert.deepEqual([...thumbnail.data.subarray(i,i+3)],[255,255,255]);
        const bounds=alphaBounds(thumbnail.data,256,256);assert.equal(bounds.left+bounds.width/2,128);assert.equal(bounds.top+bounds.height/2,128);
      }
      assert.ok((await fs.stat(path.join(result.directory,atlas.preview))).size>0);
    }
    await assert.rejects(buildAtlases({files:[files[0]],faction:'gondor',category:'alpha',startIndex:2,sourceDirectory:source,outputDirectory:path.join(temp,'builds')}),/already (exists|registered)/);
    const before=await fs.readdir(source);
    await assert.rejects(buildAtlases({files:[{name:'empty.png',data:await sharp({create:{width:4,height:4,channels:4,background:'#0000'}}).png().toBuffer()}],faction:'rohan',category:'ornament',sourceDirectory:source,outputDirectory:path.join(temp,'builds')}),/no visible artwork/);
    assert.deepEqual(await fs.readdir(source),before);
  }finally{
    const resolved=path.resolve(temp);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('taom-atlas-test-'));await fs.rm(resolved,{recursive:true,force:true});
  }
});
test('rejects invalid options and normalizes faction names',async()=>{
  assert.equal(factionSlug('Misty Mountain Orcs'),'misty_mountain_orcs');assert.throws(()=>factionSlug('!!!'));
  await assert.rejects(buildAtlases({files:[],faction:'gondor',category:'alpha'}),/Choose between/);
  await assert.rejects(preparePng({name:'not.png',data:Buffer.from('bad image')}));
});
