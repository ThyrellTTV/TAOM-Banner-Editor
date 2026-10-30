import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { replaceBannerAttribute } from './library.mjs';
import { decode } from './public/banner-code.mjs';
export async function saveBannerSource({root,modulePath,library,data}) {
  const entry=library.banners.find(b=>b.key===data.key);
  if(!entry)throw new Error('Choose a banner from the module library first.');
  decode(data.code);
  const target=path.resolve(modulePath,entry.source);
  if(!target.startsWith(path.resolve(modulePath)+path.sep))throw new Error('Invalid source file.');
  const original=await fs.readFile(target);
  const changed=replaceBannerAttribute(original.toString('utf8'),entry,data.code,data.expectedCode);
  if(changed===original.toString('utf8'))return {unchanged:true};
  const backup=path.join(root,'backups',new Date().toISOString().replaceAll(/[:.]/g,'-')+'-'+randomUUID().slice(0,8),entry.source);
  await fs.mkdir(path.dirname(backup),{recursive:true});await fs.writeFile(backup,original);
  const temp=target+'.banner-editor-'+randomUUID()+'.tmp';
  if(!(await fs.readFile(target)).equals(original))throw new Error('Source changed while saving. Reload and try again.');
  await fs.writeFile(temp,changed,'utf8');
  try{await fs.rename(temp,target);}catch(error){await fs.unlink(temp).catch(()=>{});throw error;}
  entry.code=data.code;entry.layerCount=decode(data.code).length;
  return {saved:entry.source,backup};
}
