// Headless helpers for Claude-driven banner design and alpha import.
// Everything here either reads the module, writes review material under
// <data>/banner-ai, writes editor drafts, or stages/installs atlas edits through
// the same reviewed atlas-manager transaction the editor uses.
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {XMLParser} from 'fast-xml-parser';
import {readConfig,validateConfig,configPaths,workspaceSignature} from './configuration.mjs';
import {loadLibrary,displayName} from './library.mjs';
import {prepareSourceTextures} from './prepare-assets.mjs';
import {atlasCatalog,atlasDetails,stageAtlasEdit,installAtlasEdit,managedDirectory} from './atlas-manager.mjs';
import {buildAtlases,preparePng} from './atlas-builder.mjs';
import {decode} from './public/banner-code.mjs';
import {createBannerRenderer,tint} from './node-renderer.mjs';

export const slugify=value=>String(value||'').toLowerCase().replace(/æ/g,'ae').replace(/œ/g,'oe').replace(/þ/g,'th').replace(/ð/g,'d').replace(/ø/g,'o').replace(/ß/g,'ss').normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60)||'item';
const stamp=(date=new Date())=>date.toISOString().replace(/[-:T]/g,'').slice(0,14);
const xml=value=>String(value).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
const readJson=(file,fallback)=>fs.readFile(file,'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return fallback;throw error;});
const writeJson=async(file,value)=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(value,null,2)+'\n');};

// ---------- workspace ----------
export async function loadWorkspace(root,{configFile,quiet=true}={}){
  const {config,error}=await readConfig(root,configFile||process.env.BANNER_STUDIO_CONFIG||path.join(root,'config.json'));
  if(error)throw new Error(error);
  await validateConfig(config,root);
  const paths=configPaths(config,root),dataRoot=paths.data,cacheFile=path.join(dataRoot,'cache','assets.json');
  const cached=await readJson(cacheFile,null);
  if(!cached)throw new Error('No extracted asset cache at '+cacheFile+'. Open the editor once so it extracts game assets.');
  const warnings=[];
  const stampFile=await readJson(path.join(dataRoot,'cache','workspace.json'),null);
  if(stampFile?.signature!==workspaceSignature(config))warnings.push('Asset cache was extracted for different settings; open the editor to refresh it.');
  const library=await loadLibrary(config.modulePath,config.gamePath,config);
  const log=console.log;if(quiet)console.log=()=>{};
  let assets;try{assets=await prepareSourceTextures(dataRoot,cached,config.modulePath,library.icons,config);}finally{console.log=log;}
  const ai=path.join(dataRoot,'banner-ai');
  const nativeClans=await readNativeClans(config.gamePath);
  return {root,config,paths,dataRoot,ai,library,assets,warnings,nativeClans,renderer:createBannerRenderer({library,assets,dataRoot})};
}
// XSLT patches of SandBox clans usually only override name/banner; kingdom and
// culture stay in the native definition.
export async function readNativeClans(gamePath,files=['Modules/SandBox/ModuleData/spclans.xml']){
  const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:''}),clans=new Map();
  for(const file of files){
    const text=await fs.readFile(path.resolve(gamePath,file),'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(!text)continue;
    const factions=parser.parse(text)?.Factions?.Faction;for(const f of Array.isArray(factions)?factions:factions?[factions]:[])if(f.id)clans.set(f.id,{superFaction:f.super_faction||'',culture:f.culture||''});
  }
  return clans;
}

// ---------- factions ----------
const kingdomId=value=>String(value||'').replace(/^Kingdom\./,'');
const preferEntry=entries=>entries.find(e=>e.attribute==='banner_key'&&e.format!=='xslt-attribute')||entries.find(e=>e.attribute==='banner_key')||entries[0];
function byId(banners,kind){const map=new Map();for(const b of banners.filter(b=>b.kind===kind)){if(!map.has(b.id))map.set(b.id,[]);map.get(b.id).push(b);}return map;}
export async function readFactionMap(ws){return readJson(path.join(ws.ai,'faction-map.json'),{version:1,kingdoms:{}});}
export function factionModel(library,factionMap={kingdoms:{}},nativeClans=new Map()){
  const clans=byId(library.banners,'Clan'),kingdoms=byId(library.banners,'Kingdom'),icons=new Map(library.icons.map(i=>[i.id,i])),groups=new Map(library.groups.map(g=>[g.id,g]));
  const model=new Map();
  for(const [id,entries] of kingdoms){const entry=preferEntry(entries);model.set(id,{id,name:entry.name,culture:entry.culture,entry,clans:[],groups:[],override:factionMap.kingdoms?.[id]||null});}
  const kingdomOf=new Map();
  for(const [id,entries] of clans){
    const entry=preferEntry(entries),native=nativeClans.get(id),explicit=entries.map(e=>kingdomId(e.superFaction)).find(Boolean);
    let kingdom=explicit&&model.has(explicit)?explicit:null,via=kingdom?'super_faction':null;
    if(!kingdom&&model.has(kingdomId(native?.superFaction))){kingdom=kingdomId(native.superFaction);via='native super_faction';}
    if(!kingdom){const culture=entries.map(e=>e.culture).find(Boolean)||native?.culture;const match=culture&&[...model.values()].filter(k=>k.culture===culture);if(match?.length===1){kingdom=match[0].id;via='culture';}}
    kingdomOf.set(id,{kingdom,via,entry,entries});if(kingdom)model.get(kingdom).clans.push({id,name:entry.name,via,entry});
  }
  for(const k of model.values()){
    const counts=new Map();
    for(const banner of [k.entry,...k.clans.map(c=>c.entry)])for(const layer of decode(banner.code).slice(1)){
      const icon=icons.get(layer.meshId);if(!icon)continue;const item=counts.get(icon.group)||{id:icon.group,name:groups.get(icon.group)?.name||String(icon.group),source:icon.source,uses:0,banners:new Set()};
      item.uses++;item.banners.add(banner.id);counts.set(icon.group,item);
    }
    const listed=[...counts.values()].map(g=>({...g,banners:g.banners.size,origin:'usage'}));
    for(const id of k.override?.groups||[])if(!listed.some(g=>g.id===id))listed.push({id,name:groups.get(id)?.name||String(id),source:groups.get(id)?.source||'?',uses:0,banners:0,origin:'override'});
    const excluded=new Set(k.override?.excludeGroups||[]);
    k.groups=listed.filter(g=>!excluded.has(g.id)).sort((a,b)=>(a.origin==='override')-(b.origin==='override')||b.banners-a.banners||b.uses-a.uses);
  }
  return {kingdoms:model,clanIndex:kingdomOf};
}
export function findClan(library,query){
  const q=String(query||'').trim().toLowerCase(),clans=library.banners.filter(b=>b.kind==='Clan');
  // "kingdom:<id>" targets a kingdom's own banner_key instead of a clan.
  const kingdom=q.match(/^kingdom:(.+)$/);
  if(kingdom){const hits=library.banners.filter(b=>b.kind==='Kingdom'&&b.id.toLowerCase()===kingdom[1]);if(!hits.length)throw new Error('No kingdom banner "'+kingdom[1]+'".');return hits;}
  const exact=clans.filter(b=>b.id.toLowerCase()===q||b.key.toLowerCase()===q);
  const hits=exact.length?exact:clans.filter(b=>b.name.toLowerCase()===q).length?clans.filter(b=>b.name.toLowerCase()===q):clans.filter(b=>b.name.toLowerCase().includes(q)||b.id.toLowerCase().includes(q));
  const ids=[...new Set(hits.map(b=>b.id))];
  if(!ids.length)throw new Error('No clan matches "'+query+'".');
  if(ids.length>1)throw new Error('Several clans match "'+query+'": '+ids.slice(0,20).map(id=>id+' ('+hits.find(h=>h.id===id).name+')').join(', ')+(ids.length>20?' …':''));
  return hits.filter(b=>b.id===ids[0]);
}

// ---------- colours ----------
const toLinear=c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;};
export function hexToLab(hex){
  const [r,g,b]=[1,3,5].map(i=>toLinear(parseInt(hex.replace('#','').padStart(6,'0').slice(i-1,i+1),16)));
  const xyz=[(r*.4124+g*.3576+b*.1805)/.95047,(r*.2126+g*.7152+b*.0722),(r*.0193+g*.1192+b*.9505)/1.08883].map(t=>t>.008856?Math.cbrt(t):7.787*t+16/116);
  return [116*xyz[1]-16,500*(xyz[0]-xyz[1]),200*(xyz[1]-xyz[2])];
}
export const deltaE=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
export function nearestColors(library,hex,{count=5,sigil=false,background=false,module=false}={}){
  const target=hexToLab(hex);
  return library.colors.filter(c=>(!sigil||c.forSigil)&&(!background||c.forBackground)&&(!module||c.source==='Module')).map(c=>({...c,deltaE:+deltaE(target,hexToLab(c.hex)).toFixed(2)})).sort((a,b)=>a.deltaE-b.deltaE).slice(0,count);
}
function colourUsage(library,banners){
  const colors=new Map(library.colors.map(c=>[c.id,c])),bg=new Map(),sigil=new Map();
  for(const banner of banners)for(const [i,l] of decode(banner.code).entries())for(const id of i?[l.colorId,...(l.stroke?[l.colorId2]:[])]:[l.colorId,l.colorId2]){const m=i?sigil:bg;m.set(id,(m.get(id)||0)+1);}
  const list=m=>[...m].sort((a,b)=>b[1]-a[1]).map(([id,uses])=>({id,hex:colors.get(id)?.hex||'?',uses}));
  return {background:list(bg),sigil:list(sigil)};
}

// ---------- images ----------
export async function contactSheet(tiles,{columns=6,tile=160,title='',background='#202329'}={}){
  const label=22,head=title?36:0,cols=Math.max(1,Math.min(columns,tiles.length)),rows=Math.ceil(tiles.length/cols),gap=8;
  const width=cols*(tile+gap)+gap,height=head+rows*(tile+label+gap)+gap,parts=[];
  for(const [i,t] of tiles.entries()){
    const left=gap+i%cols*(tile+gap),top=head+gap+Math.floor(i/cols)*(tile+label+gap);
    const input=Buffer.isBuffer(t.image)?await sharp(t.image).resize(tile,tile,{fit:'contain',background:'#00000000'}).png().toBuffer():await sharp(Buffer.from(t.image.data),{raw:{width:t.image.width,height:t.image.height,channels:4}}).resize(tile,tile,{fit:'contain',background:'#00000000'}).png().toBuffer();
    parts.push({input:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${tile}" height="${tile}"><rect width="${tile}" height="${tile}" fill="${t.tileBackground||'#30343c'}"/></svg>`),left,top},{input,left,top});
  }
  const text=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${title?`<text x="${gap}" y="25" fill="#e8d3a6" font-family="Segoe UI, Arial" font-size="20">${xml(title)}</text>`:''}${tiles.map((t,i)=>`<text x="${gap+i%cols*(tile+gap)+tile/2}" y="${head+gap+Math.floor(i/cols)*(tile+label+gap)+tile+16}" fill="#d9dde4" font-family="Consolas, monospace" font-size="13" text-anchor="middle">${xml(String(t.label).slice(0,Math.floor(tile/7.5)))}</text>`).join('')}</svg>`;
  return sharp({create:{width,height,channels:4,background}}).composite([...parts,{input:Buffer.from(text),left:0,top:0}]).png().toBuffer();
}
async function iconSheet(ws,group,options={}){
  const icons=ws.library.icons.filter(i=>i.group===group.id).sort((a,b)=>a.id-b.id),tiles=[];
  for(const icon of icons){try{tiles.push({image:await ws.renderer.iconPreview(icon.id,options.tile||140),label:String(icon.id)});}catch{tiles.push({image:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>'),label:icon.id+' ?'});}}
  return contactSheet(tiles,{columns:8,tile:options.tile||140,title:'Group '+group.id+' · '+group.name+' ('+icons.length+')'});
}
export async function writeIconSheets(ws,groupIds,directory){
  await fs.mkdir(directory,{recursive:true});const out=[];
  for(const id of groupIds){const group=ws.library.groups.find(g=>g.id===id);if(!group)continue;const file=path.join(directory,'icons-'+id+'.png');await fs.writeFile(file,await iconSheet(ws,group));out.push(file);}
  return out;
}
export async function paletteSheet(ws,{sigil=false,background=false,module=false}={}){
  const colors=ws.library.colors.filter(c=>(!sigil||c.forSigil)&&(!background||c.forBackground)&&(!module||c.source==='Module'));
  const tiles=colors.map(c=>({image:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${c.hex}"/></svg>`),label:c.id+(c.forSigil?'s':'')+(c.forBackground?'b':'')}));
  return contactSheet(tiles,{columns:16,tile:64,title:'Palette ('+colors.length+') · s=sigil b=background player-choosable'});
}

// ---------- brief ----------
export async function clanBrief(ws,query,{groupLimit=8}={}){
  const entries=findClan(ws.library,query),factionMap=await readFactionMap(ws),{kingdoms,clanIndex}=factionModel(ws.library,factionMap,ws.nativeClans);
  const info=clanIndex.get(entries[0].id),clan=info.entry,kingdom=info.kingdom?kingdoms.get(info.kingdom):null;
  const icons=new Map(ws.library.icons.map(i=>[i.id,i])),groups=new Map(ws.library.groups.map(g=>[g.id,g])),colors=new Map(ws.library.colors.map(c=>[c.id,c]));
  const describe=code=>decode(code).map((l,i)=>({layer:i,mesh:l.meshId,kind:i?'icon':'background',group:i?icons.get(l.meshId)?.group:null,groupName:i?groups.get(icons.get(l.meshId)?.group)?.name:null,colors:[l.colorId,l.colorId2].map(id=>id+' '+(colors.get(id)?.hex||'?')),size:[l.width,l.height],pos:[l.x,l.y],stroke:l.stroke,mirror:l.mirror,rotation:l.rotation}));
  const directory=path.join(ws.ai,'out',slugify(clan.id));await fs.mkdir(directory,{recursive:true});
  const files={};
  files.current=path.join(directory,'current.png');await fs.writeFile(files.current,(await ws.renderer.render(clan.code,{size:512,crop:512})).png);
  const siblings=kingdom?kingdom.clans.filter(c=>c.id!==clan.id):[];
  if(kingdom){
    files.kingdom=path.join(directory,'kingdom.png');await fs.writeFile(files.kingdom,(await ws.renderer.render(kingdom.entry.code,{size:512,crop:512})).png);
    const tiles=[];for(const s of [{id:kingdom.id,name:'KINGDOM '+kingdom.name,entry:kingdom.entry},...siblings])tiles.push({image:(await ws.renderer.render(s.entry.code,{size:200,crop:512})).png,label:s.name});
    files.family=path.join(directory,'family.png');await fs.writeFile(files.family,await contactSheet(tiles,{columns:6,tile:200,title:kingdom.name+' · kingdom banner + '+siblings.length+' clans'}));
  }
  const candidateGroups=kingdom?kingdom.groups.filter(g=>g.source==='Module'||g.origin==='override').slice(0,groupLimit):[];
  files.iconSheets=await writeIconSheets(ws,candidateGroups.map(g=>g.id),directory);
  const family=kingdom?[kingdom.entry,...kingdom.clans.map(c=>c.entry)]:[clan];
  const brief={
    clan:{id:clan.id,name:clan.name,culture:clan.culture||ws.nativeClans.get(clan.id)?.culture||'',source:clan.source,key:clan.key,code:clan.code,layers:describe(clan.code),alternatives:info.entries.filter(e=>e.key!==clan.key).map(e=>e.key)},
    kingdom:kingdom?{id:kingdom.id,name:kingdom.name,culture:kingdom.culture,linkedBy:info.via,code:kingdom.entry.code,layers:describe(kingdom.entry.code),override:kingdom.override}:null,
    siblings:siblings.map(s=>({id:s.id,name:s.name,layers:decode(s.entry.code).length,iconGroups:[...new Set(decode(s.entry.code).slice(1).map(l=>icons.get(l.meshId)?.group))]})),
    iconGroups:kingdom?.groups.map(({id,name,source,uses,banners,origin})=>({id,name,source,uses,banners,origin}))||[],
    colourUsage:colourUsage(ws.library,family),
    backgroundsUsed:[...new Set(family.map(b=>decode(b.code)[0].meshId))],
    files,warnings:ws.warnings};
  await writeJson(path.join(directory,'brief.json'),brief);
  return brief;
}
export async function kingdomSummary(ws){
  const {kingdoms,clanIndex}=factionModel(ws.library,await readFactionMap(ws),ws.nativeClans);
  return {kingdoms:[...kingdoms.values()].map(k=>({id:k.id,name:k.name,culture:k.culture,clans:k.clans.length,label:k.override?.label||null,groups:k.groups.slice(0,8).map(g=>g.id+' '+g.name+' ×'+g.banners+(g.origin==='override'?' (override)':''))})),unassigned:[...clanIndex].filter(([,c])=>!c.kingdom).map(([id,c])=>id+' ('+c.entry.name+')')};
}
export async function initFactionMap(ws,{force=false}={}){
  const file=path.join(ws.ai,'faction-map.json'),existing=await readFactionMap(ws);
  const {kingdoms}=factionModel(ws.library,{kingdoms:{}},ws.nativeClans);
  for(const k of kingdoms.values()){
    const current=existing.kingdoms[k.id];
    if(current&&!force)continue;
    existing.kingdoms[k.id]={label:current?.label||k.name,culture:k.culture,groups:k.groups.filter(g=>g.source==='Module').slice(0,6).map(g=>g.id),excludeGroups:current?.excludeGroups||[],scheme:current?.scheme||null,notes:current?.notes||'',sources:current?.sources||[]};
  }
  existing.version=1;existing.note='groups/excludeGroups steer which icon groups brief() treats as this kingdom\'s. scheme: {field:[colourIds], metal:[colourIds], accents:[colourIds], rationale}. Seeded from usage; edit freely.';
  await writeJson(file,existing);return file;
}

// ---------- drafts ----------
export function validateCode(library,code){
  const layers=decode(code),icons=new Set(library.icons.map(i=>i.id)),backgrounds=new Set(library.backgrounds.map(b=>b.id)),colors=new Set(library.colors.map(c=>c.id)),problems=[];
  for(const [i,l] of layers.entries()){
    if(i===0&&!backgrounds.has(l.meshId))problems.push('Layer 0 mesh '+l.meshId+' is not a background pattern.');
    if(i>0&&!icons.has(l.meshId))problems.push('Layer '+i+' icon '+l.meshId+' is not registered.');
    for(const c of [l.colorId,l.colorId2])if(!colors.has(c))problems.push('Layer '+i+' colour '+c+' does not exist.');
  }
  return {layers,problems};
}
export async function writeDraft(ws,{clan:query,code,name,notes=''}){
  const entries=findClan(ws.library,query),entry=preferEntry(entries),{problems}=validateCode(ws.library,code);
  if(problems.length)throw new Error(problems.join(' '));
  const id='ai-'+slugify(entry.id)+'-'+stamp(),draft={id,name:String(name||entry.name+' (AI proposal)').slice(0,150),code,sourceKey:entry.key,savedAt:new Date().toISOString(),notes:String(notes).slice(0,4000),generator:'banner-ai'};
  const drafts=path.join(ws.dataRoot,'drafts');await fs.mkdir(drafts,{recursive:true});await fs.writeFile(path.join(drafts,id+'.json'),JSON.stringify(draft,null,2),{flag:'wx'});
  const preview=path.join(ws.ai,'out',slugify(entry.id),id+'.png');await fs.mkdir(path.dirname(preview),{recursive:true});
  const {png,warnings}=await ws.renderer.render(code,{size:512,crop:512});await fs.writeFile(preview,png);
  const compare=path.join(ws.ai,'out',slugify(entry.id),id+'.compare.png');
  await fs.writeFile(compare,await contactSheet([{image:(await ws.renderer.render(entry.code,{size:320,crop:512})).png,label:'current'},{image:png,label:'proposal'}],{columns:2,tile:320,title:entry.name}));
  return {draft,file:path.join(drafts,id+'.json'),preview,compare,warnings};
}

// ---------- alphas ----------
const MODES=['alpha','light-on-dark','dark-on-light','two-tone'];
async function fetchSource(input,directory){
  if(!/^https?:\/\//i.test(input)){const data=await fs.readFile(input);return {data,original:path.resolve(input),name:path.basename(input),url:null};}
  const response=await fetch(input,{headers:{'User-Agent':'banner-editor-asset-fetch/1.0'}});
  if(!response.ok)throw new Error(input+': HTTP '+response.status);
  const data=Buffer.from(await response.arrayBuffer());if(data.length>40*1024*1024)throw new Error(input+': file too large.');
  const name=decodeURIComponent(new URL(input).pathname.split('/').pop()||'download');
  await fs.mkdir(directory,{recursive:true});const original=path.join(directory,stamp()+'-'+name.replace(/[^a-z0-9._-]/gi,'_').slice(-100));await fs.writeFile(original,data);
  return {data,original,name,url:input};
}
export function chooseMode({data,width,height}){
  let transparent=0;for(let i=3;i<data.length;i+=4)if(data[i]<250)transparent++;
  if(transparent/(width*height)>.02)return 'alpha';
  const margin=Math.max(1,Math.round(Math.min(width,height)*.02));let sum=0,n=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){if(x>=margin&&y>=margin&&x<width-margin&&y<height-margin)continue;const i=(y*width+x)*4;sum+=.2126*data[i]+.7152*data[i+1]+.0722*data[i+2];n++;}
  return sum/n>=128?'dark-on-light':'light-on-dark';
}
// two-tone source: keep alpha, grey = luminance (light = colour 1 fill, dark = colour 2 via the stroke channel).
function twoToneSource({data,width,height}){
  const out=Buffer.alloc(width*height*4);let covered=0;
  for(let i=0;i<out.length;i+=4){const lum=Math.round(.2126*data[i]+.7152*data[i+1]+.0722*data[i+2]);out[i]=out[i+1]=out[i+2]=lum;out[i+3]=data[i+3];if(data[i+3]>127)covered++;}
  return {data:out,width,height,warnings:covered?[]:['Mask is empty.']};
}
const maskMode=mode=>mode==='two-tone'?'two-tone':'alpha';
export function bakeMask({data,width,height},{mode,levels,invert=false}){
  const [lo,hi]=levels||(mode==='alpha'?[0,1]:[.12,.88]),out=Buffer.alloc(width*height*4);let border=0,borderCount=0,covered=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4,a=data[i+3]/255,lum=(.2126*data[i]+.7152*data[i+1]+.0722*data[i+2])/255;
    let m=mode==='light-on-dark'?a*lum:mode==='dark-on-light'?a*(1-lum):a;if(invert)m=1-m;
    m=Math.max(0,Math.min(1,(m-lo)/Math.max(.001,hi-lo)));
    out[i]=out[i+1]=out[i+2]=255;out[i+3]=Math.round(m*255);if(m>.5)covered++;
    if(x===0||y===0||x===width-1||y===height-1){borderCount++;if(m>.5)border++;}
  }
  const warnings=[];if(border/borderCount>.3)warnings.push('Mask covers '+Math.round(100*border/borderCount)+'% of the image border — wrong mode, or artwork needs cropping/--invert.');
  if(covered/(width*height)>.85)warnings.push('Mask covers most of the image; check the mode.');
  if(!covered)warnings.push('Mask is empty.');
  return {data:out,width,height,warnings};
}
export async function prepareAlpha(ws,input,{name,source,licence='',author='',mode='auto',levels,invert=false,notes=''}={}){
  const directory=path.join(ws.ai,'alphas'),fetched=await fetchSource(input,path.join(directory,'originals'));
  const meta=await sharp(fetched.data,{limitInputPixels:80_000_000}).metadata();
  if(!['png','jpeg','webp','svg','gif','tiff','avif'].includes(meta.format))throw new Error(input+': unsupported image format '+meta.format+'.');
  const density=meta.format==='svg'?Math.min(2400,Math.max(72,72*1400/Math.max(meta.width||1,meta.height||1))):undefined;
  const raw=await sharp(fetched.data,{density,limitInputPixels:80_000_000,pages:1}).rotate().resize(1400,1400,{fit:'inside',withoutEnlargement:meta.format!=='svg'}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const image={data:raw.data,width:raw.info.width,height:raw.info.height},chosen=mode==='auto'?chooseMode(image):mode;
  if(!MODES.includes(chosen))throw new Error('Mode must be auto, '+MODES.join(', ')+'.');
  const baked=chosen==='two-tone'?twoToneSource(image):bakeMask(image,{mode:chosen,levels,invert});
  let slug=slugify(name||path.parse(fetched.name).name);
  // Never silently overwrite a different prepared source; re-preparing the same original is fine.
  for(let n=2;;n++){const existing=await readJson(path.join(directory,slug+'.json'),null);if(!existing||existing.original===fetched.original||fetched.url&&existing.source===fetched.url)break;slug=slugify(name||path.parse(fetched.name).name)+'-'+n;}
  const png=await sharp(baked.data,{raw:{width:baked.width,height:baked.height,channels:4}}).png().toBuffer();
  const art=await preparePng({name:slug+'.png',data:png},{cellSize:512,mode:maskMode(chosen)}).catch(error=>{throw new Error(slug+': '+error.message);});
  await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,slug+'.png'),png);
  const record={slug,name:name||path.parse(fetched.name).name,file:slug+'.png',source:source||fetched.url||fetched.original,original:fetched.original,licence,author,notes,mode:chosen,levels:levels||null,invert,format:meta.format,size:[image.width,image.height],warnings:[...baked.warnings,...art.warnings],preparedAt:new Date().toISOString()};
  await writeJson(path.join(directory,slug+'.json'),record);
  return {...record,art};
}
async function alphaTile(art,size=256){
  const cell=512,raw=Buffer.alloc(cell*cell*4),left=(cell-art.width)/2,top=(cell-art.height)/2;
  for(let y=0;y<art.height;y++)art.gameMask.copy(raw,((top+y)*cell+left)*4,y*art.width*4,(y+1)*art.width*4);
  const tinted=tint({width:cell,height:cell,data:raw},{main:[232,205,140],second:[25,25,25],stroke:1});
  return sharp(Buffer.from(tinted.data),{raw:{width:cell,height:cell,channels:4}}).resize(size,size).png().toBuffer();
}
export async function alphaContactSheet(prepared,file){
  const tiles=[];for(const p of prepared)tiles.push({image:await alphaTile(p.art),label:p.slug+' · '+p.mode,tileBackground:'#7a1f24'});
  await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,await contactSheet(tiles,{columns:4,tile:256,title:'Prepared alphas (fill = gold, shown on a test field)'}));return file;
}
async function preparedAlpha(ws,slug){
  const directory=path.join(ws.ai,'alphas'),record=await readJson(path.join(directory,slugify(slug)+'.json'),null);
  if(!record)throw new Error('No prepared alpha "'+slug+'". Run: alpha prep <file|url> --name '+slug);
  return {record,data:await fs.readFile(path.join(directory,record.file))};
}
export async function preparedSheet(ws,slugs,file){
  const prepared=[];for(const slug of slugs){const {record,data}=await preparedAlpha(ws,slug);prepared.push({...record,art:await preparePng({name:record.file,data},{cellSize:512,mode:maskMode(record.mode)})});}
  return alphaContactSheet(prepared,file);
}
export async function freeSlots(ws,material){const detail=await atlasDetails({config:ws.config,root:ws.root,library:ws.library,material}),used=new Set(detail.icons.map(i=>i.slot));return {detail,free:Array.from({length:16},(_,i)=>i).filter(i=>!used.has(i))};}
export async function atlasesForGroup(ws,groupId){
  const {atlases}=await atlasCatalog({config:ws.config,root:ws.root,library:ws.library});
  return atlases.filter(a=>a.icons.some(i=>i.group===groupId)).map(a=>({name:a.name,editable:a.editable,error:a.error,free:16-new Set(a.icons.map(i=>i.slot)).size,groups:a.groups.map(displayName)}));
}
// Icon group target: an existing module group id, or a new group {newGroup:'Name', newGroupId?}.
function iconGroupTarget(ws,{group,newGroup,groupId}){
  if(newGroup!=null&&newGroup!==true&&String(newGroup).trim()){const name=String(newGroup).trim();const id=groupId==null?undefined:Number(groupId);if(id!==undefined&&!Number.isSafeInteger(id))throw new Error('--group-id must be a whole number.');return id===undefined?{newGroup:name}:{newGroup:name,newGroupId:id};}
  const id=Number(group);if(!Number.isInteger(id)||!ws.library.groups.some(g=>g.id===id&&g.source==='Module'))throw new Error('Choose a module icon group with --group <id>, or create one with --new-group "Name" [--group-id n].');
  return {groupId:id};
}
export async function stageAlphas(ws,slugs,{group,newGroup,groupId:newGroupId,material,slots='auto',padding,outline=0}){
  const target=iconGroupTarget(ws,{group,newGroup,groupId:newGroupId}),groupId=target.groupId;
  if(target.newGroup&&!material)throw new Error('Pass --material <atlas> when staging into a new icon group.');
  const items=[];for(const slug of slugs)items.push(await preparedAlpha(ws,slug));
  if(!material){
    const options=(await atlasesForGroup(ws,groupId)).filter(a=>a.editable);
    const fit=options.find(a=>a.free>=items.length);
    if(!fit)throw new Error('No editable atlas used by group '+groupId+' has '+items.length+' free slot(s). Candidates: '+(options.map(a=>a.name+' ('+a.free+' free)').join(', ')||'none')+'. Pass --material, or use "alpha new-atlas".');
    material=fit.name;
  }
  const {detail,free}=await freeSlots(ws,material);
  const chosen=slots==='auto'?free.slice(0,items.length):String(slots).split(',').map(Number);
  if(chosen.length!==items.length)throw new Error(material+' has '+free.length+' free slot(s) ('+free.join(',')+'); '+items.length+' alpha(s) requested.');
  const replacing=chosen.filter(s=>!free.includes(s));
  const pad=padding??Math.round(detail.cellSize*.02);
  const actions=items.map((item,i)=>({type:'replace',slot:chosen[i],file:{name:item.record.file,dataUrl:'data:image/png;base64,'+item.data.toString('base64')},mode:maskMode(item.record.mode),padding:pad,outline:Number(outline),...target}));
  const manifest=await stageAtlasEdit({config:ws.config,root:ws.root,library:ws.library,material,expected:detail.snapshot,actions});
  const record={batchId:manifest.batchId,material,groupId:groupId??null,newGroups:manifest.newGroups||[],createdAt:manifest.createdAt,items:items.map((item,i)=>({slot:chosen[i],slug:item.record.slug,existingIds:detail.icons.filter(x=>x.slot===chosen[i]).map(x=>x.id)})),replacing};
  await writeJson(path.join(ws.ai,'stages',manifest.batchId+'.json'),record);
  return {manifest,record,preview:path.join(manifest.directory,manifest.preview),replacing:replacing.map(s=>({slot:s,ids:detail.icons.filter(x=>x.slot===s).map(x=>x.id),usages:detail.icons.filter(x=>x.slot===s).flatMap(x=>detail.usages[x.id]||[]).map(u=>u.name)}))};
}
export async function installAlphas(ws,batchId){
  const record=await readJson(path.join(ws.ai,'stages',batchId+'.json'),null);
  const manifest=await installAtlasEdit({config:ws.config,root:ws.root,batchId});
  const credits=[];
  for(const item of record?.items||[]){
    const ids=[...item.existingIds,...(manifest.additions||[]).filter(a=>a.slot===item.slot).map(a=>a.id)];
    const {record:alpha}=await preparedAlpha(ws,item.slug);credits.push(...ids.map(id=>creditFor(alpha,{iconId:id,material:manifest.material,slot:item.slot,batchId})));
  }
  await addCredits(ws,credits);
  return {manifest,credits};
}
export async function newAtlas(ws,slugs,{group,newGroup,groupId,padding=0,outline=0,install=false,number}){
  const target=iconGroupTarget(ws,{group,newGroup,groupId});
  const atlasGroup=target.newGroup?{name:target.newGroup,...(target.newGroupId===undefined?{}:{id:target.newGroupId})}:{id:target.groupId};
  // Grouped pages are named <atlasPrefix>_NN; the icon group decides where the icons are listed.
  const items=[];for(const slug of slugs)items.push(await preparedAlpha(ws,slug));
  const p=ws.paths,manifest=await buildAtlases({files:items.map(i=>({name:i.record.file,data:i.data,mode:maskMode(i.record.mode)})),modulePath:ws.config.modulePath,gamePath:ws.config.gamePath,outputDirectory:path.join(ws.dataRoot,'atlas-builds'),sourceDirectory:p.atlasSources,registryFile:p.registry,nativeRegistryFile:p.nativeRegistry,thumbnailDirectory:p.thumbnails,atlasPrefix:ws.config.atlasPrefix,groupLabel:ws.config.moduleName,atlasSize:ws.config.resourceSettings.newAtlasSize,startIndex:number===undefined?undefined:Number(number),install,padding:Number(padding),outline:Number(outline),mode:'alpha',group:atlasGroup});
  if(install){
    const credits=[];for(const atlas of manifest.atlases)for(const cell of atlas.cells){const item=items.find(i=>i.record.file===cell.source);if(item)credits.push(creditFor(item.record,{iconId:cell.iconId,material:atlas.name,slot:cell.textureIndex,batchId:manifest.batchId}));}
    await addCredits(ws,credits);
  }
  return manifest;
}
const creditFor=(alpha,extra)=>({...extra,name:alpha.name,slug:alpha.slug,source:alpha.source,licence:alpha.licence,author:alpha.author,notes:alpha.notes,installedAt:new Date().toISOString()});
export async function addCredits(ws,entries){
  if(!entries.length)return;
  const file=path.join(ws.ai,'credits.json'),credits=await readJson(file,[]);
  for(const entry of entries){const i=credits.findIndex(c=>c.iconId===entry.iconId);if(i>=0)credits[i]={...entry,replaced:credits[i]};else credits.push(entry);}
  credits.sort((a,b)=>a.iconId-b.iconId);await writeJson(file,credits);
  const md=['# Banner icon credits','','Icons added through the banner AI workflow. Generated from credits.json.','','| Icon | Atlas · slot | Name | Author | Licence | Source |','|---|---|---|---|---|---|',...credits.map(c=>`| ${c.iconId} | ${c.material} · ${c.slot} | ${c.name} | ${c.author||'—'} | ${c.licence||'unknown'} | ${c.source||'—'} |`),''];
  await fs.writeFile(path.join(ws.ai,'CREDITS.md'),md.join('\n'));
}
export {managedDirectory};
