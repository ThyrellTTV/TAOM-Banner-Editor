import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import sharp from 'sharp';
import {readPsd,initializeCanvas} from 'ag-psd';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {configPaths,insideModule,workspaceIdentity} from './configuration.mjs';
import {readIconRegistry} from './atlas-registration.mjs';
import {atlasSourceFile} from './atlas-manager.mjs';
import {validateInstalledModule} from './source-store.mjs';
import {compileTexture,compileMaterial,readResource,materialLayout} from './resource-compiler.mjs';
import {normalizeResourceSettings} from './public/resource-settings.mjs';
import {resizeAtlas,encodeTexture} from './texture-encoding.mjs';
initializeCanvas(undefined,(width,height)=>({width,height,data:new Uint8ClampedArray(width*height*4)}));
const execute=promisify(execFile),list=v=>v==null?[]:Array.isArray(v)?v:[v],sha=b=>createHash('sha256').update(b).digest('hex');
const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'',processEntities:false});
const hashFile=file=>fs.readFile(file).then(sha).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
const blocks=(xml,tag)=>xml.match(new RegExp('<'+tag+'\\b[^>]*>[\\s\\S]*?<\\/'+tag+'>','g'))||[];
const text=(block,tag)=>block.match(new RegExp('<'+tag+'>([\\s\\S]*?)<\\/'+tag+'>'))?.[1];
export function mergeSpriteCategory(original,generated,category){
 for(const xml of [original,generated])if(XMLValidator.validate(xml)!==true)throw new Error('Invalid SpriteData XML.');
 const oldParts=blocks(original,'SpritePart').filter(b=>text(b,'CategoryName')===category),oldNames=new Set(oldParts.map(b=>text(b,'Name')));
 if(blocks(original,'NineRegionSprite').some(b=>oldNames.has(text(b,'SpritePartName'))))throw new Error('Banner thumbnail packing requires generic sprites; this category contains nine-region sprites.');
 const generatedParts=new Set(blocks(generated,'SpritePart').map(b=>text(b,'Name')));let merged=original;
 if(blocks(generated,'SpriteCategory').some(b=>text(b,'Name')!==category))throw new Error('The staged generator included an unrelated category.');
 for(const [tag,belongs,section] of [['SpriteCategory',b=>text(b,'Name')===category,'SpriteCategories'],['SpritePart',b=>text(b,'CategoryName')===category,'SpriteParts'],['GenericSprite',b=>oldNames.has(text(b,'SpritePartName')),'Sprites']]){
  const additions=blocks(generated,tag),re=new RegExp('<'+tag+'\\b[^>]*>[\\s\\S]*?<\\/'+tag+'>','g');let inserted=false;
  if(tag==='SpriteCategory'){
   const previous=blocks(original,tag).find(b=>belongs(b)),load=/<AlwaysLoad\b[^>]*(?:\/>|>[\s\S]*?<\/AlwaysLoad>)/g;
   if(previous){const originalLoad=previous.match(load)?.[0];additions[0]=additions[0].replace(load,'');if(originalLoad)additions[0]=additions[0].replace('</SpriteCategory>',originalLoad+'</SpriteCategory>');}
  }
  if(tag==='GenericSprite')for(const b of [...blocks(merged,tag),...blocks(merged,'NineRegionSprite')])if(generatedParts.has(text(b,'Name'))&&!belongs(b))throw new Error('A thumbnail name collides with another sprite category: '+text(b,'Name'));
  merged=merged.replace(re,block=>{if(!belongs(block))return block;if(inserted)return '';inserted=true;return additions.join('\r\n    ');});
  if(!inserted){const closing='</'+section+'>';if(!merged.includes(closing))throw new Error('Missing SpriteData section '+section);merged=merged.replace(closing,additions.join('\r\n    ')+'\r\n  '+closing);}
  for(const preserved of blocks(original,tag).filter(b=>!belongs(b)))if(!merged.includes(preserved))throw new Error('An unrelated sprite mapping changed.');
 }
 if(XMLValidator.validate(merged)!==true)throw new Error('Generated SpriteData merge is invalid.');return merged;
}
export function deploymentDirectory(config,root,batchId){if(!/^deploy-[0-9TZ-]+-[a-f0-9]{8}$/.test(batchId))throw new Error('Invalid deployment review.');return path.join(configPaths(config,root).data,'game-builds',batchId);}
async function gameIsRunning(){if(process.platform!=='win32')return false;const result=await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',"if(Get-Process -Name 'Bannerlord','Bannerlord.Native' -ErrorAction SilentlyContinue){Write-Output 'running'}"],{windowsHide:true});return result.stdout.includes('running');}
async function packageIndex(config,root){
 const found=new Map(),locations=[...configPaths(config,root).moduleAssets,path.join(config.modulePath,'Assets/GauntletUI')],seen=new Set();
 async function walk(location){if(seen.has(location))return;seen.add(location);const stat=await fs.stat(location).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(!stat)return;if(stat.isDirectory()){for(const e of await fs.readdir(location,{withFileTypes:true}))if(e.isDirectory()||e.name.endsWith('.tpac'))await walk(path.join(location,e.name));return;}if(!location.endsWith('.tpac')||stat.size>4*1024*1024)return;let item;try{item=readResource(await fs.readFile(location));}catch{return;}const key=item.type+':'+item.name;if(found.has(key)&&found.get(key)!==location)throw new Error('Duplicate editable resource '+item.name);found.set(key,location);}
 for(const location of locations)await walk(location);return found;
}
const TYPES={texture:'c974cbcb-5f1c-49f6-9a32-2b5b6c92c2e8',material:'1db01393-6902-4f19-83ba-b37a39830717'};
export function assertSupportedGameVersion(version){
 if(!/^v?1\.5\.(?:6|7)(?:\.|$)/.test(version||''))throw new Error('Installed Bannerlord version '+(version||'unknown')+' is not supported for automatic resource compilation. Supported versions: 1.5.6 and 1.5.7.');
}
export async function resourceSettingOptions({config,root}){
 const registry=await readIconRegistry(config.modulePath,configPaths(config,root).registry),index=await packageIndex(config,root),materials=[];
 for(const name of [...new Set(registry.materials)]){const file=index.get(TYPES.material+':'+name);if(!file)continue;try{const data=materialLayout(readResource(await fs.readFile(file)).metadata);materials.push({name,blendMode:data.blendMode,alphaTest:data.alphaTest,flags:data.flags,shaderFlags:data.shaderFlags,vertexFlags:data.vertexFlags,shader:data.shader});}catch{}}
 return {materials};
}
export async function buildGameDeployment({config,root,material,expected}){
 const resourceSettings=normalizeResourceSettings(config.resourceSettings);
 const p=configPaths(config,root),nativeFile=path.join(config.gamePath,'Modules/Native/SubModule.xml'),nativeBytes=await fs.readFile(nativeFile),nativeXml=nativeBytes.toString('utf8');
 assertSupportedGameVersion(parser.parse(nativeXml).Module?.Version?.value);
 const registry=await readIconRegistry(config.modulePath,p.registry),materials=[...new Set(registry.materials)];
 if(!materials.includes(material)||!/^[-a-z0-9_]{1,160}$/i.test(material))throw new Error('Choose a registered module atlas.');
 const source=await atlasSourceFile(p.atlasSources,material);if(!source)throw new Error('Atlas source PSD/PNG not found.');
 const bytes=await fs.readFile(source);if(expected&&(expected.xml!==sha(registry.original)||expected.source!==sha(bytes)))throw new Error('The atlas or registry changed. Reload it before compiling.');
 const moduleFile=path.join(config.modulePath,'SubModule.xml'),moduleBytes=await fs.readFile(moduleFile),moduleId=parser.parse(moduleBytes.toString('utf8')).Module?.Id?.value;
 // Project sources can live in _Module. The sprite-packer staging folder and
 // engine source references use SubModule.xml's ID, independently of that name.
 if(!/^[-a-z0-9_.]{1,160}$/i.test(moduleId))throw new Error('Resource compilation requires a valid SubModule ID.');
 const category=path.basename(p.thumbnails);if(!/^ui_[-a-z0-9_]+$/i.test(category))throw new Error('The GUI thumbnail category must be named ui_<category>.');
 const relative=file=>{insideModule(config.modulePath,path.relative(config.modulePath,file));return path.relative(config.modulePath,file).replaceAll('\\','/');};
 const sourceRelative=relative(source),thumbnailRelative=relative(p.thumbnails),registryRelative=relative(p.registry);
 const targets=[{kind:'development',module:config.modulePath}];
 if(config.installedModulePath&&path.resolve(config.installedModulePath).toLowerCase()!==path.resolve(config.modulePath).toLowerCase()){await validateInstalledModule(config.modulePath,config.installedModulePath);if(path.basename(config.installedModulePath)!==moduleId)throw new Error('The installed module folder must match the SubModule ID.');targets.push({kind:'installed',module:config.installedModulePath});}
 const batchId='deploy-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8),directory=deploymentDirectory(config,root,batchId),modules=path.join(directory,'Modules'),stage=path.join(modules,moduleId),snapshots=[],files=[];
 await fs.mkdir(path.join(stage,'GUI/SpriteParts',category),{recursive:true});await fs.writeFile(path.join(modules,'.banner-studio-staging'),'Banner Studio isolated sprite compilation.');
 async function input(file){const data=await fs.readFile(file);snapshots.push({file,hash:sha(data)});return data;}
 async function payload(relative,data,kinds=targets.map(t=>t.kind)){
  const stored='payload/'+files.length+'/'+path.basename(relative),file=insideModule(directory,stored);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,data,{flag:'wx'});
  for(const target of targets.filter(t=>kinds.includes(t.kind)))files.push({kind:target.kind,relative,stored,hash:sha(data),bytes:data.length,expected:await hashFile(insideModule(target.module,relative))});
 }
 snapshots.push({file:nativeFile,hash:sha(nativeBytes)},{file:moduleFile,hash:sha(moduleBytes)},{file:p.registry,hash:sha(registry.original)},{file:source,hash:sha(bytes)});
 const configFile=path.join(config.modulePath,'GUI/SpriteParts/Config.xml'),configXml=(await input(configFile)).toString(),categoryConfig=blocks(configXml,'SpriteCategory').find(b=>new RegExp('\\bName=["\']'+category+'["\']').test(b));
 if(!categoryConfig)throw new Error('The thumbnail category needs a packing entry in GUI/SpriteParts/Config.xml.');
 await fs.writeFile(path.join(stage,'GUI/SpriteParts/Config.xml'),'<Config>\n'+categoryConfig+'\n</Config>');
 const entries=await fs.readdir(p.thumbnails,{withFileTypes:true});if(entries.some(e=>e.isDirectory()||/\.png$/i.test(e.name)&&!/^[0-9]+\.png$/i.test(e.name)))throw new Error('The banner thumbnail category must contain ID-named PNGs directly, without nested folders or other PNG names.');
 const names=entries.filter(e=>/^[0-9]+\.png$/i.test(e.name)).map(e=>e.name).sort();if(!names.length)throw new Error('No ID-named thumbnails found.');
 const required=registry.groups.flatMap(g=>list(g.Icon)).map(i=>String(i.id)+'.png');for(const name of required)if(!names.includes(name))throw new Error('Missing thumbnail '+name+'. Generate it before deployment.');
 for(const name of names){const data=await input(path.join(p.thumbnails,name));await fs.writeFile(path.join(stage,'GUI/SpriteParts',category,name),data);await payload(thumbnailRelative+'/'+name,data);}
 const helper=path.join(root,'tools/sprite-packer/SpritePacker.exe');await fs.access(helper).catch(()=>{throw new Error('Sprite packer is missing. Use the complete application package.');});
 const log=await execute(helper,[path.join(config.gamePath,'bin/Win64_Shipping_wEditor'),modules],{windowsHide:true,timeout:180000,maxBuffer:4*1024*1024});await fs.writeFile(path.join(directory,'sprite-packer.log'),log.stdout+'\n'+log.stderr);
 const spriteRelative='GUI/'+moduleId+'SpriteData.xml',generated=await fs.readFile(path.join(stage,spriteRelative),'utf8'),parsed=parser.parse(generated).SpriteData;
 if(XMLValidator.validate(generated)!==true||!parsed)throw new Error('The generator did not produce valid SpriteData.');
 const parts=list(parsed.SpriteParts?.SpritePart),sprites=list(parsed.Sprites?.GenericSprite),categories=list(parsed.SpriteCategories?.SpriteCategory);if(categories.length!==1||categories[0].Name!==category||parts.length!==names.length||sprites.length!==names.length||new Set(parts.map(i=>i.Name)).size!==names.length)throw new Error('Incomplete generated thumbnail mapping.');
 const index=await packageIndex(config,root),get=(type,name)=>index.get(TYPES[type]+':'+name);
 const textureTemplateFile=materials.map(name=>get('texture',name)).find(Boolean),materialTemplateFile=resourceSettings.material.template?get('material',resourceSettings.material.template):materials.map(name=>get('material',name)).find(Boolean),guiTemplateFile=get('texture',category+'_1');
 if(!textureTemplateFile||!materialTemplateFile||!guiTemplateFile)throw new Error('This module needs existing editable banner texture/material and GUI texture templates for automatic compilation.');
 const textureTemplate=await input(textureTemplateFile),materialTemplate=await input(materialTemplateFile),guiTemplate=await input(guiTemplateFile);
 async function compile(name,sourceData,rgba,width,height,sourcePath,template,kind,sourceWidth=width,sourceHeight=height){
  const existingFile=get('texture',name),existing=existingFile?await input(existingFile):null;
  const format=kind==='BannerIcons'?resourceSettings.atlasFormat:resourceSettings.guiFormat,encoded=await encodeTexture({root,directory,rgba,width,height,format,mipmaps:kind==='BannerIcons'&&resourceSettings.mipmaps,quality:resourceSettings.quality});
  const result=await compileTexture({template,existing,name,moduleId,sourceRelative:sourcePath,sourceBytes:sourceData,rgba,width,height,sourceWidth,sourceHeight,encoded,textureFlags:kind==='BannerIcons'?resourceSettings.textureFlags:null});
  const textureRelative=existingFile?relative(existingFile):'Assets/'+kind+'/'+name+'_tex.tpac';await payload(textureRelative,result.tpac);await payload('RuntimeDataCache/'+result.rdcName,result.rdc);await payload(sourcePath,sourceData);
  return {name,id:result.id,width,height,format:result.format,mipCount:result.mipCount,bytes:result.rdc.length,levels:encoded.levels};
 }
 let rgba,width,height;if(source.endsWith('.psd')){const psd=readPsd(bytes,{useImageData:true,skipLayerImageData:true,skipThumbnail:true});if(!psd.imageData||psd.bitsPerChannel!==8||psd.colorMode!==3)throw new Error('An 8-bit RGB atlas composite is required.');width=psd.width;height=psd.height;rgba=Buffer.from(psd.imageData.data);}else{const decoded=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});width=decoded.info.width;height=decoded.info.height;rgba=decoded.data;}
 if(width!==height||width%8)throw new Error('Banner atlases require a square 4×4 layout.');
 const sourceWidth=width,sourceHeight=height,targetSize=resourceSettings.atlasSize||width;if(targetSize!==width){rgba=await resizeAtlas(rgba,width,targetSize);width=height=targetSize;}
 const atlas=await compile(material,bytes,rgba,width,height,sourceRelative,textureTemplate,'BannerIcons',sourceWidth,sourceHeight),existingMaterialFile=get('material',material),existingMaterial=existingMaterialFile?await input(existingMaterialFile):null;
 const mtl=await compileMaterial({template:materialTemplate,existing:existingMaterial,name:material,textureId:atlas.id,settings:resourceSettings.material});await payload(existingMaterialFile?relative(existingMaterialFile):'Assets/BannerIcons/'+material+'_mtl.tpac',mtl.tpac);
 const sheetSummary=[],verifiedParts=new Set();if(list(categories[0].SpriteSheetSize).length!==Number(categories[0].SpriteSheetCount))throw new Error('Missing generated sheet descriptors.');
 for(const sheet of list(categories[0].SpriteSheetSize)){
  const name=category+'_'+sheet.ID,png=await fs.readFile(path.join(stage,'AssetSources/GauntletUI',name+'.png')),decoded=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  if(decoded.info.width!==Number(sheet.Width)||decoded.info.height!==Number(sheet.Height))throw new Error('Generated sheet dimensions do not match SpriteData.');
  for(const part of parts.filter(p=>p.SheetID===Number(sheet.ID))){const expectedName=String(part.Name)+'.png';if(!names.includes(expectedName)||!sprites.some(s=>String(s.Name)===String(part.Name)&&String(s.SpritePartName)===String(part.Name)))throw new Error('Unexpected thumbnail mapping.');const expected=await sharp(path.join(stage,'GUI/SpriteParts',category,expectedName)).ensureAlpha().raw().toBuffer({resolveWithObject:true});if(part.Width!==expected.info.width||part.Height!==expected.info.height)throw new Error('Thumbnail dimensions changed.');const pixels=await sharp(decoded.data,{raw:decoded.info}).extract({left:part.SheetX,top:part.SheetY,width:part.Width,height:part.Height}).raw().toBuffer();if(!pixels.equals(expected.data))throw new Error('Thumbnail packing changed source pixels.');verifiedParts.add(expectedName);}
  const compiled=await compile(name,png,decoded.data,decoded.info.width,decoded.info.height,'AssetSources/GauntletUI/'+name+'.png',guiTemplate,'GauntletUI');sheetSummary.push(compiled);
 }
 if(verifiedParts.size!==names.length)throw new Error('A thumbnail references a missing sheet.');
 for(const target of targets){const targetXml=insideModule(target.module,spriteRelative),original=await fs.readFile(targetXml,'utf8');snapshots.push({file:targetXml,hash:sha(Buffer.from(original))});await payload(spriteRelative,Buffer.from(mergeSpriteCategory(original,generated,category)),[target.kind]);}
 await payload(registryRelative,registry.original);
 // Adding a PNG while packing must invalidate the review too.
 const thumbnailNames=(await fs.readdir(p.thumbnails)).filter(n=>/^[0-9]+\.png$/i.test(n)).sort();if(JSON.stringify(names)!==JSON.stringify(thumbnailNames))throw new Error('Thumbnail files changed during compilation. Build again.');
 for(const item of snapshots)if(await hashFile(item.file)!==item.hash)throw new Error('A compilation input changed: '+item.file);
 const result={batchId,status:'review',workspace:workspaceIdentity(config),material,moduleId,category,resourceSettings,atlas,thumbnailNames:names,thumbnailDirectory:p.thumbnails,targets,files,snapshots,sheets:sheetSummary,thumbnails:names.length,format:atlas.format+'; '+atlas.mipCount+' mip(s)',bytes:files.reduce((n,f)=>n+f.bytes,0),directory};
 await fs.writeFile(path.join(directory,'deployment.json'),JSON.stringify(result,null,2));return result;
}
export async function installGameDeployment({config,root,batchId,io=fs,isRunning=gameIsRunning}){
 const directory=deploymentDirectory(config,root,batchId),manifest=JSON.parse(await io.readFile(path.join(directory,'deployment.json'),'utf8'));
 if(manifest.status!=='review'||manifest.workspace!==workspaceIdentity(config))throw new Error('This deployment review is stale or belongs to another mod profile.');
 if(await isRunning())throw new Error('Close Bannerlord and the Modding Kit before replacing game resources.');
 await validateInstalledModule(config.modulePath,config.installedModulePath||config.modulePath,io);
 const targets={development:config.modulePath,installed:config.installedModulePath},lock=path.join(configPaths(config,root).data,'.game-deployment.lock'),handle=await io.open(lock,'wx'),prepared=[],written=[];
 try{
  const names=(await io.readdir(manifest.thumbnailDirectory)).filter(n=>/^[0-9]+\.png$/i.test(n)).sort();if(JSON.stringify(names)!==JSON.stringify(manifest.thumbnailNames))throw new Error('Thumbnail files changed. Rebuild the game resources.');
  for(const item of manifest.snapshots)if(await io.readFile(item.file).then(sha).catch(()=>null)!==item.hash)throw new Error('A compilation input changed. Rebuild the game resources: '+item.file);
  for(const record of manifest.files){
   const module=targets[record.kind];if(!module)throw new Error('Deployment destination is not configured.');
   const target=insideModule(module,record.relative),stored=insideModule(directory,record.stored),data=await io.readFile(stored);if(sha(data)!==record.hash)throw new Error('A compiled review file was changed. Rebuild the game resources.');
   const original=await io.readFile(target).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if((original?sha(original):null)!==record.expected)throw new Error('A destination file changed since review: '+target);
   if(record.expected===record.hash)continue;
   const backup=insideModule(path.join(directory,'originals',record.kind),record.relative),temp=target+'.'+randomUUID()+'.tmp';
   if(original){await io.mkdir(path.dirname(backup),{recursive:true});await io.writeFile(backup,original,{flag:'wx'});}
   prepared.push({target,temp,data,original});
  }
  for(const item of prepared){await io.mkdir(path.dirname(item.target),{recursive:true});await io.writeFile(item.temp,item.data,{flag:'wx'});}
  // Resource payloads and source files first; sprite mapping and registry last.
  prepared.sort((a,b)=>Number(/\.xml$/i.test(a.target))-Number(/\.xml$/i.test(b.target)));
  for(const item of prepared){const current=await io.readFile(item.target).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if((current?sha(current):null)!==(item.original?sha(item.original):null))throw new Error('Destination changed while deploying: '+item.target);await io.rename(item.temp,item.target);written.push(item);if(sha(await io.readFile(item.target))!==sha(item.data))throw new Error('Deployed resource verification failed.');}
  manifest.status='installed';manifest.installedAt=new Date().toISOString();manifest.changedFiles=written.length;await io.writeFile(path.join(directory,'deployment.json'),JSON.stringify(manifest,null,2));return manifest;
 }catch(error){
  const failures=[];for(const item of [...written].reverse())try{if(item.original){await io.writeFile(item.temp,item.original);await io.rename(item.temp,item.target);}else await io.unlink(item.target);}catch(restore){failures.push(item.target+': '+restore.message);}
  if(failures.length)throw new Error(error.message+' Rollback needs attention: '+failures.join('; '));throw error;
 }finally{for(const item of prepared)await io.unlink(item.temp).catch(()=>{});await handle.close();await io.unlink(lock);}
}
