import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { loadLibrary } from './library.mjs';
import { saveBannerSource } from './source-store.mjs';
import { prepareSourceTextures } from './prepare-assets.mjs';
import { decode } from './public/banner-code.mjs';
import sharp from 'sharp';
import { buildAtlases } from './atlas-builder.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
const configFile = path.join(root,'config.json');
let config = JSON.parse(await fs.readFile(configFile,'utf8'));
if(process.env.TAOM_EDITOR_PORT){const port=Number(process.env.TAOM_EDITOR_PORT);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid TAOM_EDITOR_PORT.');config.port=port;}
let library, assets, refreshPromise;
const maskCache=new Map();
let writeQueue = Promise.resolve();
let atlasQueue=Promise.resolve();
const token = randomUUID();
for (const folder of ['cache','drafts','backups','logs','exports','atlas-builds']) await fs.mkdir(path.join(root,folder),{recursive:true});
async function refresh(extract = false) {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    if (extract || !await fs.stat(path.join(root,'cache/assets.json')).catch(()=>null)) {
      await new Promise((resolve,reject) => {
        const child = spawn('dotnet',['run','--project',path.join(root,'extractor/Extractor.csproj'),'--configuration','Release','--',configFile],{cwd:root,windowsHide:true});
        let log='';
        child.stdout.on('data', b => { log += b; }); child.stderr.on('data', b => { log += b; });
        child.on('error',reject); child.on('close', async code => {
          await fs.writeFile(path.join(root,'logs/extraction.log'),log);
          if (code) reject(new Error('Asset extraction failed. See logs/extraction.log.')); else resolve();
        });
      });
    }
    const fresh = JSON.parse(await fs.readFile(path.join(root,'cache/assets.json'),'utf8'));
    if (path.resolve(fresh.modulePath) !== path.resolve(config.modulePath) || path.resolve(fresh.gamePath) !== path.resolve(config.gamePath)) throw new Error('Asset cache belongs to another module. Rebuild assets.');
    const nextLibrary = await loadLibrary(config.modulePath,config.gamePath);
    const nextAssets = await prepareSourceTextures(root,fresh,config.modulePath,nextLibrary.icons);
    library=nextLibrary; assets=nextAssets; maskCache.clear();
  })().finally(()=>{refreshPromise=null;});
  return refreshPromise;
}
await refresh();
const send = (res,status,obj) => { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(obj)); };
async function body(req,limit=2_000_000) {
  let data='';
  for await (const part of req) { data+=part; if(data.length>limit) throw new Error('Request too large.'); }
  return JSON.parse(data || '{}');
}
const server = http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://127.0.0.1:'+config.port);
    const host = req.headers.host;
    if(!['127.0.0.1:'+config.port,'localhost:'+config.port].includes(host)) return send(res,403,{error:'Invalid host.'});
    if(req.method==='POST') {
      if(req.headers['x-editor-token']!==token || !req.headers['content-type']?.startsWith('application/json')) return send(res,403,{error:'Open the editor to make changes.'});
      const data=await body(req,url.pathname==='/api/atlas-build'?180_000_000:2_000_000);
      if(url.pathname==='/api/atlas-build'){
        if(!Array.isArray(data.files)||data.files.length<1||data.files.length>128)throw new Error('Choose between 1 and 128 PNGs.');
        const files=data.files.map(f=>{
          if(typeof f.name!=='string'||typeof f.dataUrl!=='string'||!f.dataUrl.startsWith('data:image/png;base64,'))throw new Error('Upload PNG files only.');
          return {name:path.basename(f.name.replaceAll('\\','/')),data:Buffer.from(f.dataUrl.slice('data:image/png;base64,'.length),'base64')};
        });
        if(files.reduce((n,f)=>n+f.data.length,0)>128*1024*1024)throw new Error('A batch may contain at most 128 MB of PNGs.');
        const modulePath=config.modulePath;
        const task=atlasQueue.then(()=>buildAtlases({files,faction:data.faction,category:data.category,modulePath,gamePath:config.gamePath,outputDirectory:path.join(root,'atlas-builds'),sourceDirectory:path.join(modulePath,'AssetSources','BannerIcons'),install:data.install!==false,padding:Number(data.padding??0),outline:Number(data.outline??0),mode:data.mode||'alpha',startIndex:data.startIndex==null?undefined:Number(data.startIndex)}));
        atlasQueue=task.catch(()=>{});
        const result=await task;
        if(result.registration.installed){try{await refresh();}catch(error){result.refreshWarning='Import saved, but editor refresh failed: '+error.message;}}
        return send(res,200,{...result,atlases:result.atlases.map(a=>({...a,previewUrl:'/api/atlas-file/'+result.batchId+'/'+a.preview,psdUrl:'/api/atlas-file/'+result.batchId+'/'+a.psd,maskUrl:'/api/atlas-file/'+result.batchId+'/'+a.mask}))});
      }
      if(url.pathname==='/api/save-source') {
        const task=writeQueue.then(()=>saveBannerSource({root,modulePath:config.modulePath,library,data})); writeQueue=task.catch(()=>{});
        return send(res,200,await task);
      }
      if(url.pathname==='/api/drafts') {
        decode(data.code);
        const id=typeof data.id==='string' && /^[a-z0-9-]+$/.test(data.id) ? data.id : randomUUID();
        const draft={id,name:String(data.name||'Untitled banner').slice(0,150),code:data.code,sourceKey:data.sourceKey||null,savedAt:new Date().toISOString()};
        await fs.writeFile(path.join(root,'drafts',id+'.json'),JSON.stringify(draft,null,2));
        return send(res,200,draft);
      }
      if(url.pathname==='/api/export') {
        if(typeof data.png!=='string'||!data.png.startsWith('data:image/png;base64,'))throw new Error('Expected a PNG image.');
        const bytes=Buffer.from(data.png.slice('data:image/png;base64,'.length),'base64');
        const meta=await sharp(bytes,{limitInputPixels:16_777_216}).metadata();
        if(meta.format!=='png')throw new Error('Expected a PNG image.');
        const stem=String(data.name||'banner').replace(/[^a-z0-9 _-]/gi,'').slice(0,70)||'banner';
        const file=stem+'-'+randomUUID().slice(0,8)+'.png';
        const destination=path.join(root,'exports',file);
        await sharp(bytes,{limitInputPixels:16_777_216}).png().toFile(destination);
        return send(res,200,{path:destination,url:'/api/export-file/'+encodeURIComponent(file),name:file});
      }
      if(url.pathname==='/api/refresh') { await refresh(Boolean(data.extract)); return send(res,200,{ok:true}); }
      if(url.pathname==='/api/config') {
        const next={modulePath:String(data.modulePath),gamePath:String(data.gamePath),port:config.port};
        await fs.access(path.join(next.modulePath,'ModuleData/banner_icons.xml'));
        await fs.access(path.join(next.gamePath,'Modules/Native/ModuleData/banner_icons.xml'));
        await fs.writeFile(configFile,JSON.stringify(next,null,2)); config=next;
        await refresh(true); return send(res,200,{ok:true});
      }
      return send(res,404,{error:'Unknown action.'});
    }
    if(req.method!=='GET') return send(res,405,{error:'Method not supported.'});
    if(url.pathname==='/api/health') return send(res,200,{app:'taom-banner-editor',ready:!!library});
    if(url.pathname==='/api/library') return send(res,200,{...library,assets,config,token});
    if(url.pathname==='/api/atlas-info'){
      const folder=path.join(config.modulePath,'AssetSources','BannerIcons');
      const names=await fs.readdir(folder);
      const factions=[...new Set(names.map(n=>n.match(/^taom_banners_(.+)_(?:alpha|ornaments)_\d+\.psd$/i)?.[1]).filter(Boolean))].sort();
      return send(res,200,{factions,folder,atlasSize:2048,cellSize:512});
    }
    if(url.pathname.startsWith('/api/atlas-file/')){
      const parts=url.pathname.slice('/api/atlas-file/'.length).split('/').map(decodeURIComponent);
      if(parts.length!==2||!/^[0-9a-fTZ-]+$/i.test(parts[0])||!/^taom_banners_[a-z0-9_]+\.(?:psd|mask\.png|preview\.png)$/.test(parts[1]))throw new Error('Invalid atlas file.');
      const file=path.join(root,'atlas-builds',parts[0],parts[1]);const bytes=await fs.readFile(file);
      const isPsd=parts[1].endsWith('.psd');
      res.writeHead(200,{'Content-Type':isPsd?'image/vnd.adobe.photoshop':'image/png','Cache-Control':'no-cache',...(isPsd?{'Content-Disposition':'attachment; filename="'+parts[1]+'"'}:{})});return res.end(bytes);
    }
    if(url.pathname.startsWith('/api/export-file/')) {
      const file=decodeURIComponent(url.pathname.slice('/api/export-file/'.length));
      if(!/^[a-z0-9 _-]+\.png$/i.test(file))throw new Error('Invalid export name.');
      const bytes=await fs.readFile(path.join(root,'exports',file));
      res.writeHead(200,{'Content-Type':'image/png','Content-Disposition':'attachment; filename="'+file+'"','Cache-Control':'no-store'});return res.end(bytes);
    }
    if(url.pathname.startsWith('/api/mask/')) {
      const id=Number(url.pathname.split('/').at(-1).replace('.png',''));
      const icon=library.icons.find(i=>i.id===id);
      const material=assets.materials[icon?.material];
      const texture=assets.textures[material?.slots?.['0']];
      if(!icon || !texture?.images?.length) return send(res,404,{error:'Symbol artwork is unavailable: '+id});
      const source=path.join(root,texture.images[0].slice(1));
      if(!maskCache.has(id))maskCache.set(id,(async()=>{
        const image=sharp(source);const meta=await image.metadata();
        const w=meta.width/4,h=meta.height/4;
        return image.extract({left:(icon.index%4)*w,top:Math.floor(icon.index/4)*h,width:w,height:h}).resize(384,384).png().toBuffer();
      })().catch(error=>{maskCache.delete(id);throw error;}));
      const png=await maskCache.get(id);
      res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-cache'}); return res.end(png);
    }
    if(url.pathname==='/api/drafts') {
      const drafts=await Promise.all((await fs.readdir(path.join(root,'drafts'))).filter(f=>f.endsWith('.json')).map(async f=>JSON.parse(await fs.readFile(path.join(root,'drafts',f),'utf8'))));
      return send(res,200,drafts.sort((a,b)=>b.savedAt.localeCompare(a.savedAt)));
    }
    const isCache=url.pathname.startsWith('/cache/textures/');
    const base=path.join(root,isCache?'cache/textures':'public');
    const name=isCache?url.pathname.slice('/cache/textures/'.length):url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
    const file=path.resolve(base,name);
    if(!file.startsWith(base+path.sep)) return send(res,403,{error:'Invalid path.'});
    const content=await fs.readFile(file);
    const mime={'.html':'text/html','.css':'text/css','.mjs':'text/javascript','.png':'image/png','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream';
    res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'}); res.end(content);
  } catch(error) { send(res,error.code==='ENOENT'?404:400,{error:error.message}); }
});
server.listen(config.port,'127.0.0.1',()=>console.log(`TAOM Banner Editor: http://127.0.0.1:${config.port}`));
