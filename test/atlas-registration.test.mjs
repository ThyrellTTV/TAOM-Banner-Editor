import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {planAtlasRegistration,installAtlasPackage} from '../atlas-registration.mjs';
import {buildAtlases} from '../atlas-builder.mjs';
import {prepareSourceTextures} from '../prepare-assets.mjs';

async function fixture(run){
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'taom-registration-test-'));
  try{
    const modulePath=path.join(temp,'module'),sourceDirectory=path.join(modulePath,'AssetSources','BannerIcons');
    const xmlPath=path.join(modulePath,'ModuleData','banner_icons.xml'),sprites=path.join(modulePath,'GUI','SpriteParts','ui_taom_bannericons');
    for(const dir of [sourceDirectory,path.dirname(xmlPath),sprites])await fs.mkdir(dir,{recursive:true});
    const xml='<?xml version="1.0" encoding="utf-8"?>\r\n<base><BannerIconData>\r\n    <!-- Preserve this comment and palette exactly. -->\r\n    <BannerIconGroup id="100" name="Gondor Alpha 01"><Icon id="10000" material_name="taom_banners_gondor_alpha_01" texture_index="0" /></BannerIconGroup>\r\n    <BannerColors><Color id="1" hex="0xff000000" /></BannerColors>\r\n  </BannerIconData></base>\r\n';
    await fs.writeFile(xmlPath,xml);
    await run({temp,modulePath,sourceDirectory,xmlPath,sprites,xml});
  }finally{
    const resolved=path.resolve(temp);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('taom-registration-test-'));await fs.rm(resolved,{recursive:true,force:true});
  }
}

test('IDs avoid native groups and orphan GUI thumbnails; XML retains all existing bytes',async()=>fixture(async({temp,modulePath,sprites,xml})=>{
  const gamePath=path.join(temp,'game'),native=path.join(gamePath,'Modules','Native','ModuleData');await fs.mkdir(native,{recursive:true});
  await fs.writeFile(path.join(native,'banner_icons.xml'),'<base><BannerIconData><BannerIconGroup id="101"><Icon id="32000"/></BannerIconGroup></BannerIconData></base>');
  await fs.writeFile(path.join(sprites,'32100.png'),'Keep orphan thumbnail');
  const plan=await planAtlasRegistration({modulePath,gamePath,atlases:[{name:'taom_banners_gondor_alpha_02',count:16},{name:'taom_banners_gondor_alpha_03',count:1}]});
  assert.equal(plan.atlases[0].groupId,322);assert.equal(plan.atlases[0].icons[0].id,32200);
  assert.equal(plan.atlases[1].groupId,102);assert.equal(plan.atlases[1].icons[0].id,10200);
  assert.equal(plan.changed.toString().replace(plan.snippet,''),xml);
  assert.ok(!plan.snippet.replaceAll('\r\n','').includes('\n'));
}));

test('review-only build creates proposed XML and transparent PNGs without changing the module; uncompiled PSDs preview',async()=>fixture(async({temp,modulePath,sourceDirectory,xmlPath,sprites,xml})=>{
  const png=await sharp({create:{width:64,height:64,channels:4,background:'#0000'}}).composite([{input:await sharp({create:{width:15,height:25,channels:4,background:'#fff'}}).png().toBuffer(),left:3,top:7}]).png().toBuffer();
  const result=await buildAtlases({modulePath,sourceDirectory,files:[{name:'new.png',data:png}],faction:'gondor',category:'ornament',outputDirectory:path.join(temp,'builds'),install:false});
  assert.equal(result.registration.installed,false);assert.equal(await fs.readFile(xmlPath,'utf8'),xml);
  assert.deepEqual(await fs.readdir(sourceDirectory),[]);assert.deepEqual(await fs.readdir(sprites),[]);
  const atlas=result.atlases[0],cell=atlas.cells[0];assert.equal(atlas.installedPath,null);
  assert.ok((await fs.readFile(path.join(result.directory,'banner_icons.xml'),'utf8')).includes(`id="${cell.iconId}"`));
  assert.equal((await sharp(path.join(result.directory,cell.thumbnail)).metadata()).hasAlpha,true);
  // The game's TPAC cache has no material for this new atlas yet.
  await fs.copyFile(path.join(result.directory,atlas.psd),path.join(sourceDirectory,atlas.psd));
  const root=path.join(temp,'editor');await fs.mkdir(path.join(root,'cache','textures'),{recursive:true});
  const assets=await prepareSourceTextures(root,{materials:{},textures:{},errors:[]},modulePath,[{material:atlas.name,source:'TAOM'}]);
  assert.equal(assets.errors.length,0);const texture=assets.textures[assets.materials[atlas.name].slots['0']];
  assert.equal((await sharp(path.join(root,texture.images[0])).metadata()).width,2048);
}));

test('stale XML and conflicting targets stop installation; failed copies roll back newly installed files',async()=>fixture(async({temp,modulePath,sourceDirectory,xmlPath,sprites,xml})=>{
  const directory=path.join(temp,'package');await fs.mkdir(path.join(directory,'thumbnails'),{recursive:true});
  const plan=await planAtlasRegistration({modulePath,atlases:[{name:'taom_banners_gondor_alpha_02',count:1}]});
  const id=plan.atlases[0].icons[0].id,psd='taom_banners_gondor_alpha_02.psd';
  const atlases=[{psd,cells:[{iconId:id,thumbnail:`thumbnails/${id}.png`}]}];
  await fs.writeFile(path.join(directory,psd),'New PSD');
  await fs.writeFile(xmlPath,xml+'<!-- External edit -->');
  await assert.rejects(installAtlasPackage({plan,atlases,directory,sourceDirectory}),/changed during the build/);
  assert.equal(await fs.readFile(xmlPath,'utf8'),xml+'<!-- External edit -->');
  await fs.writeFile(xmlPath,xml);await fs.writeFile(path.join(sprites,id+'.png'),'Existing GUI PNG');
  await assert.rejects(installAtlasPackage({plan,atlases,directory,sourceDirectory}),/overwrite an existing file/);
  assert.equal(await fs.readFile(path.join(sprites,id+'.png'),'utf8'),'Existing GUI PNG');
  await fs.unlink(path.join(sprites,id+'.png'));
  // Missing staged thumbnail fails after copying the PSD: the PSD must be removed.
  await assert.rejects(installAtlasPackage({plan,atlases,directory,sourceDirectory}),/ENOENT/);
  assert.deepEqual(await fs.readdir(sourceDirectory),[]);assert.equal(await fs.readFile(xmlPath,'utf8'),xml);
  await assert.rejects(fs.stat(xmlPath+'.atlas-import.lock'),{code:'ENOENT'});
}));
