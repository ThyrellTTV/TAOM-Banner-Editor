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

export const groupDisplayName=name=>String(name??'').replace(/^\{[^}]*\}/,'').trim();
const groupSlug=name=>String(name).replaceAll('æ','ae').replaceAll('Æ','ae').replaceAll('þ','th').replaceAll('Þ','th').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,50);
const normalName=name=>String(name??'').trim().replace(/\s+/g,' ');
// Symbol categories offered in pickers: every non-pattern group (empty ones included), never background groups.
export function iconGroupOptions(registry){
  return registry.groups.filter(g=>g.is_pattern!=='true'&&!list(g.Background).length&&Number.isSafeInteger(Number(g.id))).map(g=>({id:Number(g.id),name:groupDisplayName(g.name)||String(g.id),title:String(g.name??''),icons:list(g.Icon).length}));
}
async function reservedIds({registry,modulePath,gamePath,nativeRegistryFile,thumbnailDirectory}){
  const icons=new Set(),groups=new Set();
  const reserve=items=>{for(const group of items){const gid=Number(group.id);if(Number.isSafeInteger(gid))groups.add(gid);for(const item of [...list(group.Icon),...list(group.Background)]){const id=Number(item.id);if(Number.isSafeInteger(id)&&id>=0)icons.add(id);}}};
  reserve(registry.groups);
  if(gamePath){const xml=await fs.readFile(path.resolve(gamePath,nativeRegistryFile),'utf8');if(XMLValidator.validate(xml)!==true)throw new Error('Native banner registry is invalid.');reserve(list(parser.parse(xml).base?.BannerIconData?.BannerIconGroup));}
  for(const file of await fs.readdir(path.resolve(modulePath,thumbnailDirectory||'GUI/SpriteParts/ui_taom_bannericons')).catch(error=>{if(error.code==='ENOENT')return [];throw error;}))if(/^\d+\.png$/i.test(file)){const id=Number(file.slice(0,-4));if(Number.isSafeInteger(id)&&id>=0&&id<=2_147_483_647)icons.add(id);}
  return {icons,groups};
}
const nextIconId=used=>[...used].reduce((max,id)=>Math.max(max,id),9999)+1;
// New groups get the next free multiple of 10 above the highest group ID (Native included) unless an ID is given.
// Names use the module's translatable form {=<module>_banner_category_<slug>}Name; translation files are not touched.
function planNewGroups(requests,registry,usedGroups,keyPrefix){
  const names=new Set(registry.groups.map(g=>groupDisplayName(g.name).toLowerCase())),keys=new Set(registry.groups.map(g=>String(g.name??'').match(/^\{=([^}]*)\}/)?.[1]).filter(Boolean)),planned=[];
  const prefix=(groupSlug(keyPrefix||'module')||'module')+'_banner_category_';
  for(const request of requests){
    const name=normalName(request?.name);
    if(!name||name.length>80||/[{}\u0000-\u001f]/.test(name))throw new Error('Name the new icon group (1–80 characters, no braces).');
    if(names.has(name.toLowerCase()))throw new Error('An icon group named "'+name+'" already exists. Choose it from the list instead.');
    names.add(name.toLowerCase());
    let id=request.id==null||request.id===''?null:Number(request.id);
    if(id===null){id=Math.floor([...usedGroups].reduce((max,g)=>Math.max(max,g),0)/10)*10+10;while(usedGroups.has(id))id+=10;}
    if(!Number.isSafeInteger(id)||id<1||id>2_147_483_647||usedGroups.has(id))throw new Error('Icon group ID '+request.id+' is already used or invalid.');
    usedGroups.add(id);
    const slug=groupSlug(name)||'group';let key=prefix+slug;for(let n=2;keys.has(key);n++)key=prefix+slug+'_'+n;keys.add(key);
    planned.push({id,name,title:'{='+key+'}'+name});
  }
  return planned;
}
const GROUP_BLOCK=/<BannerIconGroup\b[^>]*?\/>|<BannerIconGroup\b[^>]*>[\s\S]*?<\/BannerIconGroup\s*>/g;
const attribute=(tag,name)=>tag.match(new RegExp('\\b'+name+'\\s*=\\s*(["\'])(.*?)\\1'))?.[2];
// Edit banner_icons.xml textually so comments, ordering and formatting elsewhere stay byte-identical.
// remove: icon IDs to cut (moved elements keep their exact text), append: groupId → items, create: new groups with items.
// An item is either an element string or {moved:id}.
function rewriteRegistry(xml,{remove=new Set(),append=new Map(),create=[]}){
  const newline=xml.includes('\r\n')?'\r\n':'\n',removed=new Map(),appended=new Set();
  let changed=remove.size?xml.replace(GROUP_BLOCK,block=>block.replace(/<!--[\s\S]*?-->|[\t ]*<Icon\b[^>]*?\/>[\t ]*(?:\r?\n)?/g,match=>{
    if(match.startsWith('<!--'))return match;const id=Number(attribute(match,'id'));if(!remove.has(id))return match;
    if(removed.has(id))throw new Error('Icon ID '+id+' is registered twice. Repair banner_icons.xml first.');removed.set(id,match.trim());return '';
  })):xml;
  for(const id of remove)if(!removed.has(id))throw new Error('Icon ID '+id+' was not found in banner_icons.xml.');
  const groupIndent=xml.match(/(?:^|\n)([\t ]*)<BannerIconGroup\b/)?.[1]??'    ',iconIndent=xml.match(/(?:^|\n)([\t ]*)<Icon\b/)?.[1]??groupIndent+'  ';
  const lines=items=>items.map(item=>typeof item==='string'?item:removed.get(item.moved));
  if(append.size)changed=changed.replace(GROUP_BLOCK,block=>{
    const opening=block.slice(0,block.indexOf('>')+1),id=Number(attribute(opening,'id'));if(!append.has(id))return block;
    if(appended.has(id))throw new Error('Duplicate target group ID '+id+'.');appended.add(id);
    if(block.endsWith('/>'))return block.slice(0,-2).trimEnd()+'>'+newline+lines(append.get(id)).map(l=>iconIndent+l).join(newline)+newline+groupIndent+'</BannerIconGroup>';
    const close=block.match(/([\t ]*)(<\/BannerIconGroup\s*>)$/),prefix=block.slice(0,close.index),indent=block.match(/(?:^|\n)([\t ]*)<Icon\b/)?.[1]??(close[1]?close[1]+'  ':iconIndent);
    return prefix+(prefix.endsWith('\n')?'':newline)+lines(append.get(id)).map(l=>indent+l).join(newline)+newline+close[1]+close[2];
  });
  for(const id of append.keys())if(!appended.has(id))throw new Error('Icon group '+id+' was not found in banner_icons.xml.');
  if(create.length){
    const snippet=create.map(group=>[groupIndent+'<BannerIconGroup id="'+group.id+'" name="'+escape(group.title)+'" is_pattern="false">',...lines(group.items).map(l=>iconIndent+l),groupIndent+'</BannerIconGroup>'].join(newline)).join(newline+newline);
    const last=[...changed.matchAll(GROUP_BLOCK)].at(-1);
    if(last){const at=last.index+last[0].length;changed=changed.slice(0,at)+newline+newline+snippet+changed.slice(at);}
    else{const marker=/<BannerColors\b/.test(changed)?/[\t ]*<BannerColors\b/:/[\t ]*<\/BannerIconData\s*>/;if(!marker.test(changed))throw new Error('Cannot find the insertion point in banner_icons.xml.');changed=changed.replace(marker,match=>snippet+newline+newline+match);}
  }
  if(XMLValidator.validate(changed)!==true)throw new Error('Generated banner icon registration is not valid XML.');
  return changed;
}
// Re-read the rewritten XML: every listed icon sits in its intended group and no other icon moved or disappeared.
function verifyMembership(before,changed,expected){
  const parsed=list(parser.parse(changed).base?.BannerIconData?.BannerIconGroup),after=new Map(),count=groups=>groups.reduce((n,g)=>n+list(g.Icon).length,0),existing=new Set();
  for(const group of parsed)for(const icon of list(group.Icon))after.set(Number(icon.id),Number(group.id));
  for(const group of before)for(const icon of list(group.Icon)){const id=Number(icon.id);existing.add(id);if(!expected.has(id)&&after.get(id)!==Number(group.id))throw new Error('Registry rewrite moved icon '+id+' unexpectedly.');}
  for(const [id,group] of expected)if(after.get(id)!==group)throw new Error('Registry rewrite did not place icon '+id+' in group '+group+'.');
  if(count(parsed)!==count(before)+[...expected.keys()].filter(id=>!existing.has(id)).length)throw new Error('Registry rewrite changed the number of icons unexpectedly.');
}

// Atlas manager registry edits for one material, without renumbering any existing entry:
// additions fill unused cells with new IDs, moves put a slot's registered IDs into another symbol category,
// newGroups create categories that additions/moves reference by name ({newGroup:'Name'} instead of groupId).
// Explicit IDs (additions[].id, newGroups[].id) are used when verifying an already-built review.
export async function planSlotRegistration({modulePath,gamePath,material,additions=[],moves=[],newGroups=[],registryFile,nativeRegistryFile='Modules/Native/ModuleData/banner_icons.xml',thumbnailDirectory,keyPrefix}){
  if(!/^[-a-z0-9_]{1,160}$/i.test(material)||!Array.isArray(additions)||!Array.isArray(moves)||!Array.isArray(newGroups)||!additions.length&&!moves.length||additions.length>16||moves.length>16||newGroups.length>32)throw new Error('Invalid new atlas slots.');
  const registry=await readIconRegistry(modulePath,registryFile),{icons:used,groups:usedGroups}=await reservedIds({registry,modulePath,gamePath,nativeRegistryFile,thumbnailDirectory}),occupied=new Map();
  for(const group of registry.groups)for(const icon of list(group.Icon))if(icon.material_name===material){const slot=Number(icon.texture_index);if(!occupied.has(slot))occupied.set(slot,[]);occupied.get(slot).push({id:Number(icon.id),group:Number(group.id)});}
  const created=planNewGroups(newGroups,registry,usedGroups,keyPrefix),byName=new Map(created.map(g=>[g.name.toLowerCase(),g.id])),referenced=new Set();
  const validGroups=new Set([...iconGroupOptions(registry).map(g=>g.id),...created.map(g=>g.id)]);
  const target=item=>{const id=item.newGroup!=null?byName.get(normalName(item.newGroup).toLowerCase()):item.groupId;if(!Number.isSafeInteger(id)||!validGroups.has(id))throw new Error('Choose an existing symbol category for the new icon, or name a new one.');referenced.add(id);return id;};
  const planned=[],plannedMoves=[],append=new Map(),remove=new Set(),expected=new Map(),slots=new Set();
  const add=(groupId,item)=>{if(!append.has(groupId))append.set(groupId,[]);append.get(groupId).push(item);};
  let next=nextIconId(used);
  for(const move of moves){
    const slot=move.slot,groupId=target(move);
    if(!Number.isInteger(slot)||!occupied.has(slot)||slots.has(slot))throw new Error('Atlas slot '+slot+' has no registered icon to move, or is listed twice.');slots.add(slot);
    const moving=occupied.get(slot).filter(icon=>icon.group!==groupId);if(!moving.length)continue;
    for(const icon of moving){remove.add(icon.id);expected.set(icon.id,groupId);add(groupId,{moved:icon.id});}
    plannedMoves.push({slot,groupId,ids:moving.map(i=>i.id),from:[...new Set(moving.map(i=>i.group))]});
  }
  for(const addition of additions){
    const slot=addition.slot,groupId=target(addition);
    if(!Number.isInteger(slot)||slot<0||slot>15||occupied.has(slot)||slots.has(slot))throw new Error('Atlas slot '+slot+' is already registered or invalid.');
    const id=addition.id??next;
    if(!Number.isSafeInteger(id)||id<0||id>2_147_483_647||used.has(id))throw new Error('New icon ID '+id+' is unavailable. Rebuild the review.');
    used.add(id);slots.add(slot);next=Math.max(next,id+1);planned.push({id,slot,groupId});expected.set(id,groupId);
    add(groupId,'<Icon id="'+id+'" material_name="'+escape(material)+'" texture_index="'+slot+'" />');
  }
  if(created.some(g=>!referenced.has(g.id)))throw new Error('A new icon group is not used by any slot.');
  const create=created.filter(g=>append.has(g.id)).map(g=>({...g,items:append.get(g.id)}));for(const g of created)append.delete(g.id);
  if(!create.length&&!append.size)return {...registry,changed:Buffer.from(registry.original),additions:planned,moves:plannedMoves,newGroups:[]};
  const changed=rewriteRegistry(registry.xml,{remove,append,create});
  verifyMembership(registry.groups,changed,expected);
  return {...registry,changed:Buffer.from(changed),additions:planned,moves:plannedMoves,newGroups:create.map(({id,name,title})=>({id,name,title}))};
}

// New atlas pages registered into one symbol category: an existing group ({id}) or a new one ({name, id?}).
// Icon IDs continue after the highest ID in use (module, Native, orphan thumbnails); nothing is renumbered.
async function planGroupedAtlasRegistration({modulePath,gamePath,atlases,registry,nativeRegistryFile,thumbnailDirectory:thumbnailFolder,group,keyPrefix}){
  const {xmlPath,original,xml,groups}=registry,{icons:used,groups:usedGroups}=await reservedIds({registry,modulePath,gamePath,nativeRegistryFile,thumbnailDirectory:thumbnailFolder});
  const created=normalName(group.name)?planNewGroups([{name:group.name,id:group.id}],registry,usedGroups,keyPrefix):[];
  const target=created[0]||iconGroupOptions(registry).find(g=>g.id===Number(group.id));
  if(!target)throw new Error('Choose an existing icon group or name a new one.');
  const materialNames=new Set(registry.materials),planned=[],items=[],expected=new Map();let next=nextIconId(used);
  for(const atlas of atlases){
    if(materialNames.has(atlas.name))throw new Error('Material is already registered: '+atlas.name);
    if(!/^[a-z][a-z0-9_]+$/.test(atlas.name))throw new Error('Invalid atlas material: '+atlas.name);
    materialNames.add(atlas.name);
    const icons=Array.from({length:atlas.count},(_,textureIndex)=>{while(used.has(next))next++;const id=next++;used.add(id);expected.set(id,target.id);return {id,textureIndex};});
    if(icons.some(i=>i.id>2_147_483_647))throw new Error('No safe icon ID range is available.');
    items.push(...icons.map(icon=>'<Icon id="'+icon.id+'" material_name="'+atlas.name+'" texture_index="'+icon.textureIndex+'" />'));
    planned.push({name:atlas.name,groupId:target.id,title:target.title,icons});
  }
  const changed=rewriteRegistry(xml,created.length?{create:[{...created[0],items}]}:{append:new Map([[target.id,items]])});
  verifyMembership(groups,changed,expected);
  const newline=xml.includes('\r\n')?'\r\n':'\n',snippet='<!-- '+(created.length?'New icon group ':'Appended to icon group ')+target.id+' · '+escape(target.name)+' -->'+newline+items.join(newline)+newline;
  return {xmlPath,registryRelative:path.relative(modulePath,xmlPath),original,changed:Buffer.from(changed),snippet,thumbnailDirectory:path.resolve(modulePath,thumbnailFolder||'GUI/SpriteParts/ui_taom_bannericons'),atlases:planned,group:{id:target.id,name:target.name,title:target.title,created:!!created.length}};
}

// Without `group`, each new atlas gets its own "<label> <Faction> Alpha NN" group (legacy layout).
export async function planAtlasRegistration({modulePath,gamePath,atlases,registry,registryFile,nativeRegistryFile='Modules/Native/ModuleData/banner_icons.xml',thumbnailDirectory:thumbnailFolder,atlasPrefix='taom_banners',groupLabel='TAOM',group}){
  registry??=await readIconRegistry(modulePath,registryFile);
  if(group!=null)return planGroupedAtlasRegistration({modulePath,gamePath,atlases,registry,nativeRegistryFile,thumbnailDirectory:thumbnailFolder,group,keyPrefix:groupLabel});
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
