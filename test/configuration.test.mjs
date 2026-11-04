import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import sharp from 'sharp';
import {normalizeConfig,configPaths,readConfig,validateConfig,workspaceSignature,workspaceIdentity,assetFingerprint} from '../configuration.mjs';
import {buildAtlases} from '../atlas-builder.mjs';
import {loadLibrary} from '../library.mjs';

const root=path.resolve(import.meta.dirname,'..');
export const sampleCode='11.0.0.1528.1528.764.764.1.0.0.10000.1.0.350.350.764.764.0.0.0';
export async function makeModuleFixture(temp,port=4318){
  const config=normalizeConfig({modulePath:path.join(temp,'OtherMod'),gamePath:path.join(temp,'Game'),moduleName:'Other Mod',port,
    bannerIconsFile:'Data/symbols.xml',nativeBannerIconsFile:'NativeData/icons.xml',bannerDefinitionPaths:['Data/clans.xml'],
    atlasSourceDirectory:'Artwork/Atlases',thumbnailDirectory:'Interface/Symbols',nativeAssetDirectory:'NativePackages',
    assetPackagePaths:[],atlasPrefix:'other_symbols',dataDirectory:path.join(temp,'EditorData')},root);
  const p=configPaths(config,root);
  for(const folder of [path.dirname(p.registry),path.dirname(p.nativeRegistry),p.nativeAssets,p.atlasSources,path.join(p.data,'cache','textures')])await fs.mkdir(folder,{recursive:true});
  await fs.writeFile(p.registry,'<base><BannerIconData><BannerIconGroup id="100" name="Other Mod"><Icon id="10000" material_name="other_symbols_west_alpha_01" texture_index="0" /></BannerIconGroup></BannerIconData></base>');
  await fs.writeFile(p.nativeRegistry,'<base><BannerIconData><BannerIconGroup id="1"><Background id="11" mesh_name="pattern" /></BannerIconGroup><BannerColors><Color id="0" hex="0xff101010"/><Color id="1" hex="0xffddbb55"/></BannerColors></BannerIconData></base>');
  await fs.writeFile(p.definitions[0],'<Factions><Faction id="west" name="Western Clan" banner_key="'+sampleCode+'" /></Factions>');
  await fs.writeFile(path.join(p.data,'cache','assets.json'),JSON.stringify({modulePath:config.modulePath,gamePath:config.gamePath,materials:{},textures:{},meshes:{},errors:[]}));
  await fs.writeFile(path.join(p.data,'cache','workspace.json'),JSON.stringify({signature:workspaceSignature(config),assetFingerprint:await assetFingerprint(config,root)}));
  return {config,p};
}
async function temporary(run){
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'banner-config-test-'));
  try{await run(temp);}finally{
    const resolved=path.resolve(temp);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('banner-config-test-'));
    await fs.rm(resolved,{recursive:true,force:true});
  }
}
test('fresh settings have no personal paths; custom XML stays inside the selected module',async()=>temporary(async temp=>{
  const loaded=await readConfig(temp);assert.equal(loaded.error,null);assert.equal(loaded.config.modulePath,'');assert.equal(loaded.config.gamePath,'');assert.equal(loaded.config.syncInstalledBanners,false);
  await assert.rejects(validateConfig(loaded.config,temp),/Choose the module/);
  const config=normalizeConfig({modulePath:path.join(temp,'My Mod'),gamePath:temp});
  assert.equal(config.atlasPrefix,'my_mod_banners');assert.equal(config.thumbnailDirectory,'GUI/SpriteParts/ui_my_mod_bannericons');
  const mirrored={...config,syncInstalledBanners:true,installedModulePath:path.join(temp,'installed')};
  assert.equal(workspaceSignature(config),workspaceSignature(mirrored));assert.notEqual(workspaceIdentity(config),workspaceIdentity(mirrored));
  assert.throws(()=>configPaths({...config,bannerIconsFile:'../outside.xml'},temp),/stay inside/);
  assert.throws(()=>configPaths({...config,bannerDefinitionPaths:['../outside']},temp),/stay inside/);
  await fs.writeFile(path.join(temp,'config.json'),'{broken');assert.match((await readConfig(temp)).error,/Could not read settings/);
}));

test('another mod loads custom definition/registry files and installs an atlas into its chosen folders',async()=>temporary(async temp=>{
  const {config,p}=await makeModuleFixture(temp);await validateConfig(config,root);
  const before=await loadLibrary(config.modulePath,config.gamePath,config);
  assert.equal(before.banners.length,1);assert.equal(before.banners[0].source,'Data/clans.xml');assert.equal(before.icons[0].source,'Module');
  const png=await sharp({create:{width:23,height:47,channels:4,background:'#fff'}}).png().toBuffer();
  const result=await buildAtlases({files:[{name:'symbol.png',data:png}],faction:'east',category:'alpha',modulePath:config.modulePath,gamePath:config.gamePath,
    sourceDirectory:p.atlasSources,outputDirectory:path.join(p.data,'atlas-builds'),registryFile:p.registry,nativeRegistryFile:p.nativeRegistry,thumbnailDirectory:p.thumbnails,atlasPrefix:config.atlasPrefix,groupLabel:config.moduleName,install:true});
  assert.equal(result.registration.xmlPath,p.registry);assert.equal(result.registration.thumbnailDirectory,p.thumbnails);
  assert.equal(result.registration.xmlBackup,path.join(result.directory,'backups','Data','symbols.xml'));
  const atlas=result.atlases[0],cell=atlas.cells[0];assert.equal(atlas.name,'other_symbols_east_alpha_01');assert.equal(atlas.installedPath,path.join(p.atlasSources,atlas.psd));
  const thumbnail=await sharp(path.join(p.thumbnails,cell.iconId+'.png')).raw().toBuffer({resolveWithObject:true});assert.equal(thumbnail.info.channels,4);assert.equal(thumbnail.data[3],0);
  const after=await loadLibrary(config.modulePath,config.gamePath,config);assert.ok(after.icons.some(i=>i.id===cell.iconId));
  assert.equal(await fs.readFile(p.definitions[0],'utf8'),'<Factions><Faction id="west" name="Western Clan" banner_key="'+sampleCode+'" /></Factions>');
  await assert.rejects(fs.stat(path.join(config.modulePath,'ModuleData')),{code:'ENOENT'});
}));

test('server starts without config, saves validated settings, and refuses stale-module writes',async()=>temporary(async temp=>{
  const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  const configFile=path.join(temp,'settings.json'),{config,p}=await makeModuleFixture(temp,port);
  const child=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,env:{...process.env,BANNER_STUDIO_CONFIG:configFile,BANNER_STUDIO_PORT:String(port)},stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
  try{
    const base='http://127.0.0.1:'+port;let library;
    for(let i=0;i<100;i++){try{library=await fetch(base+'/api/library').then(r=>r.json());break;}catch{await new Promise(resolve=>setTimeout(resolve,50));}}
    assert.ok(library,log);assert.equal(library.setupRequired,true);assert.equal(library.config.modulePath,'');
    const post=(route,data)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Editor-Token':library.token},body:JSON.stringify(data)});
    let response=await post('/api/config',{modulePath:temp,gamePath:temp});assert.notEqual(response.status,200);await assert.rejects(fs.stat(configFile),{code:'ENOENT'});
    response=await post('/api/config',config);assert.equal(response.status,200,await response.text());
    library=await fetch(base+'/api/library').then(r=>r.json());assert.equal(library.setupRequired,false);assert.equal(library.config.moduleName,'Other Mod');assert.equal(library.banners[0].source,'Data/clans.xml');
    const original=await fs.readFile(p.definitions[0],'utf8'),entry=library.banners[0];
    response=await post('/api/save-source',{key:entry.key,expectedCode:entry.code,code:entry.code,workspaceId:'old-workspace'});assert.equal(response.status,400);assert.match((await response.json()).error,/settings changed/);assert.equal(await fs.readFile(p.definitions[0],'utf8'),original);
    const code=entry.code.replace('350.350','360.350');response=await post('/api/save-source',{key:entry.key,expectedCode:entry.code,code,workspaceId:library.workspaceId});assert.equal(response.status,200,await response.text());
    assert.equal(await fs.readFile(p.definitions[0],'utf8'),original.replace(entry.code,code));
    assert.equal(JSON.parse(await fs.readFile(configFile,'utf8')).bannerIconsFile,'Data/symbols.xml');
  }finally{child.kill();await once(child,'close');}
}));
