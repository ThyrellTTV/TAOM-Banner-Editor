import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { loadLibrary } from './library.mjs';
import { saveBannerSource,validateInstalledModule } from './source-store.mjs';
import { prepareSourceTextures } from './prepare-assets.mjs';
import { decode } from './public/banner-code.mjs';
import sharp from 'sharp';
import { buildAtlases } from './atlas-builder.mjs';
import { readIconRegistry,iconGroupOptions } from './atlas-registration.mjs';
import {readConfig,configPaths,workspaceSignature,workspaceIdentity,assetFingerprint,validateConfig,DEFAULT_PORT} from './configuration.mjs';
import {readProfiles,profileSummary,planProfileSettings,planProfileSwitch,persistProfiles,persistProfileCatalog} from './profiles.mjs';
import {atlasCatalog,atlasDetails,stageAtlasEdit,installAtlasEdit,managedDirectory,maskThumbnail} from './atlas-manager.mjs';
import {validateAssets} from './asset-validation.mjs';
import {buildGameDeployment,installGameDeployment,deploymentDirectory,resourceSettingOptions} from './game-deployment.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
// New atlases join an existing icon group {id} or create one {name, id?}.
const atlasGroup=group=>{
  if(group==null)throw new Error('Choose an icon group for the new atlas, or name a new one.');
  if(typeof group.name==='string'&&group.name.trim())return {name:group.name,id:group.id==null||group.id===''?undefined:Number(group.id)};
  const id=Number(group.id);if(!Number.isSafeInteger(id))throw new Error('Choose an icon group for the new atlas, or name a new one.');return {id};
};
const configFile=path.resolve(process.env.BANNER_STUDIO_CONFIG||path.join(root,'config.json'));
let {config,error:setupError}=await readConfig(root,configFile);
const port=Number(process.env.BANNER_STUDIO_PORT||process.env.TAOM_EDITOR_PORT||config.port||DEFAULT_PORT);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid editor port.');
config.port=port;
let profilesError=null;
let profileStore=await readProfiles(configFile,config,root).catch(error=>{profilesError=error.message;return {version:1,activeId:null,profiles:[]};});
let library,assets,refreshPromise;
const maskCache=new Map();
const managerThumbnailCache=new Map();
let writeQueue=Promise.resolve();
const enqueue=task=>{const job=writeQueue.then(task);writeQueue=job.catch(()=>{});return job;};
const token=randomUUID();
const dataRoot=(settings=config)=>path.resolve(root,settings.dataDirectory);
function assertWorkspace(data){
  if(data.workspaceId&&data.workspaceId!==workspaceIdentity(config))throw new Error('The module settings changed. Reload the editor before saving.');
}
async function folders(settings){for(const name of ['cache/textures','drafts','backups','logs','exports','atlas-builds','.jobs'])await fs.mkdir(path.join(dataRoot(settings),name),{recursive:true});}
async function extractAssets(settings){
  const runtimeFile=path.join(dataRoot(settings),'.jobs','extract-'+randomUUID()+'.json');
  await fs.writeFile(runtimeFile,JSON.stringify({...settings,dataDirectory:dataRoot(settings),cacheNamespace:workspaceSignature(settings).slice(0,12)}));
  try{
    const executable=path.join(root,'tools','extractor','Extractor.exe');
    const published=!!await fs.stat(executable).catch(()=>null);
    await new Promise((resolve,reject)=>{
      const child=spawn(published?executable:'dotnet',published?[runtimeFile]:['run','--project',path.join(root,'extractor','Extractor.csproj'),'--configuration','Release','--',runtimeFile],{cwd:root,windowsHide:true});
      let log='';child.stdout.on('data',b=>{log+=b;});child.stderr.on('data',b=>{log+=b;});
      child.on('error',reject);child.on('close',async code=>{try{await fs.writeFile(path.join(dataRoot(settings),'logs','extraction.log'),log);code?reject(new Error('Asset extraction failed. Check the folders and logs/extraction.log.')):resolve();}catch(error){reject(error);}});
    });
  }finally{await fs.unlink(runtimeFile).catch(()=>{});}
}
async function refresh(extract=false,settings=config,save=false,nextProfiles=profileStore){
  if(refreshPromise){try{await refreshPromise;}catch(error){if(!save)throw error;}if(!save)return;}
  refreshPromise=(async()=>{
    await validateConfig(settings,root);await folders(settings);
    if(settings.syncInstalledBanners)await validateInstalledModule(settings.modulePath,settings.installedModulePath);
    const cacheFile=path.join(dataRoot(settings),'cache','assets.json'),signature=workspaceSignature(settings),fingerprint=await assetFingerprint(settings,root);
    let fresh=await fs.readFile(cacheFile,'utf8').then(JSON.parse).catch(()=>null);
    const stamp=await fs.readFile(path.join(dataRoot(settings),'cache','workspace.json'),'utf8').then(JSON.parse).catch(()=>null);
    if(extract||!fresh||stamp?.signature!==signature||stamp?.assetFingerprint!==fingerprint){await extractAssets(settings);fresh=JSON.parse(await fs.readFile(cacheFile,'utf8'));await fs.writeFile(path.join(dataRoot(settings),'cache','workspace.json'),JSON.stringify({signature,assetFingerprint:fingerprint}));}
    if(path.resolve(fresh.modulePath)!==path.resolve(settings.modulePath)||path.resolve(fresh.gamePath)!==path.resolve(settings.gamePath))throw new Error('Extracted assets belong to another module.');
    const nextLibrary=await loadLibrary(settings.modulePath,settings.gamePath,settings);
    const nextAssets=await prepareSourceTextures(dataRoot(settings),fresh,settings.modulePath,nextLibrary.icons,settings);
    if(save){if(profilesError)throw new Error(profilesError);await persistProfiles(configFile,nextProfiles,settings);profileStore=nextProfiles;}
    config=settings;library=nextLibrary;assets=nextAssets;maskCache.clear();managerThumbnailCache.clear();setupError=null;
  })().finally(()=>{refreshPromise=null;});
  return refreshPromise;
}
const send = (res,status,obj) => { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(obj)); };
async function body(req,limit=2_000_000) {
  let data='';
  for await (const part of req) { data+=part; if(data.length>limit) throw new Error('Request too large.'); }
  return JSON.parse(data || '{}');
}
const server = http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://127.0.0.1:'+port);
    const host = req.headers.host;
    if(!['127.0.0.1:'+port,'localhost:'+port].includes(host)) return send(res,403,{error:'Invalid host.'});
    if(req.method==='POST') {
      if(req.headers['x-editor-token']!==token || !req.headers['content-type']?.startsWith('application/json')) return send(res,403,{error:'Open the editor to make changes.'});
      const data=await body(req,['/api/atlas-build','/api/atlas-manager/stage'].includes(url.pathname)?180_000_000:2_000_000);
      if(url.pathname==='/api/game-deployment/build')return send(res,200,await enqueue(()=>{assertWorkspace(data);if(!library)throw new Error('Load a module before compiling resources.');return buildGameDeployment({config,root,material:data.material,expected:data.expected});}));
      if(url.pathname==='/api/game-deployment/install')return send(res,200,await enqueue(async()=>{assertWorkspace(data);const result=await installGameDeployment({config,root,batchId:data.batchId});try{await refresh();}catch(error){result.refreshWarning='Resources deployed, but the editor refresh failed: '+error.message;}return result;}));
      if(url.pathname==='/api/validation')return send(res,200,await enqueue(async()=>{assertWorkspace(data);if(!library)throw new Error('Load a module before validating assets.');await refresh();return validateAssets({config,root,library,assets});}));
      if(url.pathname==='/api/atlas-manager/stage')return send(res,200,await enqueue(()=>{assertWorkspace(data);if(!library)throw new Error('Load a module before editing an atlas.');return stageAtlasEdit({config,root,library,material:data.material,expected:data.expected,actions:data.actions});}));
      if(url.pathname==='/api/atlas-manager/install'){
        const result=await enqueue(async()=>{assertWorkspace(data);const result=await installAtlasEdit({config,root,batchId:data.batchId});try{await refresh();}catch(error){result.refreshWarning='Installed, but editor refresh failed: '+error.message;}return result;});return send(res,200,result);
      }
      if(url.pathname==='/api/profiles/switch'){
        await enqueue(async()=>{assertWorkspace(data);if(profilesError)throw new Error(profilesError);const next=planProfileSwitch(profileStore,data.id,port);await refresh(false,next.config,true,next.store);});return send(res,200,{ok:true});
      }
      if(url.pathname==='/api/profiles/delete'){
        await enqueue(async()=>{assertWorkspace(data);if(profilesError)throw new Error(profilesError);if(data.id===profileStore.activeId)throw new Error('Switch to another profile before removing the active profile.');const next=structuredClone(profileStore);if(!next.profiles.some(p=>p.id===data.id))throw new Error('Mod profile was not found.');next.profiles=next.profiles.filter(p=>p.id!==data.id);await persistProfileCatalog(configFile,next);profileStore=next;});return send(res,200,{ok:true});
      }
      if(url.pathname==='/api/atlas-build'){
        if(!Array.isArray(data.files)||data.files.length<1||data.files.length>128)throw new Error('Choose between 1 and 128 PNGs.');
        const files=data.files.map(f=>{
          if(typeof f.name!=='string'||typeof f.dataUrl!=='string'||!f.dataUrl.startsWith('data:image/png;base64,'))throw new Error('Upload PNG files only.');
          return {name:path.basename(f.name.replaceAll('\\','/')),data:Buffer.from(f.dataUrl.slice('data:image/png;base64,'.length),'base64')};
        });
        if(files.reduce((n,f)=>n+f.data.length,0)>128*1024*1024)throw new Error('A batch may contain at most 128 MB of PNGs.');
        if(!library)throw new Error('Complete module setup before importing an atlas.');
        const result=await enqueue(async()=>{
          assertWorkspace(data);
          const modulePath=config.modulePath,p=configPaths(config,root);
          const result=await buildAtlases({files,faction:data.faction,category:data.category,modulePath,gamePath:config.gamePath,outputDirectory:path.join(dataRoot(),'atlas-builds'),sourceDirectory:p.atlasSources,registryFile:p.registry,nativeRegistryFile:p.nativeRegistry,thumbnailDirectory:p.thumbnails,atlasPrefix:config.atlasPrefix,groupLabel:config.moduleName,atlasSize:config.resourceSettings.newAtlasSize,install:data.install!==false,padding:Number(data.padding??0),outline:Number(data.outline??0),mode:data.mode||'alpha',startIndex:data.startIndex==null?undefined:Number(data.startIndex),group:atlasGroup(data.group)});
          if(result.registration.installed){try{await refresh();}catch(error){result.refreshWarning='Import saved, but editor refresh failed: '+error.message;}}
          return result;
        });
        return send(res,200,{...result,atlases:result.atlases.map(a=>({...a,previewUrl:'/api/atlas-file/'+result.batchId+'/'+a.preview,psdUrl:'/api/atlas-file/'+result.batchId+'/'+a.psd,maskUrl:'/api/atlas-file/'+result.batchId+'/'+a.mask}))});
      }
      if(url.pathname==='/api/save-source') {
        const task=enqueue(()=>{assertWorkspace(data);if(!library)throw new Error('Complete module setup before saving.');return saveBannerSource({root:dataRoot(),modulePath:config.modulePath,installedModulePath:config.installedModulePath,syncInstalledBanners:config.syncInstalledBanners,library,data});});
        return send(res,200,await task);
      }
      if(url.pathname==='/api/drafts') {
        assertWorkspace(data);
        decode(data.code);
        const id=typeof data.id==='string' && /^[a-z0-9-]+$/.test(data.id) ? data.id : randomUUID();
        const draft={id,name:String(data.name||'Untitled banner').slice(0,150),code:data.code,sourceKey:data.sourceKey||null,savedAt:new Date().toISOString()};
        await fs.writeFile(path.join(dataRoot(),'drafts',id+'.json'),JSON.stringify(draft,null,2));
        return send(res,200,draft);
      }
      if(url.pathname==='/api/drafts/delete') {
        assertWorkspace(data);
        if(typeof data.id!=='string'||!/^[a-z0-9-]+$/.test(data.id))throw new Error('Invalid draft id.');
        // Move rather than unlink, so a mistaken delete can be recovered from backups/deleted-drafts.
        const trash=path.join(dataRoot(),'backups','deleted-drafts');await fs.mkdir(trash,{recursive:true});
        await fs.rename(path.join(dataRoot(),'drafts',data.id+'.json'),path.join(trash,data.id+'-'+Date.now()+'.json')).catch(e=>{if(e.code==='ENOENT')throw new Error('Draft was not found.');throw e;});
        return send(res,200,{ok:true});
      }
      if(url.pathname==='/api/export') {
        assertWorkspace(data);
        if(typeof data.png!=='string'||!data.png.startsWith('data:image/png;base64,'))throw new Error('Expected a PNG image.');
        const bytes=Buffer.from(data.png.slice('data:image/png;base64,'.length),'base64');
        const meta=await sharp(bytes,{limitInputPixels:16_777_216}).metadata();
        if(meta.format!=='png')throw new Error('Expected a PNG image.');
        const stem=String(data.name||'banner').replace(/[^a-z0-9 _-]/gi,'').slice(0,70)||'banner';
        const file=stem+'-'+randomUUID().slice(0,8)+'.png';
        const destination=path.join(dataRoot(),'exports',file);
        await sharp(bytes,{limitInputPixels:16_777_216}).png().toFile(destination);
        return send(res,200,{path:destination,url:'/api/export-file/'+encodeURIComponent(file),name:file});
      }
      if(url.pathname==='/api/refresh') { await enqueue(()=>{assertWorkspace(data);return refresh(Boolean(data.extract));}); return send(res,200,{ok:true}); }
      if(url.pathname==='/api/config') {
        await enqueue(async()=>{
          assertWorkspace(data);
          if(profilesError)throw new Error(profilesError);
          const next=planProfileSettings(profileStore,{...data,port},config,root);
          await refresh(false,next.config,true,next.store);
        });
        return send(res,200,{ok:true});
      }
      return send(res,404,{error:'Unknown action.'});
    }
    if(req.method!=='GET') return send(res,405,{error:'Method not supported.'});
    if(url.pathname==='/api/health')return send(res,200,{app:'taom-banner-editor',ready:true,configured:!!library,loading:!!refreshPromise});
    if(url.pathname==='/api/profiles')return send(res,200,{...profileSummary(profileStore),error:profilesError});
    if(url.pathname==='/api/resource-options')return send(res,200,library?await resourceSettingOptions({config,root}):{materials:[]});
    if(url.pathname==='/api/game-deployment/report'){
      const data=await fs.readFile(path.join(deploymentDirectory(config,root,url.searchParams.get('batchId')),'deployment.json'));
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="deployment.json"','Cache-Control':'no-store'});return res.end(data);
    }
    if(url.pathname==='/api/atlas-manager'){if(!library)throw new Error('Load a module first.');return send(res,200,await atlasCatalog({config,root,library}));}
    if(url.pathname==='/api/atlas-manager/details'){if(!library)throw new Error('Load a module first.');return send(res,200,await atlasDetails({config,root,library,material:url.searchParams.get('material')}));}
    if(url.pathname==='/api/atlas-manager/thumbnail'){
      const material=url.searchParams.get('material'),index=Number(url.searchParams.get('slot'));
      if(!library?.icons.some(i=>i.source!=='Native'&&i.material===material&&i.index===index))throw new Error('Choose a registered module slot.');
      const texture=assets.textures[assets.materials[material]?.slots?.['0']],image=texture?.images?.[0];if(!image||!/^\/cache\/textures\/[^/\\]+\.png$/i.test(image))throw new Error('Atlas artwork is unavailable.');
      const key=material+':'+index,source=path.join(dataRoot(),image.slice(1));
      if(!managerThumbnailCache.has(key)){
        if(managerThumbnailCache.size>=256)managerThumbnailCache.delete(managerThumbnailCache.keys().next().value);
        managerThumbnailCache.set(key,(async()=>{const meta=await sharp(source).metadata(),size=meta.width/4;if(meta.width!==meta.height||!Number.isInteger(size))throw new Error('Atlas is not a square 4×4 texture.');const pixels=await sharp(source).extract({left:index%4*size,top:Math.floor(index/4)*size,width:size,height:size}).resize(256,256).ensureAlpha().raw().toBuffer();return maskThumbnail(pixels,256);})().catch(error=>{managerThumbnailCache.delete(key);throw error;}));
      }
      const png=await managerThumbnailCache.get(key);res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-cache'});return res.end(png);
    }
    if(url.pathname.startsWith('/api/managed-atlas-file/')){
      const parts=url.pathname.slice('/api/managed-atlas-file/'.length).split('/').map(decodeURIComponent);
      if(parts.length!==2||parts[1]!=='banner_icons.xml'&&!/^[-a-z0-9_]+\.(?:psd|preview\.png)$/i.test(parts[1]))throw new Error('Invalid atlas review filename.');
      const bytes=await fs.readFile(path.join(managedDirectory(config,root,parts[0]),parts[1]));res.writeHead(200,{'Content-Type':parts[1].endsWith('.psd')?'image/vnd.adobe.photoshop':parts[1].endsWith('.xml')?'application/xml; charset=utf-8':'image/png','Cache-Control':'no-cache'});return res.end(bytes);
    }
    if(url.pathname==='/api/library')return send(res,200,{...(library||{banners:[],icons:[],backgrounds:[],colors:[],groups:[]}),assets:assets||{materials:{},textures:{},meshes:{},errors:[]},config,token,setupRequired:!library&&!refreshPromise,loading:!library&&!!refreshPromise,setupError,workspaceId:workspaceIdentity(config)});
    if(url.pathname==='/api/atlas-info'){
      const folder=configPaths(config,root).atlasSources;
      const names=await fs.readdir(folder).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
      const factions=[...new Set(names.filter(n=>n.startsWith(config.atlasPrefix+'_')).map(n=>n.slice(config.atlasPrefix.length+1).match(/^(.+)_(?:alpha|ornaments)_\d+\.psd$/i)?.[1]).filter(Boolean))].sort();
      const groups=iconGroupOptions(await readIconRegistry(config.modulePath,configPaths(config,root).registry)).map(({id,name,icons})=>({id,name,icons}));
      return send(res,200,{factions,groups,folder,atlasSize:config.resourceSettings.newAtlasSize,cellSize:config.resourceSettings.newAtlasSize/4});
    }
    if(url.pathname.startsWith('/api/atlas-file/')){
      const parts=url.pathname.slice('/api/atlas-file/'.length).split('/').map(decodeURIComponent);
      if(parts.length!==2||!/^[0-9a-fTZ-]+$/i.test(parts[0])||!/^[a-z][a-z0-9_]+\.(?:psd|mask\.png|preview\.png)$/.test(parts[1]))throw new Error('Invalid atlas file.');
      const file=path.join(dataRoot(),'atlas-builds',parts[0],parts[1]);const bytes=await fs.readFile(file);
      const isPsd=parts[1].endsWith('.psd');
      res.writeHead(200,{'Content-Type':isPsd?'image/vnd.adobe.photoshop':'image/png','Cache-Control':'no-cache',...(isPsd?{'Content-Disposition':'attachment; filename="'+parts[1]+'"'}:{})});return res.end(bytes);
    }
    if(url.pathname.startsWith('/api/export-file/')) {
      const file=decodeURIComponent(url.pathname.slice('/api/export-file/'.length));
      if(!/^[a-z0-9 _-]+\.png$/i.test(file))throw new Error('Invalid export name.');
      const bytes=await fs.readFile(path.join(dataRoot(),'exports',file));
      res.writeHead(200,{'Content-Type':'image/png','Content-Disposition':'attachment; filename="'+file+'"','Cache-Control':'no-store'});return res.end(bytes);
    }
    if(url.pathname.startsWith('/api/mask/')) {
      const id=Number(url.pathname.split('/').at(-1).replace('.png',''));
      const icon=library.icons.find(i=>i.id===id);
      const material=assets.materials[icon?.material];
      const texture=assets.textures[material?.slots?.['0']];
      if(!icon || !texture?.images?.length) return send(res,404,{error:'Symbol artwork is unavailable: '+id});
      const source=path.join(dataRoot(),texture.images[0].slice(1));
      if(!maskCache.has(id))maskCache.set(id,(async()=>{
        const image=sharp(source);const meta=await image.metadata();
        const w=meta.width/4,h=meta.height/4;
        return image.extract({left:(icon.index%4)*w,top:Math.floor(icon.index/4)*h,width:w,height:h}).resize(384,384).png().toBuffer();
      })().catch(error=>{maskCache.delete(id);throw error;}));
      const png=await maskCache.get(id);
      res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-cache'}); return res.end(png);
    }
    if(url.pathname==='/api/drafts') {
      const drafts=await Promise.all((await fs.readdir(path.join(dataRoot(),'drafts')).catch(e=>{if(e.code==='ENOENT')return [];throw e;})).filter(f=>f.endsWith('.json')).map(async f=>JSON.parse(await fs.readFile(path.join(dataRoot(),'drafts',f),'utf8'))));
      return send(res,200,drafts.sort((a,b)=>b.savedAt.localeCompare(a.savedAt)));
    }
    const isCache=url.pathname.startsWith('/cache/textures/');
    const base=path.join(isCache?dataRoot():root,isCache?'cache/textures':'public');
    const name=isCache?url.pathname.slice('/cache/textures/'.length):url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
    const file=path.resolve(base,name);
    if(!file.startsWith(base+path.sep)) return send(res,403,{error:'Invalid path.'});
    const content=await fs.readFile(file);
    const mime={'.html':'text/html','.css':'text/css','.mjs':'text/javascript','.png':'image/png','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream';
    res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'}); res.end(content);
  } catch(error) { send(res,error.code==='ENOENT'?404:400,{error:error.message}); }
});
server.listen(port,'127.0.0.1',()=>{console.log(`Banner Studio: http://127.0.0.1:${port}`);if(config.modulePath&&config.gamePath&&!setupError)enqueue(async()=>{await refresh();if(!profilesError)await persistProfileCatalog(configFile,profileStore);}).catch(error=>{setupError=error.message;console.error(error.message);});});
