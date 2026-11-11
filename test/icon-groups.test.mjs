import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {planAtlasRegistration,planSlotRegistration,iconGroupOptions,readIconRegistry,groupDisplayName} from '../atlas-registration.mjs';
import {buildAtlases} from '../atlas-builder.mjs';
import {makeWorkspace} from './helpers/workspace.mjs';
import {atlasDetails,stageAtlasEdit,installAtlasEdit} from '../atlas-manager.mjs';

// banner_icons.xml grouped by peoples, as TAOM keeps it: CRLF, blank lines between groups, comments.
const XML='<?xml version="1.0" encoding="utf-8"?>\r\n<base>\r\n  <BannerIconData>\r\n    <!-- Peoples of Middle-earth -->\r\n'
  +'    <BannerIconGroup id="100" name="{=taom_banner_category_dunedain}Dúnedain">\r\n      <Icon id="10000" material_name="taom_banners_gondor_alpha_01" texture_index="0" />\r\n      <Icon id="10001" material_name="taom_banners_gondor_alpha_01" texture_index="1" />\r\n    </BannerIconGroup>\r\n\r\n'
  +'    <BannerIconGroup id="200" name="{=taom_banner_category_northmen}Northmen">\r\n      <Icon id="20000" material_name="taom_banners_gondor_alpha_01" texture_index="2" />\r\n    </BannerIconGroup>\r\n\r\n'
  +'    <BannerIconGroup id="300" name="{=taom_banner_category_miscellaneous}Miscellaneous">\r\n      <!-- <Icon id="39999" material_name="old" texture_index="0" /> -->\r\n      <Icon id="30000" material_name="taom_banners_misc_alpha_01" texture_index="0" />\r\n    </BannerIconGroup>\r\n\r\n'
  +'    <BannerColors><Color id="1" hex="0xff000000" /></BannerColors>\r\n  </BannerIconData>\r\n</base>\r\n';
const block=(xml,id)=>xml.match(new RegExp('<BannerIconGroup id="'+id+'"[^>]*>([\\s\\S]*?)</BannerIconGroup>'))?.[1]??null;
const members=(xml,id)=>[...(block(xml,id)||'').replace(/<!--[\s\S]*?-->/g,'').matchAll(/<Icon id="(\d+)"/g)].map(m=>Number(m[1]));

async function fixture(run){
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'taom-groups-test-'));
  try{
    const modulePath=path.join(temp,'module'),sourceDirectory=path.join(modulePath,'AssetSources','BannerIcons'),xmlPath=path.join(modulePath,'ModuleData','banner_icons.xml'),sprites=path.join(modulePath,'GUI','SpriteParts','ui_taom_bannericons');
    for(const dir of [sourceDirectory,path.dirname(xmlPath),sprites])await fs.mkdir(dir,{recursive:true});
    await fs.writeFile(xmlPath,XML);
    await run({temp,modulePath,sourceDirectory,xmlPath,sprites});
  }finally{const resolved=path.resolve(temp);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('taom-groups-test-'));await fs.rm(resolved,{recursive:true,force:true});}
}
const png=async()=>sharp({create:{width:64,height:64,channels:4,background:'#0000'}}).composite([{input:await sharp({create:{width:15,height:25,channels:4,background:'#fff'}}).png().toBuffer(),left:3,top:7}]).png().toBuffer();

test('group options list peoples by display name, including empty groups',async()=>fixture(async({modulePath})=>{
  const registry=await readIconRegistry(modulePath);
  assert.deepEqual(iconGroupOptions(registry).map(({id,name,icons})=>[id,name,icons]),[[100,'Dúnedain',2],[200,'Northmen',1],[300,'Miscellaneous',1]]);
  assert.equal(groupDisplayName('{=!}TAOM Gondor Alpha 01'),'TAOM Gondor Alpha 01');
}));

test('new atlas joins an existing group with sequential IDs; every other byte is preserved',async()=>fixture(async({modulePath})=>{
  const plan=await planAtlasRegistration({modulePath,atlases:[{name:'taom_banners_dunedain_alpha_01',count:2}],group:{id:100}});
  assert.deepEqual(plan.group,{id:100,name:'Dúnedain',title:'{=taom_banner_category_dunedain}Dúnedain',created:false});
  assert.deepEqual(plan.atlases[0].icons.map(i=>i.id),[30001,30002]);
  const xml=plan.changed.toString();
  assert.deepEqual(members(xml,100),[10000,10001,30001,30002]);assert.deepEqual(members(xml,200),[20000]);
  assert.match(block(xml,100),/\r\n      <Icon id="30002" material_name="taom_banners_dunedain_alpha_01" texture_index="1" \/>\r\n    $/);
  assert.equal(xml.replace(/\r\n {6}<Icon id="3000[12]"[^>]*\/>/g,''),XML);
}));

test('new atlas can create a new group after the last one, with a localisation key and next free ID',async()=>fixture(async({modulePath})=>{
  const plan=await planAtlasRegistration({modulePath,atlases:[{name:'taom_banners_rhun_alpha_01',count:1}],group:{name:'Rhûn Folk'}});
  assert.deepEqual(plan.group,{id:310,name:'Rhûn Folk',title:'{=taom_banner_category_rhun_folk}Rhûn Folk',created:true});
  const xml=plan.changed.toString();
  assert.deepEqual(members(xml,310),[30001]);
  assert.ok(xml.indexOf('id="310"')>xml.indexOf('id="300"')&&xml.indexOf('id="310"')<xml.indexOf('<BannerColors'));
  assert.equal(xml.replace(/<BannerIconGroup id="310"[\s\S]*?<\/BannerIconGroup>\r\n(\r\n)?\s*/,'').replace(/\s+/g,''),XML.replace(/\s+/g,''));
  const custom=await planAtlasRegistration({modulePath,atlases:[{name:'taom_banners_rhun_alpha_01',count:1}],group:{name:'Rhûn',id:150}});
  assert.equal(custom.group.id,150);
  await assert.rejects(planAtlasRegistration({modulePath,atlases:[{name:'a_b_alpha_01',count:1}],group:{name:'dúnedain'}}),/already|exists/i);
  await assert.rejects(planAtlasRegistration({modulePath,atlases:[{name:'a_b_alpha_01',count:1}],group:{name:'Other',id:200}}),/in use|taken|already/i);
  await assert.rejects(planAtlasRegistration({modulePath,atlases:[{name:'a_b_alpha_01',count:1}],group:{id:555}}),/group/i);
}));

test('installing a grouped atlas build writes the PSD under the file name and icons under the people',async()=>fixture(async({temp,modulePath,sourceDirectory,xmlPath,sprites})=>{
  const result=await buildAtlases({modulePath,sourceDirectory,files:[{name:'a.png',data:await png()},{name:'b.png',data:await png()}],faction:'Dúnedain',category:'alpha',outputDirectory:path.join(temp,'builds'),install:true,group:{id:100}});
  assert.equal(result.group.id,100);assert.equal(result.registration.installed,true);
  assert.deepEqual(await fs.readdir(sourceDirectory),['taom_banners_dunedain_alpha_01.psd']);
  assert.deepEqual(members(await fs.readFile(xmlPath,'utf8'),100),[10000,10001,30001,30002]);
  assert.deepEqual((await fs.readdir(sprites)).sort(),['30001.png','30002.png']);
}));

test('slot moves keep icon IDs and element text; moving into a new group creates it',async()=>fixture(async({modulePath})=>{
  const material='taom_banners_gondor_alpha_01';
  const plan=await planSlotRegistration({modulePath,material,moves:[{slot:1,groupId:200},{slot:2,newGroup:'Rhûn'}],newGroups:[{name:'Rhûn'}],keyPrefix:'TAOM'});
  assert.deepEqual(plan.moves,[{slot:1,groupId:200,ids:[10001],from:[100]},{slot:2,groupId:310,ids:[20000],from:[200]}]);
  assert.deepEqual(plan.newGroups,[{id:310,name:'Rhûn',title:'{=taom_banner_category_rhun}Rhûn'}]);
  const xml=plan.changed.toString();
  assert.deepEqual(members(xml,100),[10000]);assert.deepEqual(members(xml,200),[10001]);assert.deepEqual(members(xml,310),[20000]);
  assert.ok(xml.includes('<Icon id="10001" material_name="taom_banners_gondor_alpha_01" texture_index="1" />'));
  assert.ok(xml.includes('<!-- <Icon id="39999" material_name="old" texture_index="0" /> -->'));
  const noop=await planSlotRegistration({modulePath,material,moves:[{slot:0,groupId:100}]});
  assert.deepEqual(noop.moves,[]);assert.ok(noop.changed.equals(noop.original));
  await assert.rejects(planSlotRegistration({modulePath,material,moves:[{slot:0,groupId:200}],newGroups:[{name:'Unused'}]}),/not used/);
}));

async function temporary(run){const temp=await fs.mkdtemp(path.join(os.tmpdir(),'banner-groups-test-'));try{await run(temp);}finally{const resolved=path.resolve(temp);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('banner-groups-test-'));await fs.rm(resolved,{recursive:true,force:true});}}
const upload=async()=>({name:'new-emblem.png',dataUrl:'data:image/png;base64,'+(await png()).toString('base64')});

test('atlas manager: a group-only review moves icons without touching the PSD, then installs',async()=>temporary(async temp=>{
  const f=await makeWorkspace(temp),original=await fs.readFile(f.source);
  let xml=await fs.readFile(f.p.registry,'utf8');xml=xml.replace('</BannerIconData>','<BannerIconGroup id="200" name="{=x}Northmen"></BannerIconGroup></BannerIconData>');await fs.writeFile(f.p.registry,xml);
  const detail=await atlasDetails({...f,material:f.material});
  assert.deepEqual(detail.groupOptions.map(g=>[g.id,g.name]),[[100,'Example Alpha'],[200,'Northmen']]);
  const review=await stageAtlasEdit({...f,material:f.material,expected:detail.snapshot,actions:[{type:'group',slot:2,groupId:200}]});
  assert.equal(review.sourceChanged,false);assert.deepEqual(review.changedSlots,[]);assert.deepEqual(review.moves,[{slot:2,groupId:200,ids:[10002],from:[100]}]);
  assert.equal(await fs.readFile(f.p.registry,'utf8'),xml);
  const result=await installAtlasEdit({...f,batchId:review.batchId});assert.equal(result.status,'installed');
  assert.deepEqual(await fs.readFile(f.source),original);
  const installed=await fs.readFile(f.p.registry,'utf8');assert.deepEqual(members(installed,100),[10000]);assert.deepEqual(members(installed,200),[10002]);
  const again=await atlasDetails({...f,material:f.material});
  await assert.rejects(stageAtlasEdit({...f,material:f.material,expected:again.snapshot,actions:[{type:'group',slot:2,groupId:200}]}),/Nothing to change/);
  await assert.rejects(stageAtlasEdit({...f,material:f.material,expected:again.snapshot,actions:[{type:'group',slot:9,groupId:200}]}),/unused/);
}));

test('atlas manager: a new group can take a newly filled slot and a moved slot in one review',async()=>temporary(async temp=>{
  const f=await makeWorkspace(temp),detail=await atlasDetails({...f,material:f.material});
  const review=await stageAtlasEdit({...f,material:f.material,expected:detail.snapshot,actions:[{type:'replace',slot:15,newGroup:'Rhûn',file:await upload()},{type:'group',slot:0,newGroup:'Rhûn'}]});
  assert.equal(review.sourceChanged,true);
  assert.deepEqual(review.newGroups,[{id:110,name:'Rhûn',title:'{=examplemod_banner_category_rhun}Rhûn'}]);
  assert.deepEqual(review.additions.map(a=>[a.slot,a.groupId]),[[15,110]]);assert.deepEqual(review.moves.map(m=>[m.slot,m.groupId,m.ids]),[[0,110,[10000]]]);
  const proposed=await fs.readFile(path.join(review.directory,'banner_icons.xml'),'utf8');
  assert.deepEqual(members(proposed,110).sort(),[10000,review.additions[0].id].sort());assert.deepEqual(members(proposed,100),[10002]);
  await assert.rejects(stageAtlasEdit({...f,material:f.material,expected:detail.snapshot,actions:[{type:'group',slot:0,newGroup:'Rhûn',newGroupId:120},{type:'group',slot:2,newGroup:'rhûn',newGroupId:130}]}),/two different IDs/);
}));
