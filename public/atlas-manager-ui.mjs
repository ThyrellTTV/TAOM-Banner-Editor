export function setupAtlasManagerUI({api,getLibrary,onInstalled,openBanner}){
  const $=id=>document.getElementById(id);let catalog=[],detail=null,selection=0,actions=[],review=null,busy=false,workspace=null,showReview=false,groupChoices={};
  const status=message=>{$('managerStatus').textContent=message;};
  let deployment=null;
  const url=(file)=>'/api/managed-atlas-file/'+review.batchId+'/'+encodeURIComponent(file);
  const description=action=>action.type==='replace'?(detail?.icons.some(i=>i.slot===action.slot)?'Replace':'Fill unused')+' slot '+action.slot+' · '+action.file.name:action.type==='swap'?'Swap artwork: '+action.from+' ↔ '+action.to:'Centre slot '+action.slot;
  const pendingSlots=()=>[...new Set(actions.filter(a=>a.type==='replace').map(a=>a.slot))];
  function catalogList(){
    const query=$('managerSearch').value.toLowerCase();$('managerCatalog').replaceChildren();
    for(const atlas of catalog.filter(a=>(a.name+' '+a.groups.join(' ')).toLowerCase().includes(query))){const button=document.createElement('button');button.className='manager-catalog-item'+(detail?.name===atlas.name?' active':'');button.disabled=busy;const title=document.createElement('strong');title.textContent=atlas.name;const sub=document.createElement('small');sub.textContent=atlas.icons.length+' IDs · '+atlas.banners+' banners · '+(atlas.dimensions?atlas.dimensions.width+' px':'Source missing');button.append(title,sub);button.onclick=()=>selectAtlas(atlas.name);$('managerCatalog').append(button);}
    if(!catalog.length)$('managerCatalog').textContent='No module atlases are registered.';
  }
  function draw(){
    catalogList();$('managerName').textContent=detail?.name||'Choose a registered atlas';$('managerMeta').textContent=detail?detail.dimensions.width+'×'+detail.dimensions.height+' · '+detail.cellSize+' px cells · '+detail.sourceFormat.toUpperCase()+' source · IDs retained':'';
    $('managerGrid').replaceChildren();
    for(let index=0;index<16;index++){
      const icons=detail?.icons.filter(i=>i.slot===index)||[],proposed=review?.additions?.find(a=>a.slot===index),replacement=actions.findLast(a=>a.type==='replace'&&a.slot===index),button=document.createElement('button');button.className='manager-cell'+(selection===index?' active':'');button.disabled=busy||!detail;button.setAttribute('aria-label','Atlas slot '+index+(icons.length?' · IDs '+icons.map(i=>i.id).join(', '):' · unused'));button.setAttribute('aria-pressed',String(selection===index));
      const label=document.createElement('span');label.className='slot-label';label.textContent=index;button.append(label);
      if(icons.length){const image=document.createElement('img');image.src='/api/atlas-manager/thumbnail?material='+encodeURIComponent(detail.name)+'&slot='+index+'&v='+detail.snapshot.source;image.alt='';image.loading='lazy';button.append(image);}
      else if(replacement){const image=document.createElement('img');image.src=replacement.file.dataUrl;image.alt='Queued PNG';button.append(image);}
      const ids=document.createElement('small');ids.textContent=icons.length?icons.map(i=>'#'+i.id).join(', '):proposed?'New #'+proposed.id:replacement?'New ID on review':'Unused · add PNG';button.append(ids);
      if(actions.some(a=>a.slot===index||a.from===index||a.to===index)){const badge=document.createElement('b');badge.className='slot-queued';badge.textContent='Queued';button.append(badge);}
      button.onclick=()=>{if(busy)return;selection=index;draw();};$('managerGrid').append(button);
    }
    const selectedIcons=detail?.icons.filter(i=>i.slot===selection)||[],unused=!!detail&&!selectedIcons.length,hasArtwork=!!selectedIcons.length||pendingSlots().includes(selection);$('managerSlotTitle').textContent=detail?'Slot '+selection+' · '+(selectedIcons.length?selectedIcons.map(i=>'#'+i.id).join(', '):'Unused — add PNG'):'Select an atlas';
    $('managerNewGroupField').hidden=!unused;$('managerNewGroup').replaceChildren();
    for(const group of detail?.groupOptions||[]){const option=document.createElement('option');option.value=group.id;option.textContent=group.name.replace(/^\{[^}]*\}/,'');$('managerNewGroup').append(option);}
    $('managerNewGroup').value=String(groupChoices[selection]??actions.findLast(a=>a.type==='replace'&&a.slot===selection)?.groupId??detail?.icons[0]?.group??detail?.groupOptions?.[0]?.id??'');
    $('managerNewGroup').disabled=busy||!detail;
    $('managerUsages').replaceChildren();const usages=[...new Map(selectedIcons.flatMap(i=>detail.usages[i.id]||[]).map(b=>[b.key,b])).values()];
    for(const banner of usages.slice(0,6)){const button=document.createElement('button');button.className='quiet';button.textContent=banner.name;button.onclick=()=>{if(openBanner(banner.key))$('atlasManagerDialog').close();};$('managerUsages').append(button);}
    if(!usages.length)$('managerUsages').textContent=unused?'Upload a PNG here. A free icon ID and XML entry will be proposed in the review.':'No source banners reference this slot.';else if(usages.length>6)$('managerUsages').append(document.createTextNode(' + '+(usages.length-6)+' more'));
    $('managerSwapTarget').replaceChildren();for(const index of [...new Set([...(detail?.icons.map(i=>i.slot)||[]),...pendingSlots()])]){if(index===selection)continue;const option=document.createElement('option');option.value=index;option.textContent='Slot '+index+' · '+(detail.icons.filter(i=>i.slot===index).map(i=>i.id).join(', ')||'new symbol');$('managerSwapTarget').append(option);}
    $('managerOperations').replaceChildren();actions.forEach((action,i)=>{const row=document.createElement('div');row.className='manager-operation';const text=document.createElement('span');text.textContent=description(action);const remove=document.createElement('button');remove.textContent='×';remove.title='Remove operation';remove.disabled=busy;remove.onclick=()=>{actions.splice(i,1);review=null;draw();};row.append(text,remove);$('managerOperations').append(row);});
    $('managerBuildButton').disabled=busy||!actions.length;$('managerBuildButton').textContent=busy?'Working…':'Build review';$('managerInstallButton').disabled=busy||review?.status!=='review';$('managerClearButton').disabled=busy||!actions.length;
    $('managerGameButton').disabled=busy||!detail||!!actions.length;
    for(const id of ['managerPng','managerMode','managerCenterAllButton'])$(id).disabled=busy||!detail;
    for(const id of ['managerCenterButton','managerSwapTarget','managerSwapButton'])$(id).disabled=busy||!detail||!hasArtwork;
    $('managerSwapButton').disabled=busy||!detail||!hasArtwork||!$('managerSwapTarget').options.length;
    $('managerGrid').hidden=!!review&&showReview;$('managerReview').hidden=!review||!showReview;$('managerOriginalButton').classList.toggle('active',!showReview||!review);$('managerPreviewButton').classList.toggle('active',!!review&&showReview);$('managerPreviewButton').disabled=!review;
    if(review){$('managerReviewImage').src=url(review.preview);$('managerDownload').href=url(review.psd);$('managerDownload').download=review.psd;$('managerReviewLabel').textContent=(review.status==='installed'?'Installed':'Review only')+' · slots '+review.changedSlots.join(', ')+(review.additions?.length?' · new IDs '+review.additions.map(a=>'#'+a.id+' → slot '+a.slot).join(', ')+' · existing IDs retained':' · XML and IDs unchanged');}
    $('managerXmlDownload').hidden=!review?.registration;if(review?.registration){$('managerXmlDownload').href=url(review.registration.file);$('managerXmlDownload').download='banner_icons.xml';}
    $('managerDestination').textContent=detail?'Source: '+detail.sourcePath+' · GUI thumbnails: '+getLibrary().config.thumbnailDirectory+' · Originals are backed up. Use Build game resources after installing source edits.':'Review packages are built outside the module; installation is a separate action.';
  }
  async function selectAtlas(material,slot){
    if(busy)return;if(actions.length&&detail?.name!==material&&!confirm('Discard the queued operations and open another atlas?'))return;
    busy=true;draw();status('Reading atlas and checking source snapshots…');
    try{detail=await api('/api/atlas-manager/details?material='+encodeURIComponent(material));selection=Number.isInteger(slot)&&slot>=0&&slot<16?slot:detail.icons[0]?.slot||0;actions=[];review=null;groupChoices={};status('Replace, centre or swap artwork. Click an unused slot to add a PNG and register a new icon ID.');}
    catch(error){detail=null;status(error.message);}finally{busy=false;draw();}
  }
  function queue(action){if(busy||!detail)return;if(actions.length>=128){status('Build or clear the queued operations first.');return;}const bytes=[...actions,action].reduce((n,a)=>n+(a.file?.dataUrl?.length||0)*.75,0);if(bytes>128*1024*1024){status('A review can contain at most 128 MB of replacement PNGs. Build or clear the current queue first.');return;}actions.push(action);review=null;status(actions.length+' operation(s) queued. Build a review before installing.');draw();}
  async function open(material,slot){
    if(workspace!==getLibrary().workspaceId){workspace=getLibrary().workspaceId;detail=null;actions=[];review=null;}
    if(!$('atlasManagerDialog').open)$('atlasManagerDialog').showModal();status('Loading registered atlases…');
    try{catalog=(await api('/api/atlas-manager')).atlases;draw();const selected=material||detail?.name||catalog.find(a=>a.editable)?.name||catalog[0]?.name;if(selected&&(!detail||material))await selectAtlas(selected,slot);else status('Replace, centre or swap artwork, then build a review.');}catch(error){status(error.message);}
  }
  $('managerButton').onclick=()=>open();$('closeManagerButton').onclick=()=>$('atlasManagerDialog').close();$('managerSearch').oninput=catalogList;
  $('managerOriginalButton').onclick=()=>{showReview=false;draw();};$('managerPreviewButton').onclick=()=>{showReview=true;draw();};
  $('managerNewGroup').onchange=()=>{groupChoices[selection]=Number($('managerNewGroup').value);for(const action of actions)if(action.type==='replace'&&action.slot===selection)action.groupId=groupChoices[selection];review=null;draw();};
  $('managerCenterButton').onclick=()=>queue({type:'center',slot:selection});$('managerCenterAllButton').onclick=()=>{if(!detail||busy)return;for(const index of [...new Set([...detail.icons.map(i=>i.slot),...pendingSlots()])]){if(actions.length>=128)break;actions.push({type:'center',slot:index});}review=null;status('Centring queued for every filled slot. Build a review to inspect the result.');draw();};
  $('managerSwapButton').onclick=()=>queue({type:'swap',from:selection,to:Number($('managerSwapTarget').value)});
  $('managerClearButton').onclick=()=>{if(busy)return;actions=[];review=null;status('Queued operations cleared. Module files were not changed.');draw();};
  $('managerPng').onchange=async()=>{const file=$('managerPng').files[0],slot=selection,mode=$('managerMode').value,groupId=detail?.icons.some(i=>i.slot===slot)?undefined:Number($('managerNewGroup').value);if(!file)return;try{if(!/\.png$/i.test(file.name)||file.size>32*1024*1024)throw new Error('Choose a PNG no larger than 32 MB.');const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});queue({type:'replace',slot,mode,groupId,file:{name:file.name,dataUrl}});}catch(error){status(error.message);}finally{$('managerPng').value='';}};
  $('managerBuildButton').onclick=async()=>{if(busy||!detail||!actions.length)return;busy=true;draw();status('Building the layered PSD and transparent thumbnails outside the module…');try{review=await api('/api/atlas-manager/stage',{material:detail.name,expected:detail.snapshot,actions});showReview=true;status('Review ready. '+(review.warnings.length?review.warnings.join(' '):'Untouched pixels verified; no module files changed.'));}catch(error){status(error.message);}finally{busy=false;draw();}};
  $('managerInstallButton').onclick=async()=>{
    if(busy||review?.status!=='review')return;busy=true;draw();status('Verifying sources, backing up originals and installing reviewed files…');
    try{review=await api('/api/atlas-manager/install',{batchId:review.batchId});await onInstalled();detail=await api('/api/atlas-manager/details?material='+encodeURIComponent(detail.name));catalog=(await api('/api/atlas-manager')).atlases;actions=[];status((review.refreshWarning||(review.additions?.length?'Installed atlas, new XML registrations and transparent thumbnails. Existing IDs are retained.':'Installed atlas source and transparent thumbnails. XML, IDs and untouched pixels are preserved.'))+' Backups: '+review.backupDirectory);}
    catch(error){status(error.message);}finally{busy=false;draw();}
  };
  function drawDeployment(){
    $('gameDeploymentInstall').disabled=busy||deployment?.status!=='review';
    $('gameDeploymentReport').hidden=!deployment;if(!deployment)return;
    $('gameDeploymentReport').href='/api/game-deployment/report?batchId='+encodeURIComponent(deployment.batchId);
    const changed=deployment.files.filter(f=>f.hash!==f.expected);
    $('gameDeploymentSummary').textContent=deployment.material+(deployment.atlas?' · '+deployment.atlas.width+'×'+deployment.atlas.height+' · '+deployment.atlas.format+' · '+deployment.atlas.mipCount+' mip(s)':'')+' · '+deployment.thumbnails+' thumbnails · '+deployment.sheets.length+' sheets · '+changed.length+' changed files · '+Math.round(changed.reduce((n,f)=>n+f.bytes,0)/1048576)+' MB across destinations';
    $('gameDeploymentHelp').textContent='Built with this profile’s saved compilation settings. Thumbnail sheet format: '+(deployment.sheets[0]?.format||'RGBA8')+'. Material: '+(deployment.resourceSettings?.material.template||'existing / module default')+(deployment.resourceSettings?.material.override?' with custom flags, blend mode and alpha cutoff.':', preserving its settings.');
    $('gameDeploymentFiles').textContent=deployment.targets.map(t=>t.kind.toUpperCase()+': '+t.module).join('\n')+'\n\n'+changed.map(f=>f.kind+' / '+f.relative+' ('+Math.ceil(f.bytes/1024)+' KB)').join('\n');
  }
  $('closeGameDeploymentButton').onclick=()=>$('gameDeploymentDialog').close();
  $('managerGameButton').onclick=async()=>{
    if(busy||!detail||actions.length)return;deployment=null;busy=true;draw();drawDeployment();$('gameDeploymentSummary').textContent=detail.name;$('gameDeploymentHelp').textContent='Using compilation settings saved in Module settings → Atlas resolution, textures and materials.';$('gameDeploymentFiles').textContent='';$('gameDeploymentStatus').textContent='Packing thumbnails, compiling textures/materials and verifying the review. Module files remain unchanged…';$('gameDeploymentDialog').showModal();
    try{deployment=await api('/api/game-deployment/build',{material:detail.name,expected:detail.snapshot});$('gameDeploymentStatus').textContent='Review ready. Source-to-sheet packing verified. Close the game/editor before deploying. Originals will be backed up under '+deployment.directory+'\\originals.';}
    catch(error){$('gameDeploymentStatus').textContent=error.message;}finally{busy=false;draw();drawDeployment();}
  };
  $('gameDeploymentInstall').onclick=async()=>{
    if(busy||deployment?.status!=='review')return;busy=true;draw();drawDeployment();$('gameDeploymentStatus').textContent='Checking inputs and destinations, backing up originals and deploying compiled resources…';
    try{deployment=await api('/api/game-deployment/install',{batchId:deployment.batchId});await onInstalled();detail=await api('/api/atlas-manager/details?material='+encodeURIComponent(detail.name));$('gameDeploymentStatus').textContent=(deployment.refreshWarning||'Deployed '+deployment.changedFiles+' changed files. Restart Bannerlord to load the compiled artwork.')+' Backups: '+deployment.directory+'\\originals';}
    catch(error){$('gameDeploymentStatus').textContent=error.message;}finally{busy=false;draw();drawDeployment();}
  };
  return {open};
}
