import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {readPsd} from 'ag-psd';
import {normalizeResourceSettings} from '../public/resource-settings.mjs';
import {normalizeConfig,writeConfig,readConfig,workspaceIdentity,workspaceSignature} from '../configuration.mjs';
import {planProfileSettings,planProfileSwitch} from '../profiles.mjs';
import {writeAtlasPage} from '../atlas-builder.mjs';
import {resizeAtlas,encodeTexture} from '../texture-encoding.mjs';
import {readResource,writeResource,compileMaterial,materialLayout,guidBytes} from '../resource-compiler.mjs';
const root=path.resolve(import.meta.dirname,'..');
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;},str=s=>Buffer.concat([u32(Buffer.byteLength(s)),Buffer.from(s)]),flags=items=>Buffer.concat([u32(items.length),...items.map(str)]);
async function temporary(run){const temp=await fs.mkdtemp(path.join(os.tmpdir(),'banner-resource-settings-'));try{await run(temp);}finally{assert.equal(path.dirname(path.resolve(temp)),path.resolve(os.tmpdir()));assert.ok(path.basename(temp).startsWith('banner-resource-settings-'));await fs.rm(temp,{recursive:true,force:true});}}
test('resource settings keep the working defaults, validate options and persist separately in mod profiles',()=>temporary(async temp=>{
 const original=normalizeConfig({modulePath:path.join(temp,'A'),gamePath:path.join(temp,'Game')},temp),defaults=normalizeResourceSettings();assert.equal(defaults.newAtlasSize,2048);assert.equal(defaults.atlasSize,0);assert.equal(defaults.atlasFormat,'rgba8');assert.equal(defaults.material.override,false);
 const resources=normalizeResourceSettings({newAtlasSize:4096,atlasSize:1024,atlasFormat:'bc7',guiFormat:'bc3',mipmaps:true,textureFlags:['dont_degrade'],material:{override:true,blendMode:'modulate',alphaTest:.7,flags:['two_sided'],shaderFlags:['alpha_test'],vertexFlags:[]}}),changed={...original,resourceSettings:resources};
 assert.notEqual(workspaceIdentity(original),workspaceIdentity(changed));assert.equal(workspaceSignature(original),workspaceSignature(changed));
 const file=path.join(temp,'config.json');await writeConfig(file,changed);assert.deepEqual((await readConfig(temp,file)).config.resourceSettings,resources);
 const a=planProfileSettings({activeId:null,profiles:[]},{...original,resourceSettings:resources},original,temp),b=planProfileSettings(a.store,{createProfile:true,modulePath:path.join(temp,'B'),profileName:'Second',resourceSettings:{atlasSize:2048}},a.config,temp);
 assert.equal(planProfileSwitch(b.store,a.store.activeId,4318).config.resourceSettings.atlasFormat,'bc7');assert.equal(b.config.resourceSettings.atlasFormat,'rgba8');assert.equal(b.config.resourceSettings.atlasSize,2048);
 for(const input of [{atlasSize:512},{newAtlasSize:8192},{guiFormat:'bc1'},{material:{alphaTest:2}},{textureFlags:['not a flag']},{mipmaps:'yes'}])assert.throws(()=>normalizeResourceSettings(input));
}));
test('1K and 4K PSDs retain exact slot centring, correctly sized guides and transparent 256px thumbnails',()=>temporary(async temp=>{
 const data=await sharp({create:{width:1103,height:579,channels:4,background:'#fff'}}).png().toBuffer();
 for(const size of [1024,4096]){
  const dir=path.join(temp,String(size)),result=await writeAtlasPage({name:'test_alpha_'+size,files:[{name:'wide.png',data,id:10000,textureIndex:15}],directory:dir,atlasSize:size}),psd=readPsd(await fs.readFile(path.join(dir,result.psd)),{useImageData:true,skipLayerImageData:true,skipThumbnail:true});
  assert.equal(psd.width,size);assert.equal(psd.height,size);assert.deepEqual(result.cells[0].centre,{x:size*7/8,y:size*7/8});assert.equal(result.cells[0].centreVerified,true);assert.equal(psd.imageResources.gridAndGuidesInformation.guides[0].location,size/4);
  const thumb=await sharp(path.join(dir,'thumbnails/10000.png')).metadata();assert.equal(thumb.width,256);assert.equal(thumb.height,256);assert.equal(thumb.hasAlpha,true);assert.equal((await sharp(path.join(dir,'thumbnails/10000.png')).stats()).isOpaque,false);
 }
}));
test('compiled atlas resizing isolates cells and mip generation creates a complete chain',()=>temporary(async directory=>{
 const width=32,rgba=Buffer.alloc(width*width*4);for(let y=0;y<width;y++)for(let x=0;x<width;x++){const slot=Math.floor(y/8)*4+Math.floor(x/8),i=(y*width+x)*4;rgba[i]=slot*15;rgba[i+1]=255-slot*15;rgba[i+3]=255;}
 const resized=await resizeAtlas(rgba,width,16);for(let y=0;y<16;y++)for(let x=0;x<16;x++){const slot=Math.floor(y/4)*4+Math.floor(x/4),i=(y*16+x)*4;assert.equal(resized[i],slot*15);assert.equal(resized[i+1],255-slot*15);}
 const result=await encodeTexture({root,directory,rgba:resized,width:16,height:16,mipmaps:true});assert.equal(result.mipCount,5);assert.deepEqual(result.levels.map(l=>l.width),[16,8,4,2,1]);assert.equal(result.data.length,(256+64+16+4+1)*4);
}));
test('BC1, BC3 and BC7 encode the correct GPU block counts across every mip',()=>temporary(async directory=>{
 const rgba=await sharp({create:{width:32,height:32,channels:4,background:{r:50,g:190,b:90,alpha:.5}}}).raw().toBuffer();
 for(const format of ['bc1','bc3','bc7']){const result=await encodeTexture({root,directory,rgba,width:32,height:32,format,mipmaps:true,quality:'fast'});assert.equal(result.mipCount,6);assert.equal(result.levels.at(-1).width,1);assert.equal(result.data.length,(64+16+4+1+1+1)*(format==='bc1'?8:16));}
}));
test('custom material settings replace their exact fields while retaining diffuse bindings and opaque metadata',async()=>{
 const shader='12345678-1234-1234-1234-123456789012',tex='87654321-4321-4321-4321-210987654321',metadata=Buffer.concat([u32(0),Buffer.alloc(24),flags(['old_flag']),u32(0),flags(['old_vertex']),str('modulate'),guidBytes(shader),u32(1),u32(0),guidBytes(tex),Buffer.alloc(4),flags(['old_shader']),Buffer.from('opaque material tail')]);
 const template=await writeResource({packageId:shader,id:tex,type:'1db01393-6902-4f19-83ba-b37a39830717',version:0,name:'fixture',metadata,segments:[]}),settings=normalizeResourceSettings({material:{override:true,blendMode:'no_alpha_blend',alphaTest:.7,flags:['two_sided'],shaderFlags:['alpha_test'],vertexFlags:[]}}).material;
 const output=await compileMaterial({template,existing:template,name:'fixture',textureId:tex,settings}),p=readResource(output.tpac),layout=materialLayout(p.metadata);assert.equal(layout.shader,shader);assert.equal(layout.blendMode,'no_alpha_blend');assert.ok(Math.abs(layout.alphaTest-.7)<1e-6);assert.deepEqual(layout.flags,['two_sided']);assert.deepEqual(layout.shaderFlags,['alpha_test']);assert.deepEqual(layout.vertexFlags,[]);assert.ok(p.metadata.includes(Buffer.from('opaque material tail')));assert.equal(p.id,tex);
});
