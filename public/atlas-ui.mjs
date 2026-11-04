export function setupAtlasUI({api,getLibrary,onInstalled=async()=>{}}) {
  const $=id=>document.getElementById(id);
  let files=[],urls=[],result=null,active=0,busy=false;
  const error=message=>{$('atlasStatus').textContent=message;$('atlasStatus').className='atlas-status error';};
  function redrawFiles(){
    $('atlasFileList').replaceChildren();
    $('atlasFileCount').textContent=files.length?`${files.length} PNGs · ${Math.ceil(files.length/16)} atlas${files.length>16?'es':''}`:'No PNGs selected';
    $('generateAtlasButton').disabled=busy||!files.length;
    files.forEach((file,index)=>{
      const row=document.createElement('div');row.className='atlas-file-row';
      const slot=document.createElement('span');slot.className='atlas-slot';slot.textContent=`${Math.floor(index/16)+1}.${index%16}`;slot.title='Atlas number · texture index';
      const image=document.createElement('img');image.src=urls[index];image.alt='';
      const label=document.createElement('span');label.className='atlas-file-name';label.textContent=file.name;label.title=file.name;
      const up=document.createElement('button');up.type='button';up.textContent='↑';up.title='Move '+file.name+' earlier';up.disabled=busy||index===0;
      up.onclick=()=>{[files[index-1],files[index]]=[files[index],files[index-1]];[urls[index-1],urls[index]]=[urls[index],urls[index-1]];redrawFiles();};
      const down=document.createElement('button');down.type='button';down.textContent='↓';down.title='Move '+file.name+' later';down.disabled=busy||index===files.length-1;
      down.onclick=()=>{[files[index+1],files[index]]=[files[index],files[index+1]];[urls[index+1],urls[index]]=[urls[index],urls[index+1]];redrawFiles();};
      const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.title='Remove '+file.name;remove.disabled=busy;
      remove.onclick=()=>{URL.revokeObjectURL(urls[index]);urls.splice(index,1);files.splice(index,1);redrawFiles();};
      row.append(slot,image,label,up,down,remove);$('atlasFileList').append(row);
    });
  }
  function addFiles(incoming){
    const next=Array.from(incoming);
    if(next.some(f=>!f.name.toLowerCase().endsWith('.png'))){error('Choose PNG files only.');return;}
    if(next.some(f=>f.size>32*1024*1024)){error('Each PNG must be 32 MB or smaller.');return;}
    if(files.length+next.length>128){error('A batch can contain up to 128 PNGs.');return;}
    if([...files,...next].reduce((n,f)=>n+f.size,0)>128*1024*1024){error('The selected PNGs exceed the 128 MB batch limit.');return;}
    files.push(...next);urls.push(...next.map(f=>URL.createObjectURL(f)));redrawFiles();$('atlasStatus').textContent='PNG order determines the cells: left-to-right, then top-to-bottom.';$('atlasStatus').className='atlas-status';
  }
  function drawResult(){
    const atlas=result.atlases[active];$('atlasResult').hidden=false;$('atlasPlaceholder').hidden=true;
    $('atlasPreview').src=atlas.previewUrl;$('atlasPreview').alt=atlas.name+' centred 4 by 4 layout';
    $('atlasResultTabs').replaceChildren();
    result.atlases.forEach((a,i)=>{const button=document.createElement('button');button.type='button';button.textContent='Atlas '+(i+1);button.className=i===active?'active':'';button.onclick=()=>{active=i;drawResult();};$('atlasResultTabs').append(button);});
    $('atlasOutputName').textContent=atlas.name+'.psd';$('atlasOutputPath').textContent=(atlas.installedPath||result.directory)+' · Icon IDs '+atlas.cells.map(c=>c.iconId).join(', ');
    $('atlasPsdLink').href=atlas.psdUrl;$('atlasPsdLink').download=atlas.psd;
    $('atlasMaskLink').href=atlas.maskUrl;$('atlasMaskLink').download=atlas.mask;
    $('atlasWarnings').replaceChildren();
    for(const cell of atlas.cells)for(const warning of cell.warnings){const line=document.createElement('div');line.textContent=cell.source+': '+warning;$('atlasWarnings').append(line);}
    $('atlasWarnings').hidden=!$('atlasWarnings').childElementCount;
  }
  $('atlasButton').onclick=async()=>{
    $('atlasDialog').showModal();
    const cfg=getLibrary().config,size=cfg.resourceSettings?.newAtlasSize||2048;$('atlasIntro').textContent=size+'×'+size+' PSD · sixteen '+size/4+'×'+size/4+' cells · oversized artwork scales down · smaller artwork keeps its original size.'; $('atlasDestination').textContent=cfg.moduleName+' · '+cfg.atlasSourceDirectory+' + '+cfg.bannerIconsFile+' + '+cfg.thumbnailDirectory;
    try{
      const info=await api('/api/atlas-info');$('atlasFactions').replaceChildren();
      for(const faction of info.factions){const option=document.createElement('option');option.value=faction;$('atlasFactions').append(option);}
      if(!$('atlasFaction').value)$('atlasFaction').value=info.factions[0]||'custom';
    }catch(e){error(e.message);}
  };
  $('closeAtlasButton').onclick=()=>{if(!busy)$('atlasDialog').close();};
  $('atlasDialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  $('atlasFiles').onchange=()=>{addFiles($('atlasFiles').files);$('atlasFiles').value='';};
  const zone=$('atlasDropzone');
  zone.ondragover=e=>{e.preventDefault();zone.classList.add('dragging');};zone.ondragleave=()=>zone.classList.remove('dragging');
  zone.ondrop=e=>{e.preventDefault();zone.classList.remove('dragging');if(!busy)addFiles(e.dataTransfer.files);};
  $('clearAtlasFiles').onclick=()=>{urls.forEach(u=>URL.revokeObjectURL(u));files=[];urls=[];redrawFiles();};
  $('generateAtlasButton').onclick=async()=>{
    busy=true;redrawFiles();$('atlasStatus').className='atlas-status';$('atlasStatus').textContent='Reading PNGs and generating centred PSD layers…';
    $('closeAtlasButton').disabled=true;$('atlasFiles').disabled=true;$('clearAtlasFiles').disabled=true;
    const read=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve({name:file.name,dataUrl:reader.result});reader.onerror=()=>reject(new Error('Could not read '+file.name));reader.readAsDataURL(file);});
    try{
      result=await api('/api/atlas-build',{files:await Promise.all(files.map(read)),faction:$('atlasFaction').value,category:$('atlasCategory').value,mode:$('atlasMaskMode').value,padding:Number($('atlasPadding').value),outline:Number($('atlasOutline').value),install:$('atlasInstall').checked,startIndex:$('atlasNumber').value?Number($('atlasNumber').value):null});
      active=0;drawResult();
      if(result.registration.installed){try{await onInstalled();}catch(e){result.refreshWarning='Import saved. Reload the editor to refresh the symbol list.';}}
      $('atlasStatus').className='atlas-status success';$('atlasStatus').textContent=`Created ${result.atlases.length} PSD${result.atlases.length>1?'s':''} · ${result.registration.installed?`Registered ${result.registration.icons} icons and installed transparent GUI thumbnails.`:'Review package saved with proposed XML entries and transparent thumbnails; module unchanged.'} ${result.refreshWarning||''}`;
    }catch(e){error(e.message);}finally{busy=false;redrawFiles();$('closeAtlasButton').disabled=false;$('atlasFiles').disabled=false;$('clearAtlasFiles').disabled=false;}
  };
  redrawFiles();
}
