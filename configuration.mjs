import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {XMLValidator} from 'fast-xml-parser';

export const DEFAULT_PORT=4318;
const text=value=>typeof value==='string'?value.trim():'';
const slug=value=>value.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')||'mod';
const lines=value=>Array.isArray(value)?value.map(text).filter(Boolean):text(value).split(/\r?\n/).map(text).filter(Boolean);
export function normalizeConfig(input={},root=process.cwd()){
  const modulePath=text(input.modulePath)?path.resolve(root,text(input.modulePath)):'';
  const gamePath=text(input.gamePath)?path.resolve(root,text(input.gamePath)):'';
  const moduleName=text(input.moduleName)||path.basename(modulePath)||'Module';
  const moduleSlug=slug(path.basename(modulePath)||'mod');
  const port=Number(input.port??DEFAULT_PORT);
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Port must be a whole number from 1024 to 65535.');
  const prefix=text(input.atlasPrefix)||moduleSlug+'_banners';
  if(!/^[a-z][a-z0-9_]{0,79}$/.test(prefix))throw new Error('Atlas prefix must start with a lowercase letter and contain only lowercase letters, digits and underscores.');
  if(input.syncInstalledBanners!==undefined&&typeof input.syncInstalledBanners!=='boolean')throw new Error('Invalid installed-module sync setting.');
  return {version:2,modulePath,gamePath,moduleName,port,
    installedModulePath:text(input.installedModulePath)?path.resolve(root,text(input.installedModulePath)):'',
    syncInstalledBanners:input.syncInstalledBanners??false,
    bannerIconsFile:text(input.bannerIconsFile)||'ModuleData/banner_icons.xml',
    nativeBannerIconsFile:text(input.nativeBannerIconsFile)||'Modules/Native/ModuleData/banner_icons.xml',
    bannerDefinitionPaths:lines(input.bannerDefinitionPaths).length?lines(input.bannerDefinitionPaths):['ModuleData'],
    atlasSourceDirectory:text(input.atlasSourceDirectory)||'AssetSources/BannerIcons',
    thumbnailDirectory:text(input.thumbnailDirectory)||`GUI/SpriteParts/ui_${moduleSlug}_bannericons`,
    nativeAssetDirectory:text(input.nativeAssetDirectory)||'Modules/Native/AssetPackages',
    assetPackagePaths:input.assetPackagePaths===undefined?['Assets','AssetPackages']:lines(input.assetPackagePaths),
    atlasPrefix:prefix,dataDirectory:text(input.dataDirectory)||'.'};
}
export function insideModule(modulePath,relative){
  if(!modulePath)throw new Error('Choose a module folder.');
  const base=path.resolve(modulePath),resolved=path.resolve(base,relative);
  const compare=value=>process.platform==='win32'?value.toLowerCase():value;
  if(compare(resolved)!==compare(base)&&!compare(resolved).startsWith(compare(base)+path.sep))throw new Error('Module XML paths must stay inside the selected module: '+relative);
  return resolved;
}
export function configPaths(config,root){
  return {
    registry:insideModule(config.modulePath,config.bannerIconsFile),
    nativeRegistry:path.resolve(config.gamePath,config.nativeBannerIconsFile),
    definitions:config.bannerDefinitionPaths.map(file=>insideModule(config.modulePath,file)),
    atlasSources:path.resolve(config.modulePath,config.atlasSourceDirectory),
    thumbnails:path.resolve(config.modulePath,config.thumbnailDirectory),
    data:path.resolve(root,config.dataDirectory),
    nativeAssets:path.resolve(config.gamePath,config.nativeAssetDirectory),
    moduleAssets:config.assetPackagePaths.map(folder=>path.resolve(config.modulePath,folder))};
}
export function workspaceSignature(config){
  const {installedModulePath,syncInstalledBanners,port,...workspace}=config;
  return createHash('sha256').update(JSON.stringify(workspace)).digest('hex');
}
export function workspaceIdentity(config){
  const {port,...settings}=config;
  return createHash('sha256').update(JSON.stringify(settings)).digest('hex');
}
export async function readConfig(root,file=path.join(root,'config.json')){
  let raw={};let error=null;
  try{raw=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')error='Could not read settings: '+e.message;}
  try{return {config:normalizeConfig(raw,root),error};}catch(e){return {config:normalizeConfig({},root),error:e.message};}
}
export async function validateConfig(config,root){
  if(!config.modulePath||!config.gamePath)throw new Error('Choose the module folder and Bannerlord game folder.');
  if(config.syncInstalledBanners&&!config.installedModulePath)throw new Error('Choose an installed module folder or turn off installed-module saving.');
  const p=configPaths(config,root);
  for(const [label,file] of [['Module banner registry',p.registry],['Native banner registry',p.nativeRegistry]]){
    const xml=await fs.readFile(file,'utf8').catch(()=>{throw new Error(label+' was not found: '+file);});
    if(XMLValidator.validate(xml)!==true||!/<BannerIconData\b/.test(xml))throw new Error(label+' is not a valid banner registry: '+file);
  }
  for(const file of p.definitions){const stat=await fs.stat(file).catch(()=>null);if(!stat||!stat.isDirectory()&&!/\.(xml|xslt)$/i.test(file))throw new Error('Banner definition file/folder was not found: '+file);}
  await fs.access(p.nativeAssets).catch(()=>{throw new Error('Native asset package folder was not found: '+p.nativeAssets);});
  return p;
}
export async function writeConfig(file,config){
  const temp=file+'.'+randomUUID()+'.tmp';
  try{await fs.writeFile(temp,JSON.stringify(config,null,2),{flag:'wx'});await fs.rename(temp,file);}finally{await fs.unlink(temp).catch(()=>{});}
}
