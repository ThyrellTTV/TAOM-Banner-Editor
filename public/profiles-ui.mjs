import {fillSettings,readSettings} from './settings-ui.mjs';
export function setupProfilesUI({api,getLibrary,onSwitched,onLoading=()=>{},permitNavigation,toast}){
  const $=id=>document.getElementById(id);let catalog={activeId:null,profiles:[]},creating=false,busy=false;
  function controls(){const id=$('profileSelect').value;$('switchProfileButton').disabled=busy||creating||!id||id===catalog.activeId;$('deleteProfileButton').disabled=busy||creating||!id||id===catalog.activeId;$('newProfileButton').disabled=busy||creating;$('cancelNewProfileButton').hidden=!creating;$('profileSelect').disabled=busy||creating;$('profileQuickSelect').disabled=busy||creating||!catalog.profiles.length;$('applySettingsButton').textContent=creating?'Create & load profile':'Apply & load module';$('applySettingsButton').disabled=busy;$('rebuildButton').disabled=busy||creating||getLibrary()?.setupRequired||getLibrary()?.loading;}
  async function refresh(){
    catalog=await api('/api/profiles');creating=false;
    for(const select of [$('profileSelect'),$('profileQuickSelect')]){select.replaceChildren();for(const profile of catalog.profiles){const option=document.createElement('option');option.value=profile.id;option.textContent=profile.name;select.append(option);}if(!catalog.profiles.length){const option=document.createElement('option');option.textContent='No saved profile';option.value='';select.append(option);}select.value=catalog.activeId||'';}
    $('profileName').value=catalog.profiles.find(p=>p.id===catalog.activeId)?.name||getLibrary()?.config?.moduleName||'';
    $('profileHelp').textContent=catalog.error||'Each profile keeps its own folders, drafts, cache, backups and exports. Existing profile data stays in its original folder.';controls();
  }
  async function switchTo(id){
    if(busy||id===catalog.activeId)return;
    if(!permitNavigation()){$('profileQuickSelect').value=catalog.activeId;return;}
    busy=true;onLoading(true);controls();$('profileHelp').textContent='Loading profile assets…';
    try{await api('/api/profiles/switch',{id});await onSwitched();$('settingsDialog').close();toast('Mod profile loaded.');}
    catch(error){toast(error.message,true);$('profileHelp').textContent=error.message;$('profileQuickSelect').value=catalog.activeId;}
    finally{busy=false;onLoading(false);controls();}
  }
  $('profileSelect').onchange=controls;$('switchProfileButton').onclick=()=>switchTo($('profileSelect').value);$('profileQuickSelect').onchange=()=>switchTo($('profileQuickSelect').value);
  $('newProfileButton').onclick=()=>{
    creating=true;
    fillSettings({gamePath:getLibrary()?.config?.gamePath||'',bannerIconsFile:'ModuleData/banner_icons.xml',nativeBannerIconsFile:'Modules/Native/ModuleData/banner_icons.xml',bannerDefinitionPaths:['ModuleData'],atlasSourceDirectory:'AssetSources/BannerIcons',nativeAssetDirectory:'Modules/Native/AssetPackages',assetPackagePaths:['Assets','AssetPackages']},{firstRun:true});
    $('profileName').value='';$('profileHelp').textContent='New profile. Choose its module folder. Leave Editor data folder blank for a separate profile folder; installed-module sync starts off.';controls();$('profileName').focus();
  };
  $('cancelNewProfileButton').onclick=()=>{creating=false;fillSettings(getLibrary().config);refresh().catch(e=>toast(e.message,true));};
  $('deleteProfileButton').onclick=async()=>{
    const id=$('profileSelect').value,profile=catalog.profiles.find(p=>p.id===id);if(!profile||id===catalog.activeId)return;
    if(!confirm('Remove the saved profile “'+profile.name+'”? Its module files, drafts, cache and backups remain on disk.'))return;
    busy=true;controls();try{await api('/api/profiles/delete',{id});await refresh();toast('Profile removed. Its files remain on disk.');}catch(e){toast(e.message,true);}finally{busy=false;controls();}
  };
  $('settingsDialog').addEventListener('close',()=>{if(creating){creating=false;fillSettings(getLibrary().config);$('profileName').value=catalog.profiles.find(p=>p.id===catalog.activeId)?.name||'';controls();}});
  return {refresh,updateControls:controls,request:()=>({...readSettings(),profileName:$('profileName').value,createProfile:creating})};
}
