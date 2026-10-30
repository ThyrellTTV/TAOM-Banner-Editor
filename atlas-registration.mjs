import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {insideModule} from './configuration.mjs';

const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'',processEntities:false});
const list=value=>value==null?[]:Array.isArray(value)?value:[value];
const hash=data=>createHash('sha256').update(data).digest('hex');
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export async function readIconRegistry(modulePath,registryFile='ModuleData/banner_icons.xml'){
  const xmlPath=insideModule(modulePath,registryFile||'ModuleData/banner_icons.xml'),original=await fs.readFile(xmlPath);
  const xml=original.toString('utf8');
  if(XMLValidator.validate(xml)!==true)throw new Error('banner_icons.xml is not valid XML.');
  const groups=list(parser.parse(xml).base?.BannerIconData?.BannerIconGroup);
  if(!/<\/BannerIconData\s*>/.test(xml))throw new Error('banner_icons.xml has no BannerIconData section.');
  return {xmlPath,original,xml,groups,materials:groups.flatMap(g=>list(g.Icon).map(i=>i.material_name))};
}

export async function planAtlasRegistration({modulePath,gamePath,atlases,registry,registryFile,nativeRegistryFile='Modules/Native/ModuleData/banner_icons.xml',thumbnailDirectory:thumbnailFolder,atlasPrefix='taom_banners',groupLabel='TAOM'}){
  registry??=await readIconRegistry(modulePath,registryFile);
  const {xmlPath,original,xml,groups}=registry;
  const usedGroups=new Set(),usedIcons=new Set();
  const reserve=items=>{for(const group of items){usedGroups.add(Number(group.id));for(const icon of [...list(group.Icon),...list(group.Background)])usedIcons.add(Number(icon.id));}};
  reserve(groups);
  if(gamePath){const native=parser.parse(await fs.readFile(path.resolve(gamePath,nativeRegistryFile),'utf8'));reserve(list(native.base?.BannerIconData?.BannerIconGroup));}
  const thumbnailDirectory=path.resolve(modulePath,thumbnailFolder||'GUI/SpriteParts/ui_taom_bannericons');
  const sprites=await fs.readdir(thumbnailDirectory).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
  for(const name of sprites)if(/^\d+\.png$/i.test(name))usedIcons.add(Number(name.slice(0,-4)));
  const materialNames=new Set(registry.materials),planned=[];
  for(const atlas of atlases){
    if(materialNames.has(atlas.name))throw new Error('Material is already registered: '+atlas.name);
    const match=atlas.name.startsWith(atlasPrefix+'_')&&atlas.name.slice(atlasPrefix.length+1).match(/^(.+)_(alpha|ornaments)_(\d+)$/);
    if(!match)throw new Error('Invalid atlas material: '+atlas.name);
    const [,faction,category,number]=match,prefix=`${atlasPrefix}_${faction}_${category}_`;
    const family=groups.filter(g=>list(g.Icon).some(i=>i.material_name?.startsWith(prefix)));
    const first=family.map(g=>Number(g.id)).filter(Number.isSafeInteger).sort((a,b)=>a-b)[0];
    let groupId=first===undefined?Math.max(99,...usedGroups,...[...usedIcons].map(id=>Math.floor(id/100)))+1:first+Number(number)-1;
    const occupied=id=>usedGroups.has(id)||Array.from({length:100},(_,i)=>id*100+i).some(id=>usedIcons.has(id));
    if(groupId<100||occupied(groupId))groupId=Math.max(99,...usedGroups,...[...usedIcons].map(id=>Math.floor(id/100)))+1;
    while(occupied(groupId))groupId++;
    if(!Number.isSafeInteger(groupId)||groupId*100+99>2_147_483_647)throw new Error('No safe icon ID range is available.');
    usedGroups.add(groupId);materialNames.add(atlas.name);
    const label=faction.split('_').map(word=>word[0].toUpperCase()+word.slice(1)).join(' ');
    const title=`{=!}${groupLabel} ${label} ${category==='alpha'?'Alpha':'Ornaments'} ${number.padStart(2,'0')}`;
    const icons=Array.from({length:atlas.count},(_,textureIndex)=>({id:groupId*100+textureIndex,textureIndex}));
    for(const icon of icons)usedIcons.add(icon.id);
    planned.push({name:atlas.name,groupId,title,icons});
  }
  const newline=xml.includes('\r\n')?'\r\n':'\n';
  const snippet=planned.map(atlas=>[
    `    <BannerIconGroup id="${atlas.groupId}" name="${escape(atlas.title)}" is_pattern="false">`,
    ...atlas.icons.map(icon=>`      <Icon id="${icon.id}" material_name="${atlas.name}" texture_index="${icon.textureIndex}" />`),
    '    </BannerIconGroup>'
  ].join(newline)).join(newline+newline)+newline+newline;
  const marker=/<BannerColors\b/.test(xml)?/[\t ]*<BannerColors\b/:/[\t ]*<\/BannerIconData\s*>/;
  if(!marker.test(xml))throw new Error('Cannot find the insertion point in banner_icons.xml.');
  const changed=Buffer.from(xml.replace(marker,match=>snippet+match));
  if(XMLValidator.validate(changed.toString('utf8'))!==true)throw new Error('Generated banner icon registration is not valid XML.');
  return {xmlPath,registryRelative:path.relative(modulePath,xmlPath),original,changed,snippet,thumbnailDirectory,atlases:planned};
}

// XML is committed last. On failure, remove only files created by this import.
export async function installAtlasPackage({plan,atlases,directory,sourceDirectory}){
  const lock=plan.xmlPath+'.atlas-import.lock';let handle;
  try{handle=await fs.open(lock,'wx');}catch(error){if(error.code==='EEXIST')throw new Error('Another atlas import is saving. Try again after it finishes.');throw error;}
  const created=[],temp=plan.xmlPath+'.'+randomUUID()+'.tmp';
  const backup=path.join(directory,'backups',plan.registryRelative||'ModuleData/banner_icons.xml');
  try{
    if(!(await fs.readFile(plan.xmlPath)).equals(plan.original))throw new Error('banner_icons.xml changed during the build. Generate the atlas again.');
    const files=[];
    for(const atlas of atlases){
      files.push({source:path.join(directory,atlas.psd),target:path.join(sourceDirectory,atlas.psd)});
      for(const cell of atlas.cells)files.push({source:path.join(directory,cell.thumbnail),target:path.join(plan.thumbnailDirectory,cell.iconId+'.png')});
    }
    for(const file of files)if(await fs.stat(file.target).catch(error=>{if(error.code==='ENOENT')return null;throw error;}))throw new Error('Import would overwrite an existing file: '+file.target);
    await fs.mkdir(path.dirname(backup),{recursive:true});await fs.writeFile(backup,plan.original,{flag:'wx'});
    await fs.mkdir(sourceDirectory,{recursive:true});await fs.mkdir(plan.thumbnailDirectory,{recursive:true});
    for(const file of files){
      const data=await fs.readFile(file.source);await fs.copyFile(file.source,file.target,fs.constants.COPYFILE_EXCL);
      created.push({target:file.target,sha256:hash(data)});
      if(hash(await fs.readFile(file.target))!==hash(data))throw new Error('Installed file verification failed: '+file.target);
    }
    await fs.writeFile(temp,plan.changed,{flag:'wx'});
    if(!(await fs.readFile(plan.xmlPath)).equals(plan.original))throw new Error('banner_icons.xml changed while saving. Generate the atlas again.');
    await fs.rename(temp,plan.xmlPath);
    for(const atlas of atlases){atlas.installedPath=path.join(sourceDirectory,atlas.psd);for(const cell of atlas.cells)cell.installedThumbnail=path.join(plan.thumbnailDirectory,cell.iconId+'.png');}
    return {installed:true,xmlPath:plan.xmlPath,xmlBackup:backup,thumbnailDirectory:plan.thumbnailDirectory,icons:atlases.reduce((n,a)=>n+a.cells.length,0)};
  }catch(error){
    for(const file of created)if(await fs.readFile(file.target).then(hash).catch(()=>null)===file.sha256)await fs.unlink(file.target);
    throw error;
  }finally{
    await fs.unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});
    await handle.close();await fs.unlink(lock);
  }
}
