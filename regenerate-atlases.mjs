import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {XMLParser} from 'fast-xml-parser';
import sharp from 'sharp';
import {readPsd} from 'ag-psd';
import {writeAtlasPage,ATLAS_SIZE,CELL_SIZE} from './atlas-builder.mjs';

const hash=data=>createHash('sha256').update(data).digest('hex');
const hashFile=async file=>hash(await fs.readFile(file));
const array=value=>value===undefined?[]:Array.isArray(value)?value:[value];

export function registeredAtlases(xml) {
  const parsed=new XMLParser({ignoreAttributes:false,attributeNamePrefix:''}).parse(xml);
  const materials=new Map(),ids=new Set();
  for(const group of array(parsed.base?.BannerIconData?.BannerIconGroup))for(const icon of array(group.Icon)){
    const id=String(icon.id),name=String(icon.material_name),textureIndex=Number(icon.texture_index);
    if(!/^\d+$/.test(id)||ids.has(id))throw new Error('Invalid or duplicate icon ID: '+id);
    if(!/^taom_banners_[a-z0-9_]+$/.test(name))throw new Error('Unexpected material: '+name);
    if(!Number.isInteger(textureIndex)||textureIndex<0||textureIndex>15)throw new Error('Invalid texture index for '+id);
    ids.add(id);
    if(!materials.has(name))materials.set(name,[]);
    if(materials.get(name).some(i=>i.textureIndex===textureIndex))throw new Error('Duplicate texture index in '+name);
    materials.get(name).push({id,textureIndex});
  }
  if(!materials.size)throw new Error('No registered banner materials found.');
  return [...materials].map(([name,icons])=>({name,icons:icons.sort((a,b)=>a.textureIndex-b.textureIndex)}));
}

// Read the saved composite rather than trusting layer placement or manifest data.
export async function verifyRegisteredPage(file,icons) {
  const psd=readPsd(await fs.readFile(file),{useImageData:true,skipLayerImageData:true,skipThumbnail:true});
  if(psd.width!==ATLAS_SIZE||psd.height!==ATLAS_SIZE||!psd.imageData)throw new Error('Invalid PSD canvas: '+file);
  const expected=new Set(icons.map(i=>i.textureIndex)),data=psd.imageData.data;
  for(let slot=0;slot<16;slot++){
    let left=512,top=512,right=-1,bottom=-1;
    for(let y=0;y<512;y++)for(let x=0;x<512;x++){
      const i=((Math.floor(slot/4)*512+y)*2048+slot%4*512+x)*4;
      if(data[i]!==0||data[i+2]!==0||data[i+3]!==255)throw new Error('Unexpected colour/opacity in '+file);
      if(data[i+1]>0){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
    }
    if(expected.has(slot)){
      if(right<0||(left+right+1)/2!==256||(top+bottom+1)/2!==256)throw new Error('Saved composite is not centred in slot '+slot+': '+file);
    }else if(right>=0)throw new Error('Unregistered slot is not empty: '+file+' slot '+slot);
  }
  return true;
}

export async function regenerateAtlases({modulePath,thumbnailDirectories,outputDirectory,onProgress=()=>{}}) {
  modulePath=path.resolve(modulePath);
  if(!thumbnailDirectories?.length)throw new Error('At least one thumbnail directory is required.');
  const xmlPath=path.join(modulePath,'ModuleData','banner_icons.xml'),xml=await fs.readFile(xmlPath);
  const plans=registeredAtlases(xml.toString('utf8'));
  const sourceDirectory=path.join(modulePath,'AssetSources','BannerIcons');
  const directories=await Promise.all(thumbnailDirectories.map(async dir=>({path:path.resolve(dir),names:new Set(await fs.readdir(dir))})));
  const sourceUse={};
  // Resolve every source before building any page. First directory wins.
  for(const plan of plans){
    plan.originalSha256=await hashFile(path.join(sourceDirectory,plan.name+'.psd'));
    for(const icon of plan.icons){
      const directory=directories.find(d=>d.names.has(icon.id+'.png'));
      if(!directory)throw new Error('Missing thumbnail: '+icon.id+'.png');
      icon.sourcePath=path.join(directory.path,icon.id+'.png');
      icon.sourceSha256=await hashFile(icon.sourcePath);
      sourceUse[directory.path]=(sourceUse[directory.path]||0)+1;
    }
  }
  const registered=new Set(plans.map(p=>p.name+'.psd'));
  const unregistered=[];
  for(const name of await fs.readdir(sourceDirectory))if(name.endsWith('.psd')&&!registered.has(name))unregistered.push({name,sha256:await hashFile(path.join(sourceDirectory,name))});
  const directory=path.join(path.resolve(outputDirectory),'regenerate-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));
  await fs.mkdir(directory,{recursive:true});
  await fs.writeFile(path.join(directory,'banner_icons.xml'),xml,{flag:'wx'});
  const manifest={version:1,status:'building',directory,modulePath,sourceDirectory,xmlPath,xmlSha256:hash(xml),createdAt:new Date().toISOString(),atlasSize:ATLAS_SIZE,cellSize:CELL_SIZE,scaling:'downscale-only',centering:'visible-alpha-bounds',sourceUse,unregistered,atlases:[]};
  const save=()=>fs.writeFile(path.join(directory,'regeneration.json'),JSON.stringify(manifest,null,2));
  await save();
  try{
    for(const plan of plans){
      onProgress('Building '+plan.name);
      const files=[];
      for(const icon of plan.icons){const data=await fs.readFile(icon.sourcePath);if(hash(data)!==icon.sourceSha256)throw new Error('Thumbnail changed during rebuild: '+icon.sourcePath);files.push({name:icon.id+'.png',id:icon.id,textureIndex:icon.textureIndex,data});}
      const atlas=await writeAtlasPage({name:plan.name,files,directory});
      atlas.originalSha256=plan.originalSha256;
      atlas.sha256=await hashFile(path.join(directory,atlas.psd));
      for(const cell of atlas.cells){const input=plan.icons.find(i=>i.id===cell.iconId);Object.assign(cell,{sourcePath:input.sourcePath,sourceSha256:input.sourceSha256});if(cell.warnings.length)throw new Error('PNG requires review: '+cell.sourcePath+' '+cell.warnings.join(' '));}
      await verifyRegisteredPage(path.join(directory,atlas.psd),plan.icons);
      manifest.atlases.push(atlas);
      await save();
    }
    // A review sheet covering every atlas, separate from game-mask composites.
    const tiles=[];const cols=6,tile=336,height=372;
    for(let n=0;n<manifest.atlases.length;n++){
      const atlas=manifest.atlases[n],left=n%cols*tile,top=Math.floor(n/cols)*height;
      const title=atlas.name.replace('taom_banners_','');
      tiles.push({input:Buffer.from(`<svg width="336" height="36" xmlns="http://www.w3.org/2000/svg"><text x="168" y="23" text-anchor="middle" fill="white" font-family="Arial" font-size="15">${title}</text></svg>`),left,top});
      tiles.push({input:await sharp(path.join(directory,atlas.preview)).resize(tile,tile).png().toBuffer(),left,top:top+36});
    }
    await sharp({create:{width:cols*tile,height:Math.ceil(manifest.atlases.length/cols)*height,channels:4,background:'#171b22'}}).composite(tiles).png().toFile(path.join(directory,'all-atlases.png'));
    manifest.status='verified';await save();return manifest;
  }catch(error){manifest.status='failed';manifest.error=error.message;await save();throw error;}
}

export async function installRegeneration(directory,{onProgress=()=>{}}={}) {
  directory=path.resolve(directory);
  const manifestFile=path.join(directory,'regeneration.json');
  const manifest=JSON.parse(await fs.readFile(manifestFile,'utf8'));
  if(manifest.status!=='verified')throw new Error('Build is not awaiting installation: '+manifest.status);
  const assertXml=async()=>{if(await hashFile(manifest.xmlPath)!==manifest.xmlSha256)throw new Error('banner_icons.xml changed since this build.');};
  const assertUnregistered=async()=>{for(const file of manifest.unregistered)if(await hashFile(path.join(manifest.sourceDirectory,file.name))!==file.sha256)throw new Error('Unregistered PSD changed: '+file.name);};
  await assertXml();await assertUnregistered();
  // Validate all inputs and backups before replacing the first module PSD.
  const backup=path.join(directory,'originals');await fs.mkdir(backup,{recursive:true});
  for(const atlas of manifest.atlases){
    const target=path.join(manifest.sourceDirectory,atlas.psd);
    if(await hashFile(target)!==atlas.originalSha256)throw new Error('PSD changed since this build: '+target);
    if(await hashFile(path.join(directory,atlas.psd))!==atlas.sha256)throw new Error('Staged PSD changed: '+atlas.psd);
    await verifyRegisteredPage(path.join(directory,atlas.psd),atlas.cells);
    await fs.copyFile(target,path.join(backup,atlas.psd),fs.constants.COPYFILE_EXCL);
    if(await hashFile(path.join(backup,atlas.psd))!==atlas.originalSha256)throw new Error('Backup verification failed: '+atlas.psd);
  }
  await assertXml();const installed=[];
  try{
    for(const atlas of manifest.atlases){
      const target=path.join(manifest.sourceDirectory,atlas.psd),temp=target+'.'+randomUUID()+'.tmp';
      try{
        await fs.copyFile(path.join(directory,atlas.psd),temp,fs.constants.COPYFILE_EXCL);
        if(await hashFile(target)!==atlas.originalSha256)throw new Error('PSD changed during installation: '+target);
        await fs.rename(temp,target);installed.push(atlas);
        if(await hashFile(target)!==atlas.sha256)throw new Error('Installed PSD hash mismatch: '+target);
        onProgress('Installed '+atlas.psd);
      }finally{await fs.unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
    }
    await assertXml();await assertUnregistered();
    manifest.status='installed';manifest.installedAt=new Date().toISOString();manifest.backupDirectory=backup;
    await fs.writeFile(manifestFile,JSON.stringify(manifest,null,2));return manifest;
  }catch(error){
    // Restore only files still containing this build; never overwrite a newer user edit.
    for(const atlas of installed)if(await hashFile(path.join(manifest.sourceDirectory,atlas.psd))===atlas.sha256)await fs.copyFile(path.join(backup,atlas.psd),path.join(manifest.sourceDirectory,atlas.psd));
    manifest.status='install-failed';manifest.error=error.message;await fs.writeFile(manifestFile,JSON.stringify(manifest,null,2));throw error;
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2),options={thumbnailDirectories:[]};let install=false,installBuild;
    for(let i=0;i<args.length;i++){
      const arg=args[i];
      if(arg==='--install')install=true;
      else if(arg==='--module')options.modulePath=args[++i];
      else if(arg==='--input')options.thumbnailDirectories.push(args[++i]);
      else if(arg==='--output')options.outputDirectory=args[++i];
      else if(arg==='--install-build')installBuild=args[++i];
      else throw new Error('Usage: node regenerate-atlases.mjs --input <primary-folder> [--input <fallback-folder>] [--module <module>] [--output <folder>] [--install], or --install-build <verified-build>');
    }
    options.modulePath??=JSON.parse(await fs.readFile(new URL('./config.json',import.meta.url),'utf8')).modulePath;
    options.outputDirectory??=fileURLToPath(new URL('./atlas-builds',import.meta.url));options.onProgress=console.log;
    let result=installBuild?await installRegeneration(installBuild,{onProgress:console.log}):await regenerateAtlases(options);
    if(install&&!installBuild)result=await installRegeneration(result.directory,{onProgress:console.log});
    console.log(JSON.stringify({status:result.status,atlases:result.atlases.length,icons:result.atlases.reduce((n,a)=>n+a.cells.length,0),sourceUse:result.sourceUse,directory:result.directory,backupDirectory:result.backupDirectory},null,2));
  }catch(error){console.error(error.stack);process.exitCode=1;}
}
