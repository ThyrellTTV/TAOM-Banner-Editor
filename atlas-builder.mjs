import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { writePsdBuffer, readPsd, initializeCanvas } from 'ag-psd';
import {readIconRegistry,planAtlasRegistration,installAtlasPackage} from './atlas-registration.mjs';

initializeCanvas(undefined,(width,height)=>({width,height,data:new Uint8ClampedArray(width*height*4)}));
export const ATLAS_SIZE=2048, CELL_SIZE=512, CELLS_PER_ATLAS=16;
const MAX_PIXELS=67_108_864;
const imageData=(data,width,height)=>({data:new Uint8ClampedArray(data),width,height});
export function factionSlug(value) {
  const text=String(value||'').trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
  if(!text||text.length>50)throw new Error('Enter a faction name, such as Gondor or Rohan.');
  return text;
}
export function categoryName(value) {
  if(value==='alpha')return 'alpha';
  if(value==='ornament'||value==='ornaments')return 'ornaments';
  throw new Error('Choose Alpha or Ornament.');
}
export function alphaBounds(data,width,height) {
  let left=width,top=height,right=-1,bottom=-1;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4+3]>0){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  if(right<left)return null;
  return {left,top,width:right-left+1,height:bottom-top+1};
}
// An odd number of visible pixels cannot be centred on a 512px cell using
// integer layer coordinates. Translate by half a pixel on each odd axis;
// bilinear coverage makes its bounds even, without scaling up the artwork.
export function centreOnPixelGrid(data,width,height) {
  const oddX=width%2,oddY=height%2;
  if(!oddX&&!oddY)return {data:Buffer.from(data),width,height,shiftX:0,shiftY:0};
  const w=width+oddX,h=height+oddY,out=Buffer.alloc(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let alpha=0;const colors=[0,0,0];
    for(let dy=0;dy<=oddY;dy++)for(let dx=0;dx<=oddX;dx++){
      const sx=x-dx,sy=y-dy;if(sx<0||sy<0||sx>=width||sy>=height)continue;
      const j=(sy*width+sx)*4,a=data[j+3]/((oddX+1)*(oddY+1));alpha+=a;
      for(let k=0;k<3;k++)colors[k]+=data[j+k]*a;
    }
    const j=(y*w+x)*4;
    // Keep faint non-zero edge pixels so centring is exact even at low alpha.
    out[j+3]=Math.ceil(alpha);
    if(alpha)for(let k=0;k<3;k++)out[j+k]=Math.round(colors[k]/alpha);
  }
  return {data:out,width:w,height:h,shiftX:oddX*.5,shiftY:oddY*.5};
}
function crop(data,width,bounds) {
  const out=Buffer.alloc(bounds.width*bounds.height*4);
  for(let y=0;y<bounds.height;y++)data.copy(out,y*bounds.width*4,((bounds.top+y)*width+bounds.left)*4,((bounds.top+y)*width+bounds.left+bounds.width)*4);
  return out;
}
export async function preparePng(file,{padding=0,outline=0,mode='alpha'}={}) {
  const input=Buffer.isBuffer(file.data)?file.data:Buffer.from(file.data||[]);
  if(!input.length||input.length>32*1024*1024)throw new Error(file.name+': PNG must be between 1 byte and 32 MB.');
  const info=await sharp(input,{limitInputPixels:MAX_PIXELS}).metadata();
  if(info.format!=='png')throw new Error(file.name+': only PNG files are supported.');
  if((info.pages||1)>1)throw new Error(file.name+': use a still PNG instead of an animated PNG.');
  const {data,width,height}=await sharp(input,{limitInputPixels:MAX_PIXELS}).rotate().ensureAlpha().raw().toBuffer({resolveWithObject:true}).then(x=>({data:x.data,width:x.info.width,height:x.info.height}));
  const mask=Buffer.from(data);let opaque=true;
  for(let i=0;i<mask.length;i+=4){
    const a=data[i+3];if(a<255)opaque=false;
    const lum=.2126*data[i]+.7152*data[i+1]+.0722*data[i+2];
    mask[i]=mask[i+1]=mask[i+2]=255;
    mask[i+3]=Math.round(a*(mode==='light-on-dark'?lum/255:mode==='dark-on-light'?1-lum/255:1));
  }
  const bounds=alphaBounds(mask,width,height);
  if(!bounds)throw new Error(file.name+': the PNG has no visible artwork with this mask setting.');
  const available=CELL_SIZE-2*padding-2*outline;
  const factor=Math.min(1,available/bounds.width,available/bounds.height);
  const targetWidth=Math.max(1,Math.floor(bounds.width*factor));
  const targetHeight=Math.max(1,Math.floor(bounds.height*factor));
  const croppedMask=crop(mask,width,bounds),croppedOriginal=crop(data,width,bounds);
  const resize=async source=>factor<1?sharp(source,{raw:{width:bounds.width,height:bounds.height,channels:4}}).resize(targetWidth,targetHeight,{fit:'fill',kernel:'lanczos3'}).raw().toBuffer():source;
  const resizedMask=await resize(croppedMask),resizedOriginal=await resize(croppedOriginal);
  const after=alphaBounds(resizedMask,targetWidth,targetHeight);
  if(!after)throw new Error(file.name+': artwork disappeared when downscaling.');
  const centred=centreOnPixelGrid(crop(resizedMask,targetWidth,after),after.width,after.height);
  const source=centreOnPixelGrid(crop(resizedOriginal,targetWidth,after),after.width,after.height);
  const outputWidth=centred.width+outline*2,outputHeight=centred.height+outline*2;
  const coverage=Buffer.alloc(outputWidth*outputHeight);
  for(let y=0;y<centred.height;y++)for(let x=0;x<centred.width;x++)coverage[(y+outline)*outputWidth+x+outline]=centred.data[(y*centred.width+x)*4+3];
  let dilated=coverage;
  if(outline){
    // A separable max filter produces a reproducible outside stroke.
    const horizontal=Buffer.alloc(coverage.length);dilated=Buffer.alloc(coverage.length);
    for(let y=0;y<outputHeight;y++)for(let x=0;x<outputWidth;x++){
      let max=0;for(let dx=-outline;dx<=outline;dx++)if(x+dx>=0&&x+dx<outputWidth)max=Math.max(max,coverage[y*outputWidth+x+dx]);horizontal[y*outputWidth+x]=max;
    }
    for(let y=0;y<outputHeight;y++)for(let x=0;x<outputWidth;x++){
      let max=0;for(let dy=-outline;dy<=outline;dy++)if(y+dy>=0&&y+dy<outputHeight)max=Math.max(max,horizontal[(y+dy)*outputWidth+x]);dilated[y*outputWidth+x]=max;
    }
  }
  const gameMask=Buffer.alloc(outputWidth*outputHeight*4);
  for(let i=0;i<coverage.length;i++){gameMask[i*4]=Math.max(0,dilated[i]-coverage[i]);gameMask[i*4+1]=coverage[i];gameMask[i*4+3]=255;}
  const warnings=[];
  if(opaque&&mode==='alpha')warnings.push('PNG is fully opaque: its entire rectangle becomes the symbol. Use a transparent PNG or a black/white mask mode for a cutout.');
  return {name:path.basename(file.name),gameMask,width:outputWidth,height:outputHeight,source,originalSize:{width,height},trimmedBounds:bounds,scale:factor,subpixelShift:{x:centred.shiftX,y:centred.shiftY},warnings};
}
async function availableStart(sourceDirectory,faction,category,requested,materials=[]) {
  const names=await fs.readdir(sourceDirectory).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
  const prefix='taom_banners_'+faction+'_'+category+'_';
  const used=[...names.filter(n=>n.endsWith('.psd')).map(n=>n.slice(0,-4)),...materials].filter(n=>n.startsWith(prefix)).map(n=>Number(n.slice(prefix.length))).filter(Number.isInteger);
  if(requested!==undefined&&(!Number.isInteger(requested)||requested<1||requested>9999))throw new Error('Atlas number must be a whole number from 1 to 9999.');
  return requested??Math.max(0,...used)+1;
}
function guides() {
  return [512,1024,1536].flatMap(location=>[{location,direction:'horizontal'},{location,direction:'vertical'}]);
}
async function transparentThumbnail(art){
  const raw=Buffer.from(art.gameMask);
  for(let i=0;i<raw.length;i+=4){const alpha=Math.min(255,raw[i]+raw[i+1]);raw[i]=raw[i+1]=raw[i+2]=255;raw[i+3]=alpha;}
  const width=Math.max(1,Math.floor(art.width/2)),height=Math.max(1,Math.floor(art.height/2));
  const resized=await sharp(raw,{raw:{width:art.width,height:art.height,channels:4}}).resize(width,height).raw().toBuffer();
  const bounds=alphaBounds(resized,width,height);
  if(!bounds)throw new Error('Artwork disappeared in its GUI thumbnail.');
  const centred=centreOnPixelGrid(crop(resized,width,bounds),bounds.width,bounds.height);
  const canvas=Buffer.alloc(256*256*4),left=128-centred.width/2,top=128-centred.height/2;
  for(let y=0;y<centred.height;y++)centred.data.copy(canvas,((top+y)*256+left)*4,y*centred.width*4,(y+1)*centred.width*4);
  return sharp(canvas,{raw:{width:256,height:256,channels:4}}).png().toBuffer();
}
// Render an explicitly mapped page without changing XML texture indexes.
// Used by both the new-atlas importer and registered-atlas regeneration.
export async function writeAtlasPage({name,files,directory,padding=0,outline=0,mode='alpha',sourceOffset=0}) {
  if(!/^taom_banners_[a-z0-9_]+$/.test(name))throw new Error('Invalid atlas material name.');
  if(!files.length||files.length>16)throw new Error('An atlas needs between 1 and 16 symbols.');
  const slots=files.map((file,index)=>file.textureIndex??index);
  if(slots.some(slot=>!Number.isInteger(slot)||slot<0||slot>15)||new Set(slots).size!==slots.length)throw new Error('Atlas texture indexes must be unique integers from 0 to 15.');
  await fs.mkdir(path.join(directory,'sources'),{recursive:true});
  const composite=Buffer.alloc(ATLAS_SIZE*ATLAS_SIZE*4);for(let p=3;p<composite.length;p+=4)composite[p]=255;
  const background=Buffer.from(composite),maskLayers=[],sourceLayers=[],cells=[];
  for(let item=0;item<files.length;item++){
    const original=files[item],slot=original.textureIndex??item,art=await preparePng(original,{padding,outline,mode});
    const row=Math.floor(slot/4),column=slot%4,cx=column*CELL_SIZE+CELL_SIZE/2,cy=row*CELL_SIZE+CELL_SIZE/2;
    const left=cx-art.width/2,top=cy-art.height/2;
    if(!Number.isInteger(left)||!Number.isInteger(top))throw new Error('Internal error: symbol did not land on the exact cell centre.');
    const coverage=Buffer.from(art.gameMask);for(let p=0;p<coverage.length;p+=4)coverage[p+3]=Math.max(coverage[p],coverage[p+1]);
    const visible=alphaBounds(coverage,art.width,art.height);
    if(!visible||left+visible.left+visible.width/2!==cx||top+visible.top+visible.height/2!==cy)throw new Error(original.name+': visible artwork did not pass the exact-centre check.');
    for(let y=0;y<art.height;y++)art.gameMask.copy(composite,((top+y)*ATLAS_SIZE+left)*4,y*art.width*4,(y+1)*art.width*4);
    maskLayers.push({name:`${String(slot).padStart(2,'0')} · ${art.name}`,left,top,imageData:imageData(art.gameMask,art.width,art.height)});
    sourceLayers.push({name:`${String(slot).padStart(2,'0')} · ${art.name} · original colours`,left:cx-art.source.width/2,top:cy-art.source.height/2,imageData:imageData(art.source.data,art.source.width,art.source.height)});
    const safe=art.name.replace(/[^a-z0-9._-]/gi,'_').slice(-120)||'symbol.png';
    const sourceName=String(sourceOffset+slot).padStart(3,'0')+'-'+safe;
    await fs.writeFile(path.join(directory,'sources',sourceName),original.data,{flag:'wx'});
    let thumbnail;
    if(original.id!==undefined){
      if(!/^\d+$/.test(String(original.id)))throw new Error('Invalid thumbnail icon ID.');
      thumbnail='thumbnails/'+original.id+'.png';await fs.mkdir(path.join(directory,'thumbnails'),{recursive:true});
      await fs.writeFile(path.join(directory,thumbnail),await transparentThumbnail(art),{flag:'wx'});
    }
    cells.push({iconId:original.id,thumbnail,textureIndex:slot,row,column,source:art.name,originalFile:'sources/'+sourceName,originalSize:art.originalSize,trimmedBounds:art.trimmedBounds,scale:art.scale,placedBounds:{left,top,width:art.width,height:art.height},centre:{x:cx,y:cy},centreVerified:true,subpixelShift:art.subpixelShift,warnings:art.warnings});
  }
  const psd={width:ATLAS_SIZE,height:ATLAS_SIZE,colorMode:3,bitsPerChannel:8,children:[{name:'Black background',left:0,top:0,transparencyProtected:true,imageData:imageData(background,ATLAS_SIZE,ATLAS_SIZE)},{name:'Original PNG colours (reference only)',hidden:true,opened:false,children:sourceLayers},{name:'Game masks · green fill / red outline',opened:true,children:maskLayers}],imageData:imageData(composite,ATLAS_SIZE,ATLAS_SIZE),imageResources:{gridAndGuidesInformation:{grid:{horizontal:CELL_SIZE,vertical:CELL_SIZE},guides:guides()}}};
  const psdFile=path.join(directory,name+'.psd');
  await fs.writeFile(psdFile,writePsdBuffer(psd,{generateThumbnail:false,compress:true}),{flag:'wx'});
  const verify=readPsd(await fs.readFile(psdFile),{useImageData:true,skipLayerImageData:true,skipThumbnail:true});
  if(verify.width!==ATLAS_SIZE||verify.height!==ATLAS_SIZE||!Buffer.from(verify.imageData.data).equals(composite))throw new Error('PSD composite verification failed.');
  await sharp(composite,{raw:{width:ATLAS_SIZE,height:ATLAS_SIZE,channels:4}}).png().toFile(path.join(directory,name+'.mask.png'));
  const preview=Buffer.from(composite);
  for(let p=0;p<preview.length;p+=4){const v=Math.min(255,preview[p+1]+Math.round(preview[p]*.45));preview[p]=preview[p+1]=preview[p+2]=v;}
  const overlay=Buffer.from(`<svg width="2048" height="2048" xmlns="http://www.w3.org/2000/svg">${Array.from({length:16},(_,i)=>{const x=i%4*512,y=Math.floor(i/4)*512;return `<rect x="${x+.5}" y="${y+.5}" width="511" height="511" fill="none" stroke="#aa8d59" stroke-width="2"/><path d="M${x+246} ${y+256}h20M${x+256} ${y+246}v20" stroke="#61c5ff" stroke-opacity=".65" stroke-width="2"/><text x="${x+14}" y="${y+32}" fill="#d1ae75" font-family="Arial" font-size="22">${i}</text>`;}).join('')}</svg>`);
  const guided=await sharp(preview,{raw:{width:ATLAS_SIZE,height:ATLAS_SIZE,channels:4}}).composite([{input:overlay}]).png().toBuffer();
  await sharp(guided).resize(1024,1024).png().toFile(path.join(directory,name+'.preview.png'));
  return {name,psd:name+'.psd',mask:name+'.mask.png',preview:name+'.preview.png',cells,installedPath:null};
}

export async function buildAtlases({files,faction,category,outputDirectory,sourceDirectory,modulePath,gamePath,install=true,padding=0,outline=0,mode='alpha',startIndex}) {
  faction=factionSlug(faction);category=categoryName(category);
  if(!Array.isArray(files)||!files.length||files.length>128)throw new Error('Choose between 1 and 128 PNGs. Extra images automatically start another 4×4 atlas.');
  if(!Number.isInteger(padding)||padding<0||padding>128)throw new Error('Padding must be between 0 and 128 pixels.');
  if(!Number.isInteger(outline)||outline<0||outline>24)throw new Error('Outline must be between 0 and 24 pixels.');
  if(!['alpha','light-on-dark','dark-on-light'].includes(mode))throw new Error('Choose a valid PNG mask mode.');
  if(CELL_SIZE-2*padding-2*outline<2)throw new Error('Padding and outline leave no room for artwork.');
  if(!sourceDirectory)throw new Error('A module banner source directory is required.');
  modulePath=path.resolve(modulePath||path.join(sourceDirectory,'..','..'));
  if(path.resolve(sourceDirectory)!==path.join(modulePath,'AssetSources','BannerIcons'))throw new Error('Banner source directory must belong to the selected module.');
  const registry=await readIconRegistry(modulePath);
  const index=await availableStart(sourceDirectory,faction,category,startIndex,registry.materials);
  const batchId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8);
  const directory=path.join(path.resolve(outputDirectory),batchId);
  const total=Math.ceil(files.length/CELLS_PER_ATLAS);
  const planned=Array.from({length:total},(_,i)=>`taom_banners_${faction}_${category}_${String(index+i).padStart(2,'0')}`);
  const registration=await planAtlasRegistration({modulePath,gamePath,registry,atlases:planned.map((name,page)=>({name,count:Math.min(16,files.length-page*16)}))});
  if(install)for(const name of planned)if(await fs.stat(path.join(sourceDirectory,name+'.psd')).catch(()=>null))throw new Error('Atlas already exists: '+name+'.psd. Choose a new atlas number.');
  // Validate every input before creating any output or copying module files.
  for(const file of files){const meta=await sharp(file.data,{limitInputPixels:MAX_PIXELS}).metadata();if(meta.format!=='png')throw new Error(file.name+': only PNG files are supported.');}
  await fs.mkdir(path.join(directory,'sources'),{recursive:true});
  const results=[];
  try{
    for(let page=0;page<total;page++){
      const plan=registration.atlases[page],name=plan.name,batch=files.slice(page*16,page*16+16).map((file,i)=>({...file,id:plan.icons[i].id}));
      results.push({...await writeAtlasPage({name,files:batch,directory,padding,outline,mode,sourceOffset:page*16}),groupId:plan.groupId,groupName:plan.title});
    }
    await fs.writeFile(path.join(directory,'banner_icons.xml'),registration.changed,{flag:'wx'});
    await fs.writeFile(path.join(directory,'banner_icons.additions.xml'),registration.snippet,{flag:'wx'});
    const manifest={version:2,batchId,createdAt:new Date().toISOString(),faction,category,atlasSize:ATLAS_SIZE,cellSize:CELL_SIZE,grid:{rows:4,columns:4},scaling:'downscale-only',centering:'visible-alpha-bounds',padding,outline,mode,directory,atlases:results,registration:{installed:false,xmlPath:registration.xmlPath,thumbnailDirectory:registration.thumbnailDirectory,icons:files.length}};
    // Save the review package before touching the module.
    await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});
    if(install){manifest.registration=await installAtlasPackage({plan:registration,atlases:results,directory,sourceDirectory});await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2));}
    return manifest;
  }catch(error){await fs.writeFile(path.join(directory,'FAILED.txt'),error.message).catch(()=>{});throw error;}
}
