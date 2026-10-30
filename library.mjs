import fs from 'node:fs/promises';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { decode } from './public/banner-code.mjs';
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', parseAttributeValue: false, processEntities: false });
const list = x => x == null ? [] : Array.isArray(x) ? x : [x];
export const displayName = x => String(x || '').replace(/^\{\{?[^}]*\}\}?/, '');
export async function walk(dir) {
  const result = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) result.push(...await walk(path.join(dir, entry.name)));
    else if (/\.(xml|xslt)$/i.test(entry.name)) result.push(path.join(dir, entry.name));
  }
  return result;
}
export async function loadLibrary(modulePath, gamePath,options={}) {
  const icons = new Map(), backgrounds = new Map(), colors = new Map(), groups = [];
  for (const [source, file] of [['Native',path.resolve(gamePath,options.nativeBannerIconsFile||'Modules/Native/ModuleData/banner_icons.xml')],['Module',path.resolve(modulePath,options.bannerIconsFile||'ModuleData/banner_icons.xml')]]) {
    const doc = parser.parse(await fs.readFile(file, 'utf8')).base;
    for (const group of list(doc.BannerIconData.BannerIconGroup)) {
      const g = { id: Number(group.id), name: displayName(group.name), source, pattern: group.is_pattern === 'true' };
      groups.push(g);
      for (const icon of list(group.Icon)) icons.set(Number(icon.id), { id:Number(icon.id), material:icon.material_name, index:Number(icon.texture_index), group:g.id, source, name:g.name + ' · ' + icon.id });
      for (const bg of list(group.Background)) backgrounds.set(Number(bg.id), { id:Number(bg.id), mesh:bg.mesh_name, group:g.id, name:'Pattern ' + bg.id });
    }
    for (const color of list(doc.BannerIconData.BannerColors?.Color)) {
      const hex = String(color.hex || color.color || '').replace(/^0x/i,'').padStart(8,'0');
      colors.set(Number(color.id), { id:Number(color.id), hex:'#' + hex.slice(-6), alpha:parseInt(hex.slice(0,2),16) / 255, argb:hex });
    }
  }
  const banners = [];
  const definitionFiles=new Set();
  for(const location of options.bannerDefinitionPaths||['ModuleData']){
    const file=path.resolve(modulePath,location),stat=await fs.stat(file);
    for(const item of stat.isDirectory()?await walk(file):[file])definitionFiles.add(item);
  }
  for (const file of definitionFiles) {
    let doc;
    try { doc = parser.parse(await fs.readFile(file,'utf8')); } catch { continue; }
    const visit = (value, tag) => {
      if (Array.isArray(value)) { value.forEach(v => visit(v, tag)); return; }
      if (!value || typeof value !== 'object') return;
      for (const attribute of ['banner_key','faction_banner_key']) {
        if (typeof value[attribute] !== 'string' || !value.id) continue;
        try {
          const layers = decode(value[attribute]);
          const relative = path.relative(modulePath, file).replaceAll('\\','/');
          banners.push({ key:[relative,tag,value.id,attribute].join('::'), id:value.id, name:displayName(value.name || value.id), kind:tag === 'Kingdom' ? 'Kingdom' : tag === 'Faction' ? 'Clan' : tag, source:relative, attribute, tag, code:value[attribute], layerCount:layers.length, culture:value.culture || '' });
        } catch {}
      }
      for (const [key, child] of Object.entries(value)) if (typeof child === 'object') visit(child,key);
    };
    visit(doc,'');
    for (const template of list(doc['xsl:stylesheet']?.['xsl:template'])) {
      const match = template.match?.match(/^(\w+)\[@id=['"]([^'"]+)['"]\]$/);
      if (!match) continue;
      const attributes = list(template['xsl:copy']?.['xsl:attribute']);
      const values = Object.fromEntries(attributes.map(a => [a.name,a['#text']]));
      for (const attribute of ['banner_key','faction_banner_key']) {
        if (typeof values[attribute] !== 'string') continue;
        try {
          const layers=decode(values[attribute]);
          const relative=path.relative(modulePath,file).replaceAll('\\','/');
          banners.push({key:[relative,match[1],match[2],attribute].join('::'),id:match[2],name:displayName(values.name||match[2]),kind:match[1]==='Faction'?'Clan':match[1],tag:match[1],source:relative,attribute,code:values[attribute],layerCount:layers.length,culture:values.culture||'',format:'xslt-attribute',templateMatch:template.match});
        } catch {}
      }
    }
  }
  banners.sort((a,b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  return { groups, icons:[...icons.values()], backgrounds:[...backgrounds.values()], colors:[...colors.values()], banners };
}
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function replaceBannerAttribute(xml, entry, newCode, expectedCode) {
  decode(newCode);
  return transformBannerAttribute(xml,entry,code=>{
    if(code.trim()!==expectedCode)throw new Error('The source banner changed on disk. Reload it before saving.');
    return newCode;
  });
}
export function readBannerAttribute(xml,entry){
  let code;
  transformBannerAttribute(xml,entry,value=>{code=value.trim();return value;});
  return code;
}
function transformBannerAttribute(xml,entry,transform){
  if(entry.format==='xslt-attribute') {
    let matches=0;
    const changed=xml.replace(/<xsl:template\b(?![^>]*\/>)[^>]*>(?:(?!<xsl:template\b)[\s\S])*?<\/xsl:template>/g,block=>{
      const match=block.match(/^<xsl:template\b[^>]*\bmatch\s*=\s*(["'])(.*?)\1/);
      if(match?.[2]!==entry.templateMatch)return block;
      const expression=new RegExp('(<xsl:attribute\\s+name=["\']'+entry.attribute+'["\']\\s*>)([\\s\\S]*?)(<\\/xsl:attribute>)','g');
      return block.replace(expression,(_,start,code,end)=>{
        matches++;return start+transform(code)+end;
      });
    });
    if(matches!==1)throw new Error('Expected exactly one matching XSLT banner; found '+matches+'.');
    return changed;
  }
  const tags = new RegExp('<' + escapeRegExp(entry.tag) + '\\b[^>]*>', 'g');
  let matches = 0;
  const changed = xml.replace(tags, opening => {
    const id = opening.match(/\bid\s*=\s*(["'])(.*?)\1/);
    if (id?.[2] !== entry.id) return opening;
    const attribute = new RegExp('(\\b' + entry.attribute + '\\s*=\\s*)(["\'])(.*?)\\2');
    const old = opening.match(attribute);
    if (!old) return opening;
    matches++;
    return opening.replace(attribute, (_,prefix,quote) => prefix + quote + transform(old[3]) + quote);
  });
  if (matches !== 1) throw new Error('Expected exactly one matching source banner; found ' + matches + '.');
  return changed;
}
