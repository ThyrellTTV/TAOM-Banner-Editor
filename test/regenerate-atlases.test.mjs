import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {registeredAtlases,regenerateAtlases,installRegeneration,verifyRegisteredPage} from '../regenerate-atlases.mjs';

test('registered mappings reject duplicate IDs and slots instead of repacking them',()=>{
  const xml=icons=>`<base><BannerIconData><BannerIconGroup>${icons}</BannerIconGroup></BannerIconData></base>`;
  const icon=(id,slot)=>`<Icon id="${id}" material_name="taom_banners_test_alpha_01" texture_index="${slot}"/>`;
  assert.throws(()=>registeredAtlases(xml(icon(1,0)+icon(1,1))),/duplicate icon ID/);
  assert.throws(()=>registeredAtlases(xml(icon(1,0)+icon(2,0))),/Duplicate texture index/);
  assert.throws(()=>registeredAtlases(xml(icon(1,16))),/Invalid texture index/);
});

test('regeneration preserves XML holes, prefers original PNGs, verifies backups and rejects stale installs',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'taom-regeneration-test-'));
  try{
    const modulePath=path.join(temp,'module'),primary=path.join(temp,'primary'),fallback=path.join(temp,'fallback');
    const source=path.join(modulePath,'AssetSources','BannerIcons'),data=path.join(modulePath,'ModuleData');
    for(const dir of [source,data,primary,fallback])await fs.mkdir(dir,{recursive:true});
    const name='taom_banners_test_alpha_01',old='Original PSD bytes',xml=`<base><BannerIconData><BannerIconGroup><Icon id="1" material_name="${name}" texture_index="0"/><Icon id="2" material_name="${name}" texture_index="7"/></BannerIconGroup></BannerIconData></base>`;
    const target=path.join(source,name+'.psd'),xmlFile=path.join(data,'banner_icons.xml');
    await fs.writeFile(target,old);await fs.writeFile(xmlFile,xml);
    await fs.writeFile(path.join(source,'unregistered.psd'),'Keep this user file');
    const png=async(w,h)=>sharp({create:{width:w,height:h,channels:4,background:'#fff'}}).png().toBuffer();
    // Transparent asymmetric canvases exercise the full source-to-composite path.
    const art=async(w,h)=>sharp({create:{width:80,height:80,channels:4,background:'#0000'}}).composite([{input:await png(w,h),left:11,top:3}]).png().toBuffer();
    await fs.writeFile(path.join(primary,'1.png'),await art(7,13));
    await fs.writeFile(path.join(fallback,'1.png'),await art(40,40));
    await fs.writeFile(path.join(fallback,'2.png'),await art(24,17));
    const result=await regenerateAtlases({modulePath,thumbnailDirectories:[primary,fallback],outputDirectory:path.join(temp,'builds')});
    assert.equal(result.status,'verified');assert.equal(await fs.readFile(target,'utf8'),old);
    const atlas=result.atlases[0];assert.deepEqual(atlas.cells.map(c=>c.textureIndex),[0,7]);
    assert.equal(atlas.cells[0].sourcePath,path.join(primary,'1.png'));
    assert.equal(atlas.cells[1].sourcePath,path.join(fallback,'2.png'));
    assert.equal(atlas.cells[0].trimmedBounds.width,7);assert.equal(atlas.cells[0].scale,1);
    await verifyRegisteredPage(path.join(result.directory,atlas.psd),atlas.cells);
    await fs.writeFile(target,'User edited PSD');
    await assert.rejects(installRegeneration(result.directory),/PSD changed since this build/);
    assert.equal(await fs.readFile(target,'utf8'),'User edited PSD');
    await fs.writeFile(target,old);await fs.writeFile(xmlFile,xml+' ');
    await assert.rejects(installRegeneration(result.directory),/banner_icons.xml changed/);
    await fs.writeFile(xmlFile,xml);
    const installed=await installRegeneration(result.directory);
    assert.equal(installed.status,'installed');
    assert.equal(await fs.readFile(path.join(installed.backupDirectory,atlas.psd),'utf8'),old);
    assert.equal(await fs.readFile(xmlFile,'utf8'),xml);
    assert.equal(await fs.readFile(path.join(source,'unregistered.psd'),'utf8'),'Keep this user file');
    assert.deepEqual(await fs.readFile(target),await fs.readFile(path.join(result.directory,atlas.psd)));
  }finally{
    const resolved=path.resolve(temp);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('taom-regeneration-test-'));await fs.rm(resolved,{recursive:true,force:true});
  }
});
