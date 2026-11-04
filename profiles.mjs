import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {normalizeConfig,writeConfig} from './configuration.mjs';

export const profilesFile=configFile=>configFile.replace(/\.json$/i,'')+'.profiles.json';
const title=(name,fallback)=>String(name||fallback||'Module').trim().slice(0,100)||'Module';
export async function readProfiles(configFile,config,root){
  let value;
  try{value=JSON.parse(await fs.readFile(profilesFile(configFile),'utf8'));}
  catch(error){if(error.code!=='ENOENT')throw new Error('Could not read mod profiles: '+error.message);}
  if(value){
    if(value.version!==1||!Array.isArray(value.profiles)||value.profiles.some(p=>!/^[-a-z0-9]+$/i.test(p.id)))throw new Error('Invalid mod profile file.');
    const ids=value.profiles.map(p=>p.id);if(new Set(ids).size!==ids.length||value.activeId&&!ids.includes(value.activeId))throw new Error('Invalid active/duplicate mod profile.');
    value.profiles=value.profiles.map(p=>({...p,config:normalizeConfig(p.config,root)}));
    // config.json remains authoritative when settings are edited manually.
    const active=value.profiles.find(p=>p.id===value.activeId);if(active)active.config=config;
    const folders=value.profiles.map(p=>path.resolve(root,p.config.dataDirectory).toLowerCase());if(new Set(folders).size!==folders.length)throw new Error('Mod profiles must use separate editor data folders.');
    return value;
  }
  const id=randomUUID();
  return {version:1,activeId:config.modulePath&&config.gamePath?id:null,profiles:config.modulePath&&config.gamePath?[{id,name:title(config.moduleName),config,updatedAt:new Date().toISOString()}]:[]};
}
export function profileSummary(store){return {activeId:store.activeId,profiles:store.profiles.map(({id,name,config,updatedAt})=>({id,name,modulePath:config.modulePath,dataDirectory:config.dataDirectory,updatedAt}))};}
export function planProfileSettings(store,input,current,root){
  const next=structuredClone(store);let profile=next.profiles.find(p=>p.id===next.activeId);
  const create=input.createProfile===true||!profile;
  if(create){profile={id:randomUUID(),name:'',config:null};next.profiles.push(profile);next.activeId=profile.id;}
  const base=input.createProfile===true?{gamePath:current.gamePath,port:current.port}:current;
  const candidate={...base,...input};
  if(input.createProfile===true&&!String(input.dataDirectory||'').trim())candidate.dataDirectory=path.join('.profiles',profile.id);
  const config=normalizeConfig(candidate,root),data=path.resolve(root,config.dataDirectory).toLowerCase();
  if(next.profiles.some(p=>p.id!==profile.id&&path.resolve(root,p.config.dataDirectory).toLowerCase()===data))throw new Error('Choose a separate editor data folder for this profile; another profile already uses it.');
  profile.name=title(input.profileName,profile.name||config.moduleName);profile.config=config;profile.updatedAt=new Date().toISOString();
  return {store:next,config};
}
export function planProfileSwitch(store,id,port){
  const next=structuredClone(store),profile=next.profiles.find(p=>p.id===id);if(!profile)throw new Error('Mod profile was not found.');
  next.activeId=id;profile.config.port=port;return {store:next,config:profile.config};
}
export async function persistProfiles(configFile,store,config){
  const file=profilesFile(configFile),previous=await fs.readFile(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  await writeConfig(file,store);
  try{await writeConfig(configFile,config);}catch(error){
    if(previous===null)await fs.unlink(file);else {const temp=file+'.'+randomUUID()+'.tmp';try{await fs.writeFile(temp,previous,{flag:'wx'});await fs.rename(temp,file);}finally{await fs.unlink(temp).catch(()=>{});}}
    throw error;
  }
}
export async function persistProfileCatalog(configFile,store){await writeConfig(profilesFile(configFile),store);}
