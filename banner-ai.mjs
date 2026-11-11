#!/usr/bin/env node
// CLI used by Claude Code (or by hand) for AI-assisted banner design.
// Read-only commands: brief, kingdoms, render, nearest, icons, palette, atlases.
// Writes: draft (editor draft only), map init, alpha prep (data folder),
// alpha stage (review package), alpha install / new-atlas --install (dev module, backed up).
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as ai from './ai-workflow.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const HELP=`banner-ai <command>
  brief <clan>                         Clan, kingdom, siblings, icon groups, colours + PNG sheets
  kingdoms                             Kingdom → icon groups inferred from usage (+ faction-map overrides)
  map init [--force]                   Seed banner-ai/faction-map.json from usage
  render <code|clan> [--out f] [--size n] [--shape square|shield] [--crop 512|full]
                                       Default crop = central 512 (in-game view); design to this
  nearest <#hex...> [--sigil] [--background] [--module] [--count n]
  icons <groupId...>                   Labelled contact sheet(s) of a group's icons
  palette [--sigil] [--background] [--module]
  atlases <groupId>                    Atlases holding a group, with free slots
  draft <clan|kingdom:id> --code <code> [--name n] [--notes text]
  alpha prep <file|url...> [--name n] [--source url] [--licence l] [--author a]
             [--mode auto|alpha|light-on-dark|dark-on-light] [--levels lo,hi] [--invert] [--notes t]
  alpha sheet <slug...>                Contact sheet of prepared alphas
  alpha stage <slug...> --group <id> | --new-group "Name" [--group-id n]
                                       [--material m (required with --new-group)] [--slots auto|3,4] [--padding px] [--outline px]
  alpha install <batchId>              Install a staged review into the dev module (with backups)
  alpha new-atlas <slug...> --group <id> | --new-group "Name" [--group-id n]
                                       [--faction file-name] [--category alpha] [--number n] [--install]
                                       Icon group = the people the icons are listed under; --faction only
                                       names the PSD (defaults to the group name).
Add --json for machine-readable output.`;

function parse(argv){
  const positional=[],flags={};
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(a.startsWith('--')){const [k,v]=a.slice(2).split(/=(.*)/s);if(v!==undefined)flags[k]=v;else if(i+1<argv.length&&!argv[i+1].startsWith('--'))flags[k]=argv[++i];else flags[k]=true;}
    else positional.push(a);
  }
  return {positional,flags};
}
const print=(flags,value,text)=>console.log(flags.json||!text?JSON.stringify(value,null,2):text(value));
const rel=file=>file;

async function main(){
  const {positional:[command,...args],flags}=parse(process.argv.slice(2));
  if(!command||command==='help'||flags.help){console.log(HELP);return;}
  const ws=await ai.loadWorkspace(root,{configFile:flags.config});
  for(const w of ws.warnings)console.error('warning: '+w);
  const out=name=>path.join(ws.ai,'out',name);
  switch(command){
    case 'brief':{
      const brief=await ai.clanBrief(ws,args.join(' '));
      return print(flags,brief,b=>[
        `# ${b.clan.name}  (${b.clan.id}, culture ${b.clan.culture||'?'})`,
        `source ${b.clan.source}  key ${b.clan.key}`,`code   ${b.clan.code}`,
        ...b.clan.layers.map(l=>`  L${l.layer} ${l.kind} ${l.mesh}${l.groupName?' ['+l.group+' '+l.groupName+']':''} colours ${l.colors.join(' / ')} size ${l.size} pos ${l.pos} stroke ${l.stroke} mirror ${l.mirror} rot ${l.rotation}`),
        b.clan.alternatives.length?'other entries: '+b.clan.alternatives.join(', '):'',
        b.kingdom?`\n## Kingdom ${b.kingdom.name} (${b.kingdom.id}, via ${b.kingdom.linkedBy})\ncode ${b.kingdom.code}\n`+b.kingdom.layers.map(l=>`  L${l.layer} ${l.kind} ${l.mesh}${l.groupName?' ['+l.group+' '+l.groupName+']':''} colours ${l.colors.join(' / ')}`).join('\n')+(b.kingdom.override?'\noverride: '+JSON.stringify(b.kingdom.override):''):'\n(no kingdom found)',
        `\n## Sibling clans (${b.siblings.length})`,...b.siblings.map(s=>`  ${s.id} · ${s.name} · groups ${s.iconGroups.join(',')}`),
        `\n## Icon groups by usage`,...b.iconGroups.map(g=>`  ${g.id} ${g.name} [${g.source}] ${g.banners} banners / ${g.uses} layers ${g.origin==='override'?'(override)':''}`),
        `\n## Colours used in kingdom family`,'  background: '+b.colourUsage.background.slice(0,12).map(c=>c.id+' '+c.hex+' ×'+c.uses).join(', '),'  sigil:      '+b.colourUsage.sigil.slice(0,12).map(c=>c.id+' '+c.hex+' ×'+c.uses).join(', '),
        '  background meshes: '+b.backgroundsUsed.join(', '),
        `\n## Files`,...Object.entries(b.files).flatMap(([k,v])=>Array.isArray(v)?v.map(f=>'  '+k+': '+f):['  '+k+': '+v])].filter(s=>s!=='').join('\n'));
    }
    case 'kingdoms':return print(flags,await ai.kingdomSummary(ws),s=>s.kingdoms.map(k=>`${k.id.padEnd(20)} ${k.name} · ${k.clans} clans${k.label&&k.label!==k.name?' · '+k.label:''}\n    ${k.groups.join(' | ')||'(no icon usage)'}`).join('\n')+(s.unassigned.length?'\n\nUnassigned clans ('+s.unassigned.length+'): '+s.unassigned.join(', '):''));
    case 'map':{if(args[0]!=='init')throw new Error('Usage: map init [--force]');return console.log('Wrote '+await ai.initFactionMap(ws,{force:!!flags.force}));}
    case 'render':{
      const input=args.join(' '),code=/^\d+(\.\d+){9,}$/.test(input)?input:ai.findClan(ws.library,input)[0].code;
      const file=path.resolve(flags.out||out('render-'+Date.now()+'.png')),{png,warnings}=await ws.renderer.render(code,{size:Number(flags.size||512),shape:flags.shape||'square',crop:flags.crop||512});
      await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,png);warnings.forEach(w=>console.error('warning: '+w));
      const {problems}=ai.validateCode(ws.library,code);problems.forEach(p=>console.error('problem: '+p));
      return console.log(file);
    }
    case 'nearest':{
      const result=args.map(hex=>({hex,matches:ai.nearestColors(ws.library,hex.startsWith('#')?hex:'#'+hex,{count:Number(flags.count||5),sigil:!!flags.sigil,background:!!flags.background,module:!!flags.module})}));
      return print(flags,result,r=>r.map(x=>x.hex+'\n'+x.matches.map(m=>`  ${String(m.id).padStart(5)} ${m.hex} ΔE ${m.deltaE.toFixed(1).padStart(5)} ${m.source}${m.forSigil?' sigil':''}${m.forBackground?' background':''}`).join('\n')).join('\n'));
    }
    case 'icons':{const files=await ai.writeIconSheets(ws,args.map(Number),out('icons'));return console.log(files.join('\n')||'No such groups.');}
    case 'palette':{const file=out('palette'+(flags.sigil?'-sigil':'')+(flags.background?'-background':'')+(flags.module?'-module':'')+'.png');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,await ai.paletteSheet(ws,{sigil:!!flags.sigil,background:!!flags.background,module:!!flags.module}));return console.log(file);}
    case 'atlases':return print(flags,await ai.atlasesForGroup(ws,Number(args[0])),list=>list.map(a=>`${a.name}  free ${a.free}  ${a.editable?'editable':'NOT editable: '+a.error}  groups ${a.groups.join(', ')}`).join('\n')||'No atlas holds that group.');
    case 'draft':{
      if(typeof flags.code!=='string')throw new Error('Pass --code <banner code>.');
      const result=await ai.writeDraft(ws,{clan:args.join(' '),code:flags.code,name:flags.name,notes:flags.notes||''});
      result.warnings.forEach(w=>console.error('warning: '+w));
      return print(flags,result,r=>`Draft ${r.draft.id} → ${r.file}\nbound to ${r.draft.sourceKey}\npreview ${r.preview}\ncompare ${r.compare}\nOpen the editor → Drafts → "${r.draft.name}" → review → Save to module.`);
    }
    case 'alpha':{
      const [sub,...rest]=args;
      if(sub==='prep'){
        const levels=typeof flags.levels==='string'?flags.levels.split(',').map(Number):undefined,prepared=[];
        for(const input of rest)prepared.push(await ai.prepareAlpha(ws,input,{name:rest.length===1?flags.name:undefined,source:flags.source,licence:flags.licence||'',author:flags.author||'',mode:flags.mode||'auto',levels,invert:!!flags.invert,notes:flags.notes||''}));
        const sheet=await ai.alphaContactSheet(prepared,out('alphas-'+Date.now()+'.png'));
        return print(flags,{prepared:prepared.map(({art,...p})=>p),sheet},r=>r.prepared.map(p=>`${p.slug}  mode ${p.mode}  ${p.size.join('×')}  licence ${p.licence||'?'}${p.warnings.length?'\n  ! '+p.warnings.join('\n  ! '):''}`).join('\n')+'\nsheet '+r.sheet);
      }
      if(sub==='sheet')return console.log(await ai.preparedSheet(ws,rest,out('alphas-'+Date.now()+'.png')));
      if(sub==='stage'){
        const result=await ai.stageAlphas(ws,rest,{group:flags.group,newGroup:flags['new-group'],groupId:flags['group-id'],material:flags.material,slots:flags.slots||'auto',padding:flags.padding==null?undefined:Number(flags.padding),outline:flags.outline||0});
        return print(flags,result,r=>`Staged ${r.manifest.batchId}\natlas ${r.record.material}  slots ${r.record.items.map(i=>i.slot+'='+i.slug).join(', ')}\nnew icon ids ${(r.manifest.additions||[]).map(a=>a.id).join(', ')||'—'}${r.manifest.newGroups?.length?'\nnew icon groups '+r.manifest.newGroups.map(g=>g.name+' ('+g.id+')').join(', '):''}\npreview ${r.preview}${r.replacing.length?'\nREPLACES existing art: '+r.replacing.map(x=>'slot '+x.slot+' ids '+x.ids.join(',')+' used by '+(x.usages.join(', ')||'nothing')).join('; '):''}${r.manifest.warnings.length?'\nwarnings: '+r.manifest.warnings.join('; '):''}\nInstall after review: node banner-ai.mjs alpha install ${r.manifest.batchId}`);
      }
      if(sub==='install'){
        const result=await ai.installAlphas(ws,rest[0]);
        return print(flags,result,r=>`Installed ${r.manifest.batchId} into ${ws.config.modulePath}\nbackups ${r.manifest.backupDirectory}\ncredits ${r.credits.map(c=>c.iconId+' '+c.name).join(', ')||'—'}\nNext: reload the editor, then Atlas manager → Build game resources → Deploy (game closed).`);
      }
      if(sub==='new-atlas'){
        const result=await ai.newAtlas(ws,rest,{faction:flags.faction,group:flags.group,newGroup:flags['new-group'],groupId:flags['group-id'],category:flags.category||'alpha',padding:flags.padding||0,outline:flags.outline||0,install:!!flags.install,number:flags.number});
        return print(flags,result,m=>`${m.registration.installed?'Installed':'Review package (not installed)'} ${m.batchId}\n`+(m.group?`${m.group.created?'new ':''}icon group ${m.group.name} (${m.group.id})\n`:'')+m.atlases.map(a=>`${a.name}: ${path.join(m.directory,a.preview)}  ids ${a.cells.map(c=>c.iconId).join(',')}`).join('\n')+(m.registration.installed?'':'\nRe-run with --install after review.'));
      }
      throw new Error('Unknown alpha command. '+HELP);
    }
    default:throw new Error('Unknown command "'+command+'".\n'+HELP);
  }
}
main().catch(error=>{console.error('error: '+error.message);process.exitCode=1;});
