import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import sharp from 'sharp';
import {readPsd} from 'ag-psd';
import {makeWorkspace} from './helpers/workspace.mjs';
import {readProfiles,planProfileSettings,planProfileSwitch,persistProfiles,profilesFile} from '../profiles.mjs';
import {atlasDetails,stageAtlasEdit,installAtlasEdit,maskBounds,extractCell} from '../atlas-manager.mjs';
import {validateAssets} from '../asset-validation.mjs';
import {loadLibrary} from '../library.mjs';
import {prepareSourceTextures} from '../prepare-assets.mjs';
import {assetFingerprint} from '../configuration.mjs';

async function temporary(run){const temp=await fs.mkdtemp(path.join(os.tmpdir(),'banner-workspace-test-'));try{await run(temp);}finally{const resolved=path.resolve(temp);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('banner-workspace-test-'));await fs.rm(resolved,{recursive:true,force:true});}}
test('profiles migrate existing settings, isolate new data and restore each saved configuration',async()=>temporary(async temp=>{
  const fixture=await makeWorkspace(temp),{root,config}=fixture,file=path.join(temp,'config.json');await fs.writeFile(file,JSON.stringify(config));
  const original=await readProfiles(file,config,root);assert.equal(original.profiles[0].config.dataDirectory,config.dataDirectory);
  const next=planProfileSettings(original,{createProfile:true,profileName:'Second profile',modulePath:path.join(temp,'Second'),gamePath:config.gamePath,dataDirectory:''},config,root);
  assert.match(next.config.dataDirectory,/\.profiles/);assert.equal(next.config.syncInstalledBanners,false);assert.notEqual(next.config.dataDirectory,config.dataDirectory);
  await persistProfiles(file,next.store,next.config);let loaded=await readProfiles(file,next.config,root);assert.equal(loaded.profiles.length,2);assert.equal(loaded.activeId,next.store.activeId);
  const switched=planProfileSwitch(loaded,original.activeId,4321);await persistProfiles(file,switched.store,switched.config);assert.equal(JSON.parse(await fs.readFile(file,'utf8')).modulePath,config.modulePath);
  loaded=await readProfiles(file,switched.config,root);assert.equal(loaded.profiles.find(p=>p.id===next.store.activeId).name,'Second profile');
  assert.throws(()=>planProfileSettings(loaded,{createProfile:true,modulePath:path.join(temp,'Third'),dataDirectory:config.dataDirectory},config,root),/separate editor data/);
}));
test('a settings write failure restores the profile catalog byte-for-byte',async()=>temporary(async temp=>{
  const file=path.join(temp,'blocked.json');await fs.mkdir(file);const previous=Buffer.from('{"preserve":"exact bytes"}\r\n');await fs.writeFile(profilesFile(file),previous);
  await assert.rejects(persistProfiles(file,{version:1,activeId:null,profiles:[]},{modulePath:'new'}));assert.deepEqual(await fs.readFile(profilesFile(file)),previous);
}));
test('atlas review centres existing artwork, preserves IDs/layers/untouched pixels, then installs with exact backups',async()=>temporary(async temp=>{
  const f=await makeWorkspace(temp),original=await fs.readFile(f.source),xml=await fs.readFile(f.p.registry),detail=await atlasDetails({...f,material:f.material});
  const staged=await stageAtlasEdit({...f,material:f.material,expected:detail.snapshot,actions:[{type:'center',slot:0}]});
  assert.deepEqual(await fs.readFile(f.source),original);assert.deepEqual(await fs.readFile(f.p.registry),xml);
  const before=readPsd(original,{useImageData:true,skipLayerImageData:true}),after=readPsd(await fs.readFile(path.join(staged.directory,staged.psd)),{useImageData:true,skipLayerImageData:true});
  assert.equal(after.children.length,before.children.length+1);assert.deepEqual(after.children.slice(0,before.children.length).map(l=>l.name),before.children.map(l=>l.name));
  for(let slot=1;slot<16;slot++)assert.deepEqual(extractCell(Buffer.from(after.imageData.data),2048,slot),extractCell(Buffer.from(before.imageData.data),2048,slot));
  const bounds=maskBounds(extractCell(Buffer.from(after.imageData.data),2048,0),512,512);assert.equal(bounds.left+bounds.width/2,256);assert.equal(bounds.top+bounds.height/2,256);
  const result=await installAtlasEdit({...f,batchId:staged.batchId});assert.equal(result.status,'installed');assert.deepEqual(await fs.readFile(path.join(result.backupDirectory,path.basename(f.source))),original);assert.deepEqual(await fs.readFile(f.p.registry),xml);
  const library=await loadLibrary(f.config.modulePath,f.config.gamePath,f.config);assert.deepEqual(library.icons.map(i=>[i.id,i.index]),[[10000,0],[10002,2]]);assert.equal((await sharp(path.join(f.p.thumbnails,'10000.png')).stats()).isOpaque,false);
}));
test('replacement and swaps retain registrations, and stale registry/thumbnail changes prevent installation',async()=>temporary(async temp=>{
  const f=await makeWorkspace(temp),detail=await atlasDetails({...f,material:f.material}),original=await fs.readFile(f.source),xml=await fs.readFile(f.p.registry);
  const png=await sharp({create:{width:900,height:600,channels:4,background:'#fff'}}).png().toBuffer();
  const staged=await stageAtlasEdit({...f,material:f.material,expected:detail.snapshot,actions:[{type:'replace',slot:0,file:{name:'large.png',dataUrl:'data:image/png;base64,'+png.toString('base64')}},{type:'swap',from:0,to:2}]});
  assert.deepEqual(staged.changedSlots,[0,2]);assert.deepEqual(staged.thumbnails.map(t=>t.id),[10000,10002]);
  await fs.appendFile(f.p.registry,'<!-- concurrent edit -->');await assert.rejects(installAtlasEdit({...f,batchId:staged.batchId}),/registry changed/);assert.deepEqual(await fs.readFile(f.source),original);
  await fs.writeFile(f.p.registry,xml);await fs.appendFile(path.join(f.p.thumbnails,'10000.png'),'external edit');
  await assert.rejects(installAtlasEdit({...f,batchId:staged.batchId}),/changed since review/);assert.deepEqual(await fs.readFile(f.source),original);assert.deepEqual(await fs.readFile(f.p.registry),xml);
}));
test('a thumbnail write failure rolls back an installed PSD and leaves the XML and thumbnails unchanged',async()=>temporary(async temp=>{
  const f=await makeWorkspace(temp),detail=await atlasDetails({...f,material:f.material}),original=await fs.readFile(f.source),thumbnail=await fs.readFile(path.join(f.p.thumbnails,'10000.png')),xml=await fs.readFile(f.p.registry);
  const staged=await stageAtlasEdit({...f,material:f.material,expected:detail.snapshot,actions:[{type:'center',slot:0}]});
  const io={...fs,rename:async(from,to)=>{if(to===path.join(f.p.thumbnails,'10000.png')&&!from.includes('rollback'))throw new Error('Simulated thumbnail rename failure');return fs.rename(from,to);}};
  await assert.rejects(installAtlasEdit({...f,batchId:staged.batchId,io}),/Simulated/);assert.deepEqual(await fs.readFile(f.source),original);assert.deepEqual(await fs.readFile(f.p.registry),xml);assert.deepEqual(await fs.readFile(path.join(f.p.thumbnails,'10000.png')),thumbnail);
}));
test('packed PNG atlases preview and edit in their original format, with a layered PSD review and unchanged other slots',async()=>temporary(async temp=>{
  const f=await makeWorkspace(temp),psd=readPsd(await fs.readFile(f.source),{useImageData:true,skipLayerImageData:true}),pngFile=f.source.replace(/\.psd$/,'.png');
  const png=await sharp(Buffer.from(psd.imageData.data),{raw:{width:2048,height:2048,channels:4}}).png().toBuffer();await fs.writeFile(pngFile,png);await fs.unlink(f.source);
  const assets={materials:{[f.material]:{slots:{0:'compiled'}}},textures:{compiled:{name:'different_diffuse_name',images:['/cache/textures/older-compiled.png']}},errors:[]};
  await prepareSourceTextures(f.p.data,assets,f.config.modulePath,f.library.icons,f.config);assert.equal(assets.errors.length,0);assert.equal(assets.textures.compiled.source,pngFile);
  const detail=await atlasDetails({...f,material:f.material});assert.equal(detail.sourceFormat,'png');
  const review=await stageAtlasEdit({...f,material:f.material,expected:detail.snapshot,actions:[{type:'center',slot:0}]});assert.equal(review.sourceFile,f.material+'.png');assert.ok(await fs.stat(path.join(review.directory,review.psd)));
  await installAtlasEdit({...f,batchId:review.batchId});assert.deepEqual(await fs.readFile(path.join(review.directory,'originals',f.material+'.png')),png);await assert.rejects(fs.stat(f.source),{code:'ENOENT'});
  const result=await sharp(pngFile).ensureAlpha().raw().toBuffer();for(let slot=1;slot<16;slot++)assert.deepEqual(extractCell(result,2048,slot),extractCell(Buffer.from(psd.imageData.data),2048,slot));
  const bounds=maskBounds(extractCell(result,2048,0),512,512);assert.equal(bounds.left+bounds.width/2,256);assert.equal(bounds.top+bounds.height/2,256);
}));
test('asset cache fingerprints change when registries or TPAC packages change',async()=>temporary(async temp=>{
  const f=await makeWorkspace(temp),first=await assetFingerprint(f.config,f.root);await fs.appendFile(f.p.registry,'<!-- registration changed -->');const second=await assetFingerprint(f.config,f.root);assert.notEqual(first,second);
  await fs.writeFile(path.join(f.p.nativeAssets,'new.tpac'),'fixture metadata');const third=await assetFingerprint(f.config,f.root);assert.notEqual(second,third);
}));
test('validation finds alignment, broken references, duplicate IDs and missing/opaque thumbnails without changing module files',async()=>temporary(async temp=>{
  const f=await makeWorkspace(temp);let xml=await fs.readFile(f.p.registry,'utf8');xml=xml.replace('</BannerIconGroup>','<Icon id="10000" material_name="example_symbols_west_alpha_01" texture_index="0"/></BannerIconGroup>');await fs.writeFile(f.p.registry,xml);
  await fs.writeFile(f.p.definitions[0],'<Factions><Faction id="bad" banner_key="'+f.code.replace('10002.0.0','99999.99.0')+'"/><Faction id="malformed" banner_key="broken"/></Factions>');
  await fs.unlink(path.join(f.p.thumbnails,'10000.png'));await fs.writeFile(path.join(f.p.thumbnails,'10002.png'),await sharp({create:{width:256,height:256,channels:3,background:'#fff'}}).png().toBuffer());
  const before=await fs.readFile(f.source),library=await loadLibrary(f.config.modulePath,f.config.gamePath,f.config),report=await validateAssets({...f,library});const codes=new Set(report.issues.map(i=>i.code));
  for(const code of ['duplicate-id','undefined-symbol','undefined-color','invalid-banner-code','off-center','missing-thumbnail','opaque-thumbnail'])assert.ok(codes.has(code),code);
  assert.deepEqual(await fs.readFile(f.source),before);assert.equal(await fs.readFile(f.p.registry,'utf8'),xml);assert.ok(report.counts.errors>0);assert.ok(report.counts.warnings>0);
}));
test('profile API switches isolated drafts/caches, rejects stale writes and preserves the active profile on failed setup',async()=>temporary(async temp=>{
  const a=await makeWorkspace(temp,'FirstMod'),b=await makeWorkspace(temp,'SecondMod'),file=path.join(temp,'config.json');await fs.writeFile(file,JSON.stringify(a.config));
  const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  const child=spawn(process.execPath,['server.mjs'],{cwd:a.root,windowsHide:true,env:{...process.env,BANNER_STUDIO_CONFIG:file,BANNER_STUDIO_PORT:String(port)},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',chunk=>log+=chunk);child.stderr.on('data',chunk=>log+=chunk);
  try{
    const base='http://127.0.0.1:'+port;let library;for(let i=0;i<100;i++){try{const data=await fetch(base+'/api/library').then(r=>r.json());if(!data.loading){library=data;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,30));}assert.ok(library,log);
    const post=(route,data)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Editor-Token':library.token},body:JSON.stringify({workspaceId:library.workspaceId,...data})});
    let profiles=await fetch(base+'/api/profiles').then(r=>r.json());const first=profiles.activeId,firstWorkspace=library.workspaceId;
    let response=await post('/api/drafts',{name:'First mod only',code:a.code});assert.equal(response.status,200);
    response=await post('/api/config',{...b.config,createProfile:true,profileName:'Second mod'});assert.equal(response.status,200,await response.text());library=await fetch(base+'/api/library').then(r=>r.json());assert.equal(library.config.modulePath,b.config.modulePath);assert.notEqual(library.workspaceId,firstWorkspace);
    assert.deepEqual(await fetch(base+'/api/drafts').then(r=>r.json()),[]);profiles=await fetch(base+'/api/profiles').then(r=>r.json());assert.equal(profiles.profiles.length,2);const second=profiles.activeId;
    response=await post('/api/drafts',{name:'Second mod only',code:b.code,workspaceId:firstWorkspace});assert.equal(response.status,400);
    response=await post('/api/config',{modulePath:path.join(temp,'missing')});assert.notEqual(response.status,200);assert.equal(JSON.parse(await fs.readFile(file,'utf8')).modulePath,b.config.modulePath);
    response=await post('/api/profiles/switch',{id:first});assert.equal(response.status,200,await response.text());library=await fetch(base+'/api/library').then(r=>r.json());assert.equal(library.config.modulePath,a.config.modulePath);assert.equal((await fetch(base+'/api/drafts').then(r=>r.json()))[0].name,'First mod only');
    response=await post('/api/profiles/delete',{id:second});assert.equal(response.status,200);assert.ok(await fs.stat(b.p.data));assert.equal((await fetch(base+'/api/profiles').then(r=>r.json())).profiles.length,1);
  }finally{child.kill();await once(child,'close');}
}));
