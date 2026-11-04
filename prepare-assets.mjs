import fs from 'node:fs/promises';
import path from 'node:path';
import { readPsd, initializeCanvas } from 'ag-psd';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
initializeCanvas(undefined, (width,height) => ({width,height,data:new Uint8ClampedArray(width*height*4)}));
export async function prepareSourceTextures(root,assets,modulePath,icons=[],options={}){
  const custom=new Map();
  for(const icon of icons){
    if(icon.source==='Native'||!/^[-a-z0-9_]+$/i.test(icon.material))continue;
    let material=assets.materials[icon.material],guid=material?.slots?.['0'];
    if(!assets.textures[guid]){guid='source-'+icon.material;assets.materials[icon.material]={...material,name:icon.material,slots:{...material?.slots,'0':guid}};assets.textures[guid]??={name:icon.material,images:[]};}
    if(!custom.has(guid))custom.set(guid,new Set());custom.get(guid).add(icon.material);
  }
  for(const [guid,texture] of Object.entries(assets.textures)){
    if(texture.images?.length&&!custom.has(guid))continue;
    const names=[...new Set([texture.name,...(custom.get(guid)||[])])].filter(name=>/^[-a-z0-9_]+$/i.test(name));let source,stat;
    for(const name of names){for(const extension of ['psd','png']){const file=path.resolve(modulePath,options.atlasSourceDirectory||'AssetSources/BannerIcons',name+'.'+extension),info=await fs.stat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(info){source=file;stat=info;break;}}if(source)break;}
    if(!source){if(!texture.images?.length)assets.errors.push(texture.name+': source PSD/PNG not found.');continue;}
    try{
      const sourceId=createHash('sha256').update(source).digest('hex').slice(0,12),file=path.join(root,'cache','textures',guid.replaceAll('-','')+'_'+sourceId+'_source.png'),stampFile=file+'.json';
      const previous=await fs.readFile(stampFile,'utf8').then(JSON.parse).catch(()=>null),exists=await fs.stat(file).catch(()=>null);
      if(!exists||previous?.size!==stat.size||previous?.mtimeMs!==stat.mtimeMs){
        if(source.toLowerCase().endsWith('.png'))await sharp(source,{limitInputPixels:67_108_864}).ensureAlpha().png().toFile(file);
        else {const psd=readPsd(await fs.readFile(source),{useImageData:true,skipLayerImageData:true,skipThumbnail:true});if(!psd.imageData)throw new Error('PSD has no merged image');await sharp(Buffer.from(psd.imageData.data),{raw:{width:psd.width,height:psd.height,channels:4}}).png().toFile(file);}
        await fs.writeFile(stampFile,JSON.stringify({source,size:stat.size,mtimeMs:stat.mtimeMs}));console.log('Prepared source artwork: '+texture.name);
      }
      texture.images=['/cache/textures/'+path.basename(file)];texture.source=source;
    }catch(error){assets.errors.push(texture.name+': '+error.message);}
  }
  return assets;
}
