import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {xxhash64} from 'hash-wasm';
import {normalizeConfig,workspaceIdentity} from '../configuration.mjs';
import {readResource,writeResource,validateResource,compileTexture,compileMaterial,guidBytes,textureLayout} from '../resource-compiler.mjs';
import {mergeSpriteCategory,installGameDeployment,deploymentDirectory} from '../game-deployment.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;},str=s=>Buffer.concat([u32(Buffer.byteLength(s)),Buffer.from(s)]);
async function textureTemplate(){const data=Buffer.from('texture-settings');return writeResource({packageId:randomUUID(),type:'c974cbcb-5f1c-49f6-9a32-2b5b6c92c2e8',id:randomUUID(),version:0,name:'fixture',metadata:Buffer.concat([u32(3),Buffer.alloc(20),str('$BASE/Modules/Fixture/fixture.png'),Buffer.alloc(13),u32(0),u32(2),Buffer.from([2]),u32(16),u32(16),u32(1),Buffer.from([1,1,0]),str('R8G8B8A8_UNORM'),Buffer.alloc(40)]),segments:[{type:'7c475be2-7c8d-431d-b0e1-53218d047fb9',owner:randomUUID(),actual:data.length,hash:BigInt('0x'+await xxhash64(data)),flags:4,format:0,data}]});}
test('the resource compiler checks template integrity and retains identity while changing dimensions and pixels',async()=>{
 const template=await textureTemplate(),original=readResource(template);await validateResource(original);assert.deepEqual(await writeResource(original),template);
 const corrupted=readResource(template);corrupted.metadata[25]^=1;await assert.rejects(()=>validateResource(corrupted),/checksum/);
 const rgba=Buffer.alloc(32*16*4);for(let i=0;i<rgba.length;i++)rgba[i]=i%251;const sourceBytes=Buffer.from('independent PSD source bytes');
 const result=await compileTexture({template,existing:template,name:'fixture',moduleId:'Fixture',sourceRelative:'Art/fixture.psd',sourceBytes,rgba,width:32,height:16}),resource=readResource(result.tpac),layout=textureLayout(resource.metadata);
 await validateResource(resource);assert.equal(result.id,original.id);assert.equal(result.packageId,original.packageId);assert.equal(resource.metadata.readUInt32LE(layout.width),32);assert.equal(resource.metadata.readUInt32LE(layout.height),16);assert.equal(resource.metadata.readBigUInt64LE(layout.sourceHash).toString(16),await xxhash64(sourceBytes));assert.equal(layout.source,'$BASE/Modules/Fixture/Art/fixture.psd');assert.deepEqual(result.rdc.subarray(165),rgba);assert.equal(result.rdc.readBigUInt64LE(76),BigInt(rgba.length));assert.equal(result.rdc.readBigUInt64LE(93),resource.metadata.readBigUInt64LE(layout.sourceHash));
 const newResource=await compileTexture({template,name:'new_resource',moduleId:'Fixture',sourceRelative:'Art/new_resource.png',sourceBytes,rgba,width:32,height:16});assert.notEqual(newResource.id,original.id);assert.notEqual(newResource.packageId,original.packageId);
 await assert.rejects(()=>compileTexture({template,name:'fixture',moduleId:'Fixture',sourceRelative:'a',sourceBytes,rgba,width:31,height:16}),/dimensions/);
});
test('new banner materials bind the new diffuse GUID and existing materials retain their IDs and shader settings',async()=>{
 const oldTexture=randomUUID(),newTexture=randomUUID(),shader=randomUUID(),metadata=Buffer.concat([u32(0),Buffer.alloc(24),u32(0),u32(0),u32(0),str('no_alpha_blend'),guidBytes(shader),u32(1),u32(0),guidBytes(oldTexture),Buffer.alloc(4),u32(0),Buffer.from('preserved shader settings')]);
 const template=await writeResource({packageId:randomUUID(),id:randomUUID(),type:'1db01393-6902-4f19-83ba-b37a39830717',version:0,name:'fixture',metadata,segments:[]}),original=readResource(template);
 const result=await compileMaterial({template,existing:template,name:'fixture',textureId:newTexture}),updated=readResource(result.tpac);assert.equal(updated.id,original.id);assert.equal(updated.packageId,original.packageId);assert.equal(updated.metadata.indexOf(guidBytes(oldTexture)),-1);assert.notEqual(updated.metadata.indexOf(guidBytes(newTexture)),-1);assert.notEqual(updated.metadata.indexOf(guidBytes(shader)),-1);assert.ok(updated.metadata.includes(Buffer.from('preserved shader settings')));await validateResource(updated);
 const fresh=await compileMaterial({template,name:'new_material',textureId:newTexture,templateTextureId:oldTexture});assert.notEqual(fresh.id,original.id);
});
test('sprite merges preserve other categories and reject cross-category name collisions',()=>{
 const original='<SpriteData><!--keep--><SpriteCategories><SpriteCategory><Name>ui_other</Name><AlwaysLoad/></SpriteCategory><SpriteCategory><Name>ui_banner</Name><AlwaysLoad/></SpriteCategory></SpriteCategories><SpriteParts><SpritePart><Name>other</Name><CategoryName>ui_other</CategoryName></SpritePart><SpritePart><Name>100</Name><CategoryName>ui_banner</CategoryName></SpritePart></SpriteParts><Sprites><GenericSprite><Name>other</Name><SpritePartName>other</SpritePartName></GenericSprite><GenericSprite><Name>100</Name><SpritePartName>100</SpritePartName></GenericSprite></Sprites></SpriteData>';
 const generated='<SpriteData><SpriteCategories><SpriteCategory><Name>ui_banner</Name><AlwaysLoad/><SpriteSheetCount>1</SpriteSheetCount></SpriteCategory></SpriteCategories><SpriteParts><SpritePart><Name>101</Name><CategoryName>ui_banner</CategoryName></SpritePart></SpriteParts><Sprites><GenericSprite><Name>101</Name><SpritePartName>101</SpritePartName></GenericSprite></Sprites></SpriteData>';
 const result=mergeSpriteCategory(original,generated,'ui_banner');assert.ok(result.includes('<!--keep-->'));assert.ok(result.includes('<SpritePart><Name>other</Name><CategoryName>ui_other</CategoryName></SpritePart>'));assert.ok(!result.includes('<Name>100</Name>'));assert.ok(result.includes('<Name>101</Name>'));assert.throws(()=>mergeSpriteCategory(original,generated.replaceAll('101','other'),'ui_banner'),/collides/);
 const preserveLoad=mergeSpriteCategory(original,generated.replace('<AlwaysLoad/>',''),'ui_banner');assert.match(preserveLoad,/<Name>ui_banner<\/Name>[\s\S]*?<AlwaysLoad\/>/);
 const preserveManual=mergeSpriteCategory(original.replace('<Name>ui_banner</Name><AlwaysLoad/>','<Name>ui_banner</Name>'),generated,'ui_banner');assert.doesNotMatch(preserveManual,/<Name>ui_banner<\/Name>(?:(?!<\/SpriteCategory>)[\s\S])*<AlwaysLoad/);
});
async function temporary(run){const temp=await fs.mkdtemp(path.join(os.tmpdir(),'banner-game-test-'));try{await run(temp);}finally{assert.equal(path.dirname(path.resolve(temp)),path.resolve(os.tmpdir()));assert.ok(path.basename(temp).startsWith('banner-game-test-'));await fs.rm(temp,{recursive:true,force:true});}}
async function installFixture(temp){
 const config=normalizeConfig({modulePath:path.join(temp,'development/Fixture'),installedModulePath:path.join(temp,'installed/Fixture'),dataDirectory:path.join(temp,'data')},temp);
 for(const module of [config.modulePath,config.installedModulePath]){await fs.mkdir(path.join(module,'Assets/BannerIcons'),{recursive:true});await fs.writeFile(path.join(module,'SubModule.xml'),'<Module><Id value="Fixture"/></Module>');}
 const batchId='deploy-2026-10-30T20-00-00-000Z-12345678',directory=deploymentDirectory(config,temp,batchId);await fs.mkdir(path.join(directory,'payload'),{recursive:true});const old=Buffer.from('old texture'),next=Buffer.from('new texture'),runtime=Buffer.from('new runtime');
 await fs.writeFile(path.join(config.modulePath,'Assets/BannerIcons/fixture.tpac'),old);await fs.writeFile(path.join(directory,'payload/texture'),next);await fs.writeFile(path.join(directory,'payload/runtime'),runtime);
 const thumbs=path.join(temp,'thumbnails');await fs.mkdir(thumbs);const manifest={status:'review',workspace:workspaceIdentity(config),batchId,thumbnailNames:[],thumbnailDirectory:thumbs,snapshots:[],files:[{kind:'development',relative:'Assets/BannerIcons/fixture.tpac',stored:'payload/texture',expected:sha(old),hash:sha(next)},{kind:'installed',relative:'RuntimeDataCache/fixture.rdc',stored:'payload/runtime',expected:null,hash:sha(runtime)}]};await fs.writeFile(path.join(directory,'deployment.json'),JSON.stringify(manifest));return {config,root:temp,batchId,directory,manifest,old,next};
}
test('resource deployment backs up exact originals and installs new runtime data',()=>temporary(async temp=>{
 const f=await installFixture(temp),result=await installGameDeployment({...f,isRunning:async()=>false});assert.equal(result.status,'installed');assert.equal(result.changedFiles,2);assert.deepEqual(await fs.readFile(path.join(f.config.modulePath,'Assets/BannerIcons/fixture.tpac')),f.next);assert.deepEqual(await fs.readFile(path.join(f.directory,'originals/development/Assets/BannerIcons/fixture.tpac')),f.old);assert.equal(await fs.readFile(path.join(f.config.installedModulePath,'RuntimeDataCache/fixture.rdc'),'utf8'),'new runtime');
}));
test('failure deploying the second resource restores the first and removes locks and temporary files',()=>temporary(async temp=>{
 const f=await installFixture(temp);let renames=0;const io={...fs,rename:async(...args)=>{if(++renames===2)throw new Error('simulated disk failure');return fs.rename(...args);}};
 await assert.rejects(()=>installGameDeployment({...f,io,isRunning:async()=>false}),/simulated disk failure/);assert.deepEqual(await fs.readFile(path.join(f.config.modulePath,'Assets/BannerIcons/fixture.tpac')),f.old);await assert.rejects(()=>fs.stat(path.join(f.config.installedModulePath,'RuntimeDataCache/fixture.rdc')),e=>e.code==='ENOENT');await assert.rejects(()=>fs.stat(path.join(temp,'data/.game-deployment.lock')),e=>e.code==='ENOENT');assert.ok((await fs.readdir(path.join(f.config.modulePath,'Assets/BannerIcons'))).every(f=>!f.endsWith('.tmp')));
}));
test('running game, stale targets and modified payloads stop deployment before any resource is replaced',()=>temporary(async temp=>{
 const f=await installFixture(temp);await assert.rejects(()=>installGameDeployment({...f,isRunning:async()=>true}),/Close Bannerlord/);
 await fs.writeFile(path.join(f.directory,'payload/runtime'),'tampered');await assert.rejects(()=>installGameDeployment({...f,isRunning:async()=>false}),/review file was changed/);assert.deepEqual(await fs.readFile(path.join(f.config.modulePath,'Assets/BannerIcons/fixture.tpac')),f.old);
 await fs.writeFile(path.join(f.directory,'payload/runtime'),'new runtime');await fs.writeFile(path.join(f.config.modulePath,'Assets/BannerIcons/fixture.tpac'),'external edit');await assert.rejects(()=>installGameDeployment({...f,isRunning:async()=>false}),/destination file changed/);
}));
