import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {saveBannerSource} from '../source-store.mjs';
import {readBannerAttribute} from '../library.mjs';

const old='11.149.166.1528.1528.764.764.1.0.0.10000.172.171.500.500.764.764.0.0.0';
const older=old.replace('.500.500.','.420.420.'),next=old.replace('.500.500.','.600.600.');
async function fixture(run){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'taom-installed-sync-'));
  try{
    const modulePath=path.join(root,'development'),installedModulePath=path.join(root,'installed');
    for(const folder of [modulePath,installedModulePath]){await fs.mkdir(path.join(folder,'ModuleData'),{recursive:true});await fs.writeFile(path.join(folder,'SubModule.xml'),'<Module><Id value="TAOM"/></Module>');}
    await run({root,modulePath,installedModulePath});
  }finally{
    const resolved=path.resolve(root);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('taom-installed-sync-'));await fs.rm(resolved,{recursive:true,force:true});
  }
}

test('clan XML and kingdom XSLT saves update only the matching code in both modules, with separate backups',async()=>fixture(async options=>{
  for(const xslt of [false,true]){
    const source='ModuleData/'+(xslt?'kingdoms.xslt':'clans.xml');
    const entry={key:source,source,id:'test',tag:xslt?'Kingdom':'Faction',kind:xslt?'Kingdom':'Clan',attribute:'banner_key',code:old,...xslt?{format:'xslt-attribute',templateMatch:"Kingdom[@id='test']"}:{}};
    const xml=code=>xslt?`<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"><xsl:template match="Kingdom[@id='test']"><xsl:copy><xsl:attribute name="banner_key">${code}</xsl:attribute></xsl:copy></xsl:template></xsl:stylesheet>`:`<Factions><Faction id="test" name="Keep name" banner_key="${code}"/><Faction id="other" banner_key="${old}"/></Factions>`;
    const dev=xml(old),installed='<!-- Installed version has additional content -->\r\n'+xml(older);
    const target=path.join(options.modulePath,source),mirror=path.join(options.installedModulePath,source);
    await fs.writeFile(target,dev);await fs.writeFile(mirror,installed);
    const result=await saveBannerSource({...options,syncInstalledBanners:true,library:{banners:[entry]},data:{key:entry.key,code:next,expectedCode:old}});
    assert.equal(result.installedSynced,true);assert.equal(result.backups.length,2);
    assert.equal((await fs.readFile(target,'utf8')).replace(next,old),dev);
    assert.equal((await fs.readFile(mirror,'utf8')).replace(next,older),installed);
    assert.equal(await fs.readFile(result.backups.find(b=>b.kind==='development').path,'utf8'),dev);
    assert.equal(await fs.readFile(result.backups.find(b=>b.kind==='installed').path,'utf8'),installed);
    assert.equal(entry.code,next);
  }
}));

test('an unchanged development banner can still sync an older installed copy; cultures stay development-only',async()=>fixture(async options=>{
  const source='ModuleData/banners.xml',entry={key:'k',source,id:'test',tag:'Kingdom',kind:'Kingdom',attribute:'banner_key',code:next};
  const xml=code=>`<Kingdom id="test" banner_key="${code}" />`;
  const target=path.join(options.modulePath,source),mirror=path.join(options.installedModulePath,source);
  await fs.writeFile(target,xml(next));await fs.writeFile(mirror,xml(old));
  const result=await saveBannerSource({...options,syncInstalledBanners:true,library:{banners:[entry]},data:{key:'k',code:next,expectedCode:next}});
  assert.equal(result.installedSynced,true);assert.equal(readBannerAttribute(await fs.readFile(mirror,'utf8'),entry),next);
  entry.kind='Culture';await fs.writeFile(mirror,xml(old));
  await saveBannerSource({...options,syncInstalledBanners:true,library:{banners:[entry]},data:{key:'k',code:older,expectedCode:next}});
  assert.equal(await fs.readFile(mirror,'utf8'),xml(old));
}));

test('a missing target, wrong installed module or concurrent edit prevents changes to either original',async()=>fixture(async options=>{
  const source='ModuleData/clans.xml',entry={key:'k',source,id:'test',tag:'Faction',kind:'Clan',attribute:'banner_key',code:old};
  const original=`<Faction id="test" banner_key="${old}"/>`,target=path.join(options.modulePath,source),mirror=path.join(options.installedModulePath,source);
  await fs.writeFile(target,original);
  const save=io=>saveBannerSource({...options,syncInstalledBanners:true,library:{banners:[entry]},data:{key:'k',code:next,expectedCode:old},io});
  await assert.rejects(save(),/No files were saved/);assert.equal(await fs.readFile(target,'utf8'),original);
  await fs.writeFile(mirror,original);await fs.writeFile(path.join(options.installedModulePath,'SubModule.xml'),'<Module><Id value="Native"/></Module>');
  await assert.rejects(save(),/does not match/);assert.equal(await fs.readFile(target,'utf8'),original);
  await fs.writeFile(path.join(options.installedModulePath,'SubModule.xml'),'<Module><Id value="TAOM"/></Module>');
  let reads=0;
  const io={...fs,readFile:async(file,...args)=>{if(file===mirror&&++reads===2)await fs.writeFile(mirror,original+'<!-- Concurrent edit -->');return fs.readFile(file,...args);}};
  await assert.rejects(save(io),/changed while saving/);
  assert.equal(await fs.readFile(target,'utf8'),original);assert.equal(await fs.readFile(mirror,'utf8'),original+'<!-- Concurrent edit -->');
}));

test('failure writing the installed copy restores the development file and preserves the library baseline',async()=>fixture(async options=>{
  const source='ModuleData/clans.xml',entry={key:'k',source,id:'test',tag:'Faction',kind:'Clan',attribute:'banner_key',code:old};
  const original=`<Faction id="test" banner_key="${old}"/>`,target=path.join(options.modulePath,source),mirror=path.join(options.installedModulePath,source);
  await fs.writeFile(target,original);await fs.writeFile(mirror,original);
  const io={...fs,rename:async(from,to)=>{if(to===mirror)throw new Error('Simulated installed-file lock');return fs.rename(from,to);}};
  await assert.rejects(saveBannerSource({...options,syncInstalledBanners:true,library:{banners:[entry]},data:{key:'k',code:next,expectedCode:old},io}),/Simulated installed-file lock/);
  assert.equal(await fs.readFile(target,'utf8'),original);assert.equal(await fs.readFile(mirror,'utf8'),original);assert.equal(entry.code,old);
  for(const folder of [options.modulePath,options.installedModulePath])assert.deepEqual(await fs.readdir(path.join(folder,'ModuleData')),['clans.xml']);
}));
