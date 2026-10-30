import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { replaceBannerAttribute,readBannerAttribute } from './library.mjs';
import { decode } from './public/banner-code.mjs';

function sourcePath(modulePath,entry){
  const base=path.resolve(modulePath),target=path.resolve(base,entry.source);
  if(!target.startsWith(base+path.sep))throw new Error('Invalid source file.');
  return target;
}
export async function validateInstalledModule(modulePath,installedModulePath,io=fs){
  const id=async folder=>{
    const xml=await io.readFile(path.join(folder,'SubModule.xml'),'utf8');
    const value=xml.match(/<Id\b[^>]*\bvalue\s*=\s*["']([^"']+)["']/)?.[1];
    if(!value)throw new Error('Cannot identify the module in '+folder);
    return value;
  };
  const [sourceId,installedId]=await Promise.all([id(modulePath),id(installedModulePath)]);
  if(sourceId!==installedId)throw new Error('Installed module ID '+installedId+' does not match '+sourceId+'.');
}

export async function saveBannerSource({root,modulePath,installedModulePath,syncInstalledBanners=false,library,data,io=fs}) {
  const entry=library.banners.find(b=>b.key===data.key);
  if(!entry)throw new Error('Choose a banner from the module library first.');
  const layers=decode(data.code),targets=[];
  async function prepare(label,folder,expected){
    const target=sourcePath(folder,entry),original=await io.readFile(target);
    const current=expected??readBannerAttribute(original.toString('utf8'),entry);
    const changed=Buffer.from(replaceBannerAttribute(original.toString('utf8'),entry,data.code,current));
    const real=await io.realpath(target);
    if(targets.some(t=>t.real===real))return;
    targets.push({label,target,real,original,changed});
  }
  if(typeof data.expectedCode!=='string')throw new Error('Reload the source banner before saving.');
  await prepare('development',modulePath,data.expectedCode);
  const mirror=syncInstalledBanners&&['Clan','Kingdom'].includes(entry.kind);
  if(mirror){
    if(!installedModulePath)throw new Error('Set the installed module folder before saving clan or kingdom banners.');
    try{await validateInstalledModule(modulePath,installedModulePath,io);await prepare('installed',installedModulePath);}catch(error){throw new Error('Could not prepare the installed module banner. No files were saved. '+error.message);}
  }
  const changed=targets.filter(t=>!t.changed.equals(t.original));
  if(!changed.length)return {unchanged:true,installedSynced:mirror,installedModulePath:mirror?installedModulePath:undefined};
  const backupDirectory=path.join(root,'backups',new Date().toISOString().replaceAll(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));
  const committed=[];
  try{
    // Prepare all backups and temporary files before replacing either copy.
    for(const target of targets){
      target.backup=path.join(backupDirectory,target.label,entry.source);
      await io.mkdir(path.dirname(target.backup),{recursive:true});await io.writeFile(target.backup,target.original,{flag:'wx'});
      if(!(await io.readFile(target.backup)).equals(target.original))throw new Error('Backup verification failed: '+target.backup);
    }
    for(const target of changed){
      target.temp=target.target+'.banner-editor-'+randomUUID()+'.tmp';
      await io.writeFile(target.temp,target.changed,{flag:'wx'});
    }
    for(const target of targets)if(!(await io.readFile(target.target)).equals(target.original))throw new Error('Source changed while saving. Reload and try again.');
    for(const target of changed){
      if(!(await io.readFile(target.target)).equals(target.original))throw new Error('Source changed while saving. Reload and try again.');
      await io.rename(target.temp,target.target);committed.push(target);
      if(!(await io.readFile(target.target)).equals(target.changed))throw new Error('Save verification failed: '+target.target);
    }
  }catch(error){
    const rollbackErrors=[];
    for(const target of committed.reverse()){
      const rollback=target.target+'.rollback-'+randomUUID()+'.tmp';
      try{
        if(!(await io.readFile(target.target)).equals(target.changed))throw new Error('File was edited again: '+target.target);
        await io.writeFile(rollback,target.original,{flag:'wx'});await io.rename(rollback,target.target);
      }catch(rollbackError){rollbackErrors.push(rollbackError.message);}
      finally{await io.unlink(rollback).catch(()=>{});}
    }
    if(rollbackErrors.length)throw new Error('Save failed; restoration needs attention. Backups: '+backupDirectory+'. '+rollbackErrors.join(' '));
    throw error;
  }finally{for(const target of changed)if(target.temp)await io.unlink(target.temp).catch(()=>{});}
  entry.code=data.code;entry.layerCount=layers.length;
  return {saved:entry.source,backup:targets[0].backup,backups:targets.map(t=>({kind:t.label,path:t.backup})),installedSynced:mirror,installedModulePath:mirror?installedModulePath:undefined,targets:targets.map(t=>t.target)};
}
