import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {readPsd,writePsdBuffer} from 'ag-psd';
import {readIconRegistry,planSlotRegistration,iconGroupOptions} from './atlas-registration.mjs';
import {configPaths,workspaceIdentity} from './configuration.mjs';
import {preparePng} from './atlas-builder.mjs';
import {decode} from './public/banner-code.mjs';

const list=x=>x==null?[]:Array.isArray(x)?x:[x];
const sha=data=>createHash('sha256').update(data).digest('hex');
const hashFile=async file=>fs.readFile(file).then(sha).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
const safeMaterial=name=>typeof name==='string'&&/^[-a-z0-9_]{1,160}$/i.test(name);
export async function atlasSourceFile(directory,material){
  for(const extension of ['psd','png']){const file=path.join(directory,material+'.'+extension);if(await fs.stat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;}))return file;}
  return null;
}
export async function sourceDimensions(file){
  if(file.toLowerCase().endsWith('.psd'))return psdDimensions(file);
  const meta=await sharp(file).metadata();return {width:meta.width,height:meta.height,depth:meta.depth==='ushort'?16:8};
}
function groupsFrom(registry){
  const groups=new Map();for(const group of registry.groups)for(const icon of list(group.Icon)){
    const name=String(icon.material_name);if(!groups.has(name))groups.set(name,{name,groups:[],icons:[]});const item=groups.get(name);
    if(!item.groups.includes(group.name))item.groups.push(group.name);item.icons.push({id:Number(icon.id),slot:Number(icon.texture_index),group:Number(group.id)});
  }return [...groups.values()];
}
export async function psdDimensions(file){
  let handle;try{handle=await fs.open(file,'r');const bytes=Buffer.alloc(26);await handle.read(bytes,0,26,0);if(bytes.toString('ascii',0,4)!=='8BPS')throw new Error('Invalid PSD header.');return {width:bytes.readUInt32BE(18),height:bytes.readUInt32BE(14),depth:bytes.readUInt16BE(22)};}finally{await handle?.close();}
}
export async function atlasCatalog({config,root,library}){
  const p=configPaths(config,root),registry=await readIconRegistry(config.modulePath,p.registry),groups=groupsFrom(registry);
  return {atlases:await Promise.all(groups.map(async atlas=>{
    let dimensions=null,error=null,sourceFile=null;
    try{sourceFile=safeMaterial(atlas.name)?await atlasSourceFile(p.atlasSources,atlas.name):null;if(!sourceFile)throw new Error('Source PSD/PNG not found.');dimensions=await sourceDimensions(sourceFile);}catch(e){error=e.message;}
    const ids=new Set(atlas.icons.map(i=>i.id)),banners=(library?.banners||[]).filter(b=>decode(b.code).slice(1).some(l=>ids.has(l.meshId))).length;
    return {...atlas,dimensions,error,sourceFile,editable:!!dimensions&&dimensions.width===dimensions.height&&dimensions.width%8===0&&dimensions.width<=4096&&dimensions.depth===8,banners};
  })),sourceDirectory:p.atlasSources};
}
export async function atlasDetails({config,root,library,material}){
  if(!safeMaterial(material))throw new Error('Invalid atlas material.');
  const p=configPaths(config,root),registry=await readIconRegistry(config.modulePath,p.registry),atlas=groupsFrom(registry).find(a=>a.name===material);
  if(!atlas)throw new Error('Atlas is not registered in this module.');
  if(atlas.icons.some(i=>!Number.isSafeInteger(i.id)||!Number.isInteger(i.slot)||i.slot<0||i.slot>15)||new Set(atlas.icons.map(i=>i.id)).size!==atlas.icons.length)throw new Error('Repair duplicate IDs or invalid slots before editing this atlas.');
  const sourcePath=await atlasSourceFile(p.atlasSources,material);if(!sourcePath)throw new Error('Source PSD/PNG not found.');const bytes=await fs.readFile(sourcePath),dimensions=await sourceDimensions(sourcePath);
  if(dimensions.width!==dimensions.height||dimensions.width%8||dimensions.width>4096||dimensions.depth!==8)throw new Error('Editing requires an 8-bit square 4×4 PSD with even-sized cells, up to 4096×4096.');
  const thumbnails={};for(const icon of atlas.icons)thumbnails[icon.id]=await hashFile(path.join(p.thumbnails,icon.id+'.png'));
  const usages=Object.fromEntries(atlas.icons.map(i=>[i.id,(library?.banners||[]).filter(b=>decode(b.code).slice(1).some(l=>l.meshId===i.id)).map(b=>({key:b.key,name:b.name,kind:b.kind}))]));
  const groupOptions=iconGroupOptions(registry);
  return {...atlas,groupOptions,dimensions,sourcePath,sourceFormat:path.extname(sourcePath).slice(1),cellSize:dimensions.width/4,snapshot:{xml:sha(registry.original),source:sha(bytes),file:path.basename(sourcePath),thumbnails},usages};
}
export function maskBounds(data,width,height){
  let left=width,top=height,right=-1,bottom=-1;for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;if(data[i+3]&&(data[i]||data[i+1])){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}}
  return right<0?null:{left,top,width:right-left+1,height:bottom-top+1};
}
export function extractCell(data,size,slot){
  const cell=size/4,out=Buffer.alloc(cell*cell*4),left=slot%4*cell,top=Math.floor(slot/4)*cell;
  for(let y=0;y<cell;y++)data.copy(out,y*cell*4,((top+y)*size+left)*4,((top+y)*size+left+cell)*4);return out;
}
export function centreMask(data,size){
  const bounds=maskBounds(data,size,size);if(!bounds)return Buffer.from(data);
  const oddX=bounds.width%2,oddY=bounds.height%2,w=bounds.width+oddX,h=bounds.height+oddY,left=(size-w)/2,top=(size-h)/2;
  const out=Buffer.alloc(size*size*4);for(let i=3;i<out.length;i+=4)out[i]=255;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const sums=[0,0,0];for(let dy=0;dy<=oddY;dy++)for(let dx=0;dx<=oddX;dx++){
      const sx=x-dx,sy=y-dy;if(sx<0||sy<0||sx>=bounds.width||sy>=bounds.height)continue;
      const i=((bounds.top+sy)*size+bounds.left+sx)*4;for(let c=0;c<3;c++)sums[c]+=data[i+c]*data[i+3]/255;
    }const i=((top+y)*size+left+x)*4;for(let c=0;c<3;c++)out[i+c]=Math.ceil(sums[c]/((oddX+1)*(oddY+1)));
  }return out;
}
export async function maskThumbnail(cell,size){
  const raw=Buffer.from(cell);for(let i=0;i<raw.length;i+=4){const a=Math.round(Math.min(255,raw[i]+raw[i+1])*raw[i+3]/255);raw[i]=raw[i+1]=raw[i+2]=255;raw[i+3]=a;}
  return sharp(raw,{raw:{width:size,height:size,channels:4}}).resize(256,256).png().toBuffer();
}
function putCell(composite,size,slot,cell){const width=size/4,left=slot%4*width,top=Math.floor(slot/4)*width;for(let y=0;y<width;y++)cell.copy(composite,((top+y)*size+left)*4,y*width*4,(y+1)*width*4);}
export async function stageAtlasEdit({config,root,library,material,expected,actions}){
  if(!Array.isArray(actions)||!actions.length||actions.length>128)throw new Error('Queue between 1 and 128 atlas operations.');
  const detail=await atlasDetails({config,root,library,material});
  if(!expected||JSON.stringify(expected)!==JSON.stringify(detail.snapshot))throw new Error('Atlas, registry or thumbnails changed. Reload the atlas before building.');
  const original=await fs.readFile(detail.sourcePath);if(sha(original)!==expected.source)throw new Error('Atlas source changed while loading.');
  let psd;
  if(detail.sourceFormat==='psd')psd=readPsd(original,{useImageData:true,skipThumbnail:true});
  else {const {data,info}=await sharp(original).ensureAlpha().raw().toBuffer({resolveWithObject:true}),imageData={width:info.width,height:info.height,data:new Uint8ClampedArray(data)};psd={width:info.width,height:info.height,bitsPerChannel:8,colorMode:3,imageData,children:[{name:'Original PNG atlas',left:0,top:0,imageData}]};}
  if(!psd.imageData||psd.colorMode!==3)throw new Error('Atlas source must have an 8-bit RGB merged image.');
  const size=psd.width,cellSize=size/4,composite=Buffer.from(psd.imageData.data),changes=new Map(),sources=[],warnings=[];
  const registered=new Set(detail.icons.map(i=>i.slot)),newSlots=new Map(),groupActions=new Map();
  // {groupId} for an existing icon group, or {newGroup:'Name', newGroupId?} to create one.
  const groupTarget=(action,fallback)=>{
    if(action.newGroup!=null){const name=String(action.newGroup).trim().replace(/\s+/g,' ');if(!name)throw new Error('Name the new icon group.');const id=action.newGroupId==null||action.newGroupId===''?undefined:Number(action.newGroupId);return id===undefined?{newGroup:name}:{newGroup:name,newGroupId:id};}
    const id=action.groupId==null?fallback:Number(action.groupId);if(!Number.isSafeInteger(id))throw new Error('Choose an icon group.');return {groupId:id};
  };
  const slot=(value,allowUnused=false)=>{if(!Number.isInteger(value)||value<0||value>15||!allowUnused&&!registered.has(value))throw new Error('Choose a filled atlas slot (0–15), or upload a PNG to an unused slot first.');return value;};
  const cell=index=>Buffer.from(changes.get(index)||extractCell(composite,size,index));
  for(const action of actions){
    if(action.type==='center'){
      const index=slot(action.slot),before=cell(index);if(!maskBounds(before,cellSize,cellSize))warnings.push('Slot '+index+' is empty; replace its artwork first.');changes.set(index,centreMask(before,cellSize));
    }else if(action.type==='swap'){
      const a=slot(action.from),b=slot(action.to);if(a===b)throw new Error('Choose two different registered slots to swap.');const first=cell(a),second=cell(b);changes.set(a,second);changes.set(b,first);
    }else if(action.type==='replace'){
      const index=slot(action.slot,true),file=action.file;if(!file||typeof file.name!=='string'||typeof file.dataUrl!=='string'||!file.dataUrl.startsWith('data:image/png;base64,'))throw new Error('Choose a replacement PNG.');
      const data=Buffer.from(file.dataUrl.slice(22),'base64'),art=await preparePng({name:file.name,data},{cellSize,padding:Number(action.padding||0),outline:Number(action.outline||0),mode:action.mode||'alpha'});
      const out=Buffer.alloc(cellSize*cellSize*4);for(let i=3;i<out.length;i+=4)out[i]=255;
      const left=(cellSize-art.width)/2,top=(cellSize-art.height)/2;for(let y=0;y<art.height;y++)art.gameMask.copy(out,((top+y)*cellSize+left)*4,y*art.width*4,(y+1)*art.width*4);
      changes.set(index,out);sources.push({slot:index,name:path.basename(file.name),data,source:art.source});warnings.push(...art.warnings.map(w=>'Slot '+index+': '+w));
      if(!registered.has(index)||newSlots.has(index)){newSlots.set(index,{slot:index,...groupTarget(action,detail.icons[0]?.group)});registered.add(index);}
    }else if(action.type==='group'){
      const index=slot(action.slot,true);groupActions.set(index,groupTarget(action));
    }else throw new Error('Unsupported atlas operation.');
  }
  // Icon group changes: registered slots move their existing IDs; slots filled in this review register their new ID there.
  const moves=[];
  for(const [index,target] of groupActions){
    if(detail.icons.some(i=>i.slot===index))moves.push({slot:index,...target});
    else if(newSlots.has(index))newSlots.set(index,{slot:index,...target});
    else throw new Error('Slot '+index+' is unused. Add a PNG to it before choosing its icon group.');
  }
  const newGroups=new Map();
  for(const item of [...moves,...newSlots.values()])if(item.newGroup!=null){
    const key=item.newGroup.toLowerCase(),known=newGroups.get(key);
    if(known&&item.newGroupId!=null&&known.id!=null&&known.id!==item.newGroupId)throw new Error('New icon group "'+item.newGroup+'" was given two different IDs.');
    newGroups.set(key,{name:item.newGroup,id:item.newGroupId??known?.id});
  }
  const p=configPaths(config,root);let registration=null;
  if(newSlots.size||moves.length){
    registration=await planSlotRegistration({modulePath:config.modulePath,gamePath:config.gamePath,material,additions:[...newSlots.values()],moves,newGroups:[...newGroups.values()],registryFile:p.registry,nativeRegistryFile:p.nativeRegistry,thumbnailDirectory:p.thumbnails,keyPrefix:config.moduleName});
    if(sha(registration.original)!==detail.snapshot.xml)throw new Error('The registry changed. Reload the atlas before building.');
    if(registration.changed.equals(registration.original))registration=null;
  }
  if(!changes.size&&!registration)throw new Error('Nothing to change: the chosen icon groups are already assigned.');
  const additions=registration?.additions||[],plannedMoves=registration?.moves||[],createdGroups=registration?.newGroups||[],allIcons=[...detail.icons,...additions.map(a=>({id:a.id,slot:a.slot,group:a.groupId}))];
  for(const group of detail.groupOptions){const leaving=plannedMoves.flatMap(m=>m.ids).filter(id=>detail.icons.find(i=>i.id===id)?.group===group.id).length;if(leaving&&leaving===group.icons)warnings.push('Icon group '+group.id+' ('+group.name+') will have no icons left.');}
  const batchId='manage-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8),directory=path.join(p.data,'atlas-builds',batchId);
  await fs.mkdir(path.join(directory,'thumbnails'),{recursive:true});await fs.mkdir(path.join(directory,'sources'),{recursive:true});
  const layers=[];for(const [index,pixels] of changes){putCell(composite,size,index,pixels);layers.push({name:'Slot '+index+' · IDs '+allIcons.filter(i=>i.slot===index).map(i=>i.id).join(', '),left:index%4*cellSize,top:Math.floor(index/4)*cellSize,imageData:{width:cellSize,height:cellSize,data:new Uint8ClampedArray(pixels)}});}
  const reference=[];for(let i=0;i<sources.length;i++){const input=sources[i],source=input.source;await fs.writeFile(path.join(directory,'sources',i+'-'+input.name.replace(/[^a-z0-9._-]/gi,'_')),input.data,{flag:'wx'});reference.push({name:'Slot '+input.slot+' · original colours',left:input.slot%4*cellSize+(cellSize-source.width)/2,top:Math.floor(input.slot/4)*cellSize+(cellSize-source.height)/2,imageData:{width:source.width,height:source.height,data:new Uint8ClampedArray(source.data)}});}
  psd.children||=[];if(reference.length)psd.children.push({name:'Atlas manager · PNG references',hidden:true,children:reference});psd.children.push({name:'Atlas manager · updated slots',opened:true,children:layers});psd.imageData={width:size,height:size,data:new Uint8ClampedArray(composite)};
  const psdName=material+'.psd',output=writePsdBuffer(psd,{generateThumbnail:false,compress:true});await fs.writeFile(path.join(directory,psdName),output,{flag:'wx'});
  const verified=readPsd(output,{useImageData:true,skipLayerImageData:true,skipThumbnail:true});if(!Buffer.from(verified.imageData.data).equals(composite))throw new Error('Updated PSD composite did not verify.');
  const sourceFile=path.basename(detail.sourcePath);let sourceHash=sha(output);
  if(detail.sourceFormat==='png'){const png=await sharp(composite,{raw:{width:size,height:size,channels:4}}).png().toBuffer();await fs.writeFile(path.join(directory,sourceFile),png,{flag:'wx'});sourceHash=sha(png);}
  const thumbnailFiles=[];for(const icon of allIcons.filter(i=>changes.has(i.slot))){const name=icon.id+'.png',png=await maskThumbnail(changes.get(icon.slot),cellSize);await fs.writeFile(path.join(directory,'thumbnails',name),png,{flag:'wx'});thumbnailFiles.push({id:icon.id,file:'thumbnails/'+name,hash:sha(png)});}
  if(registration)await fs.writeFile(path.join(directory,'banner_icons.xml'),registration.changed,{flag:'wx'});
  const preview=Buffer.from(composite);for(let i=0;i<preview.length;i+=4){preview[i]=preview[i+1]=preview[i+2]=Math.min(255,preview[i]+preview[i+1]);preview[i+3]=255;}
  await sharp(preview,{raw:{width:size,height:size,channels:4}}).resize(1024,1024).png().toFile(path.join(directory,material+'.preview.png'));
  const manifest={version:1,status:'review',batchId,directory,createdAt:new Date().toISOString(),workspaceId:workspaceIdentity(config),material,size,cellSize,changedSlots:[...changes.keys()].sort((a,b)=>a-b),snapshot:detail.snapshot,sourceFile,sourceHash,psd:psdName,psdHash:sha(output),preview:material+'.preview.png',thumbnails:thumbnailFiles,sourceChanged:changes.size>0,additions,moves:plannedMoves,newGroups:createdGroups,registration:registration?{file:'banner_icons.xml',hash:sha(registration.changed)}:null,actions:actions.map(({file,...action})=>({...action,...(file?{file:file.name}:{})})),warnings};
  await fs.writeFile(path.join(directory,'managed-atlas.json'),JSON.stringify(manifest,null,2),{flag:'wx'});return manifest;
}
export function managedDirectory(config,root,batchId){if(!/^manage-[0-9a-fTZ-]+$/i.test(batchId))throw new Error('Invalid atlas review package.');return path.join(configPaths(config,root).data,'atlas-builds',batchId);}
export async function installAtlasEdit({config,root,batchId,io=fs}){
  const directory=managedDirectory(config,root,batchId),manifestFile=path.join(directory,'managed-atlas.json'),manifest=JSON.parse(await io.readFile(manifestFile,'utf8'));
  if(manifest.status!=='review'||manifest.workspaceId!==workspaceIdentity(config)||!safeMaterial(manifest.material))throw new Error('This review is already installed or belongs to another workspace.');
  const additions=manifest.additions||[],moves=manifest.moves||[],newGroups=manifest.newGroups||[];if(!Array.isArray(additions)||!Array.isArray(moves)||!Array.isArray(newGroups)||moves.length>16||newGroups.length>32)throw new Error('Invalid registration in atlas review manifest.');const newIds=new Set(additions.map(a=>a.id)),sourceChanged=manifest.sourceChanged!==false;
  if(additions.length>16||newIds.size!==additions.length||!!manifest.registration!==!!(additions.length||moves.length)||!manifest.registration&&!sourceChanged||manifest.registration&&manifest.registration.file!=='banner_icons.xml')throw new Error('Invalid registration in atlas review manifest.');
  if(manifest.psd!==manifest.material+'.psd'||![manifest.material+'.psd',manifest.material+'.png'].includes(manifest.sourceFile)||!Array.isArray(manifest.thumbnails)||manifest.thumbnails.length>4096||new Set(manifest.thumbnails.map(t=>t.id)).size!==manifest.thumbnails.length||manifest.thumbnails.some(t=>!Number.isSafeInteger(t.id)||t.id<0||!Object.hasOwn(manifest.snapshot.thumbnails,t.id)&&!newIds.has(t.id)||t.file!=='thumbnails/'+t.id+'.png')||additions.some(a=>!manifest.thumbnails.some(t=>t.id===a.id)))throw new Error('Invalid files in atlas review manifest.');
  const p=configPaths(config,root),target=path.join(p.atlasSources,manifest.sourceFile),lock=target+'.atlas-manager.lock',registryLock=p.registry+'.atlas-import.lock';let handle,registryHandle;
  try{handle=await io.open(lock,'wx');}catch(error){if(error.code==='EEXIST')throw new Error('Another atlas update is in progress.');throw error;}
  const records=[],committed=[],backup=path.join(directory,'originals');
  const read=async file=>io.readFile(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  try{
    if(manifest.registration){try{registryHandle=await io.open(registryLock,'wx');}catch(error){if(error.code==='EEXIST')throw new Error('Another atlas import is updating the registry. Try again after it finishes.');throw error;}}
    if(sha(await io.readFile(p.registry))!==manifest.snapshot.xml)throw new Error('The registry changed. Build a fresh atlas review.');
    if(sha(await io.readFile(path.join(directory,manifest.psd)))!==manifest.psdHash)throw new Error('Staged PSD changed. Build a fresh atlas review.');
    if(await atlasSourceFile(p.atlasSources,manifest.material)!==target)throw new Error('The atlas source format changed. Build a fresh review.');
    if(sha(await io.readFile(path.join(directory,manifest.sourceFile)))!==manifest.sourceHash)throw new Error('Staged source changed. Build a fresh review.');
    if(sourceChanged)records.push({target,source:path.join(directory,manifest.sourceFile),expected:manifest.snapshot.source,hash:manifest.sourceHash,backup:path.join(backup,manifest.sourceFile)});
    else if(await hashFile(target)!==manifest.snapshot.source)throw new Error('Atlas source changed since review: '+target);
    for(const thumb of manifest.thumbnails){if(await hashFile(path.join(directory,thumb.file))!==thumb.hash)throw new Error('Staged thumbnail changed.');records.push({target:path.join(p.thumbnails,thumb.id+'.png'),source:path.join(directory,thumb.file),expected:newIds.has(thumb.id)?null:manifest.snapshot.thumbnails[thumb.id],hash:thumb.hash,backup:path.join(backup,'thumbnails',thumb.id+'.png')});}
    if(manifest.registration){
      const plan=await planSlotRegistration({modulePath:config.modulePath,gamePath:config.gamePath,material:manifest.material,additions:additions.map(({id,slot,groupId})=>({id,slot,groupId})),moves:moves.map(({slot,groupId})=>({slot,groupId})),newGroups:newGroups.map(({name,id})=>({name,id})),registryFile:p.registry,nativeRegistryFile:p.nativeRegistry,thumbnailDirectory:p.thumbnails,keyPrefix:config.moduleName}),proposed=await io.readFile(path.join(directory,manifest.registration.file));
      if(sha(plan.original)!==manifest.snapshot.xml||sha(proposed)!==manifest.registration.hash||!proposed.equals(plan.changed))throw new Error('The proposed registry changed or new icon IDs are no longer available. Build a fresh review.');
      records.push({target:p.registry,source:path.join(directory,manifest.registration.file),expected:manifest.snapshot.xml,hash:manifest.registration.hash,backup:path.join(backup,'banner_icons.xml')});
    }
    await io.mkdir(backup,{recursive:true});if(!manifest.registration)await io.writeFile(path.join(backup,'banner_icons.xml'),await io.readFile(p.registry),{flag:'wx'});
    for(const record of records){
      record.original=await read(record.target);if((record.original===null?null:sha(record.original))!==record.expected)throw new Error('Atlas or thumbnail changed since review: '+record.target);
      if(record.original!==null){await io.mkdir(path.dirname(record.backup),{recursive:true});await io.writeFile(record.backup,record.original,{flag:'wx'});if(sha(await io.readFile(record.backup))!==record.expected)throw new Error('Backup verification failed.');}
      await io.mkdir(path.dirname(record.target),{recursive:true});record.temp=record.target+'.'+randomUUID()+'.tmp';await io.copyFile(record.source,record.temp,fs.constants.COPYFILE_EXCL);
      if(sha(await io.readFile(record.temp))!==record.hash)throw new Error('Staged file copy failed verification.');
    }
    for(const record of records){const current=await read(record.target);if((current===null?null:sha(current))!==record.expected)throw new Error('Atlas or thumbnail changed while installing.');}
    if(sha(await io.readFile(p.registry))!==manifest.snapshot.xml)throw new Error('The registry changed while installing.');
    for(const record of records){const current=await read(record.target);if((current===null?null:sha(current))!==record.expected)throw new Error('Target changed while installing.');await io.rename(record.temp,record.target);committed.push(record);if(sha(await io.readFile(record.target))!==record.hash)throw new Error('Installed file failed verification.');}
    if(sha(await io.readFile(p.registry))!==(manifest.registration?.hash||manifest.snapshot.xml))throw new Error('The registry changed during installation.');
    if(sourceChanged)await io.utimes(target,new Date(),new Date());manifest.status='installed';manifest.installedAt=new Date().toISOString();manifest.backupDirectory=backup;await io.writeFile(manifestFile,JSON.stringify(manifest,null,2));return manifest;
  }catch(error){
    const failures=[];for(const record of committed.reverse()){
      try{if(sha(await io.readFile(record.target))!==record.hash)throw new Error('A newer edit exists: '+record.target);if(record.original===null)await io.unlink(record.target);else {const temp=record.target+'.rollback-'+randomUUID()+'.tmp';try{await io.writeFile(temp,record.original,{flag:'wx'});await io.rename(temp,record.target);}finally{await io.unlink(temp).catch(()=>{});}}}catch(e){failures.push(e.message);}
    }
    if(committed.length){manifest.status='failed';manifest.error=error.message;await io.writeFile(manifestFile,JSON.stringify(manifest,null,2)).catch(()=>{});}
    if(failures.length)throw new Error('Atlas update failed; restore from '+backup+'. '+failures.join(' '));throw error;
  }finally{for(const record of records)if(record.temp)await io.unlink(record.temp).catch(()=>{});if(registryHandle){await registryHandle.close();await io.unlink(registryLock);}await handle.close();await io.unlink(lock);}
}
