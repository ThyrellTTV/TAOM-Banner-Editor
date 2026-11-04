import fs from 'node:fs/promises';
import path from 'node:path';
import {setImmediate} from 'node:timers/promises';
import sharp from 'sharp';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {configPaths,workspaceIdentity} from './configuration.mjs';
import {decode} from './public/banner-code.mjs';
import {walk} from './library.mjs';
import {atlasSourceFile,sourceDimensions,extractCell,maskBounds} from './atlas-manager.mjs';

const array=x=>x==null?[]:Array.isArray(x)?x:[x];
const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'',processEntities:false});
export async function validateAssets({config,root,library,assets}){
  const p=configPaths(config,root),issues=[],checked={banners:library.banners.length,symbols:library.icons.length,atlases:0,thumbnails:0,definitionFiles:0};
  const add=(severity,code,message,context={})=>issues.push({id:issues.length+1,severity,code,message,...context});
  const registries={};
  for(const [name,file] of [['Native',p.nativeRegistry],['Module',p.registry]]){
    const xml=await fs.readFile(file,'utf8');if(XMLValidator.validate(xml)!==true){add('error','invalid-xml',name+' banner registry is not valid XML.',{source:file});continue;}
    const doc=parser.parse(xml).base?.BannerIconData;if(!doc){add('error','missing-registry',name+' registry has no BannerIconData.',{source:file});continue;}
    const ids=new Set(),groups=new Set(),icons=[],colors=new Set();
    for(const group of array(doc.BannerIconGroup)){
      if(groups.has(String(group.id)))add('error','duplicate-group','Duplicate '+name+' group ID '+group.id+'.',{source:file});groups.add(String(group.id));
      for(const item of [...array(group.Icon),...array(group.Background)]){
        const id=Number(item.id);if(!Number.isSafeInteger(id)||id<0)add('error','invalid-id','Invalid '+name+' symbol/background ID '+item.id+'.',{source:file});
        if(ids.has(id))add('error','duplicate-id','Duplicate '+name+' symbol/background ID '+id+'.',{iconId:id,material:item.material_name,source:file});ids.add(id);
        if(item.material_name!==undefined){const slot=Number(item.texture_index);icons.push({id,slot,material:item.material_name});if(!Number.isInteger(slot)||slot<0||slot>15)add('error','invalid-slot','Icon #'+id+' has an invalid 4×4 texture index.',{iconId:id,material:item.material_name,source:file});}
      }
    }
    for(const color of array(doc.BannerColors?.Color)){const id=Number(color.id);if(colors.has(id))add('error','duplicate-color','Duplicate '+name+' colour ID '+id+'.',{source:file});colors.add(id);}
    registries[name]={ids,icons,colors};
  }
  for(const icon of registries.Module?.icons||[])if(registries.Native?.ids.has(icon.id))add('info','native-override','Module icon #'+icon.id+' overrides a Native ID.',{iconId:icon.id,material:icon.material});
  const backgroundIds=new Set(library.backgrounds.map(i=>i.id)),iconIds=new Set(library.icons.map(i=>i.id)),colorIds=new Set(library.colors.map(i=>i.id)),missing=new Map();
  for(const banner of library.banners)for(const [index,layer] of decode(banner.code).entries()){
    const references=[...(!(index?iconIds:backgroundIds).has(layer.meshId)?[[index?'undefined-symbol':'undefined-background',layer.meshId]]:[]),...[layer.colorId,layer.colorId2].filter(id=>!colorIds.has(id)).map(id=>['undefined-color',id])];
    for(const [code,id] of references){const key=code+':'+id;if(!missing.has(key))missing.set(key,{code,id,banners:new Map()});missing.get(key).banners.set(banner.key,banner);}
  }
  for(const {code,id,banners} of missing.values()){const affected=[...banners.values()];add('error',code,(code==='undefined-color'?'Colour':code==='undefined-background'?'Background':'Symbol')+' #'+id+' is undefined; referenced by '+affected.length+' banner(s).',{referenceId:id,bannerKey:affected[0].key,banners:affected.map(b=>({key:b.key,name:b.name,source:b.source})),source:affected[0].source});}
  const definitions=new Set();for(const file of p.definitions){const stat=await fs.stat(file);for(const item of stat.isDirectory()?await walk(file):[file])definitions.add(item);}
  for(const file of definitions){
    const xml=await fs.readFile(file,'utf8');checked.definitionFiles++;
    if(XMLValidator.validate(xml)!==true){add('error','invalid-definition-xml','Banner definition XML/XSLT is invalid.',{source:path.relative(config.modulePath,file)});continue;}
    const values=[...xml.matchAll(/\b(?:banner_key|faction_banner_key)\s*=\s*(["'])(.*?)\1/gs)].map(m=>m[2]);
    for(const match of xml.matchAll(/<xsl:attribute\b[^>]*\bname=["'](?:banner_key|faction_banner_key)["'][^>]*>([\s\S]*?)<\/xsl:attribute>/g))if(!match[1].includes('<'))values.push(match[1].trim());
    for(const value of values)try{decode(value);}catch{add('error','invalid-banner-code','A banner code cannot be parsed.',{source:path.relative(config.modulePath,file),value:value.slice(0,100)});}
  }
  const moduleIcons=registries.Module?.icons||[],materials=new Map();
  for(const icon of moduleIcons){if(!materials.has(icon.material))materials.set(icon.material,[]);materials.get(icon.material).push(icon);}
  for(const [material,icons] of materials){
    checked.atlases++;if(!/^[-a-z0-9_]{1,160}$/i.test(material)){add('error','invalid-material-name','Material name cannot map to a local PSD.',{material});continue;}
    const source=await atlasSourceFile(p.atlasSources,material);let dimensions=null;
    if(!source)add('warning','missing-atlas-source','Source PSD/PNG is missing. Compiled artwork may still preview, but this atlas cannot be edited.',{material});
    else try{dimensions=await sourceDimensions(source);if(dimensions.width!==dimensions.height||dimensions.width%4)add('error','invalid-atlas-size','Source image is not a square 4×4 atlas.',{material,source});else if(dimensions.width!==2048)add('info','legacy-atlas-size','Existing atlas uses '+dimensions.width+'×'+dimensions.height+'; editing preserves this resolution.',{material,source});if(dimensions.depth!==8)add('warning','source-depth','Atlas source is not 8-bit; manager editing may be unavailable.',{material,source});}
    catch(error){add('error','unreadable-atlas-source','Cannot read atlas source: '+error.message,{material,source});}
    const binding=assets.materials[material],texture=assets.textures[binding?.slots?.['0']];
    if(!binding)add('error','missing-material','Registered material is unavailable to the editor.',{material});
    if(!texture?.images?.length){add('error','missing-texture','No readable texture or PSD/PNG source exists for this material.',{material});continue;}
    if(texture.source)add('info','source-preview','Preview uses the PSD/PNG source; game compilation is a separate deployment step.',{material});
    const image=texture.images[0];if(!/^\/cache\/textures\/[^/\\]+\.png$/i.test(image)){add('error','invalid-texture-path','Texture cache path is invalid.',{material});continue;}
    try{
      const {data,info}=await sharp(path.join(p.data,image.slice(1))).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      if(info.width!==info.height||info.width%4){add('error','invalid-texture-grid','Texture does not have a square 4×4 layout.',{material});continue;}
      const slots=new Map();for(const icon of icons){if(!Number.isInteger(icon.slot)||icon.slot<0||icon.slot>15)continue;if(!slots.has(icon.slot))slots.set(icon.slot,[]);slots.get(icon.slot).push(icon.id);}
      for(const [slot,ids] of slots){
        if(ids.length>1)add('warning','shared-slot','Several IDs use the same atlas slot: '+ids.join(', ')+'. Changes will affect all of them.',{material,slot,iconId:ids[0]});
        const size=info.width/4,cell=extractCell(data,info.width,slot),bounds=maskBounds(cell,size,size);
        if(!bounds)add('error','empty-slot','Registered slot '+slot+' contains no fill/outline artwork.',{material,slot,iconId:ids[0]});
        else {const dx=bounds.left+bounds.width/2-size/2,dy=bounds.top+bounds.height/2-size/2;if(dx||dy)add('warning','off-center','Slot '+slot+' artwork is off centre by '+dx+' px horizontally and '+dy+' px vertically.',{material,slot,iconId:ids[0],offset:{x:dx,y:dy}});}
      }
    }catch(error){add('error','unreadable-texture','Could not inspect atlas pixels: '+error.message,{material});}
    await setImmediate();
  }
  for(const icon of moduleIcons){
    if(!Number.isSafeInteger(icon.id)||icon.id<0)continue;checked.thumbnails++;const file=path.join(p.thumbnails,icon.id+'.png');
    try{const bytes=await fs.readFile(file),stats=await sharp(bytes).stats(),meta=await sharp(bytes).metadata();if(!meta.hasAlpha||stats.isOpaque)add('warning','opaque-thumbnail','GUI thumbnail #'+icon.id+' has no transparent background.',{iconId:icon.id,material:icon.material,slot:icon.slot,source:file});}
    catch(error){add('warning',error.code==='ENOENT'?'missing-thumbnail':'unreadable-thumbnail','GUI thumbnail #'+icon.id+' is missing or unreadable.',{iconId:icon.id,material:icon.material,slot:icon.slot,source:file});}
  }
  const registeredMaterials=new Set(materials.keys()),moduleIds=new Set(moduleIcons.map(i=>String(i.id)));
  for(const file of await fs.readdir(p.atlasSources).catch(error=>{if(error.code==='ENOENT')return [];throw error;}))if((/\.psd$/i.test(file)||file.startsWith(config.atlasPrefix+'_')&&/\.png$/i.test(file)&&!/(?:\.mask|\.preview)\.png$/i.test(file))&&!registeredMaterials.has(file.slice(0,-4)))add('warning','unregistered-atlas','Atlas source has no entry in the selected module registry: '+file,{material:file.slice(0,-4),source:path.join(p.atlasSources,file)});
  for(const file of await fs.readdir(p.thumbnails).catch(error=>{if(error.code==='ENOENT')return [];throw error;}))if(/^\d+\.png$/i.test(file)&&!moduleIds.has(file.slice(0,-4))&&!registries.Native?.ids.has(Number(file.slice(0,-4))))add('warning','orphan-thumbnail','GUI thumbnail has no registered ID: '+file,{source:path.join(p.thumbnails,file)});
  for(const message of assets.errors||[])add('warning','extraction-warning',message);
  const rank={error:0,warning:1,info:2};issues.sort((a,b)=>rank[a.severity]-rank[b.severity]||a.code.localeCompare(b.code));
  return {version:1,checkedAt:new Date().toISOString(),workspaceId:workspaceIdentity(config),moduleName:config.moduleName,modulePath:config.modulePath,checked,counts:{errors:issues.filter(i=>i.severity==='error').length,warnings:issues.filter(i=>i.severity==='warning').length,info:issues.filter(i=>i.severity==='info').length},issues};
}
