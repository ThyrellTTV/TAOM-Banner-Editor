export const settingFields=['modulePath','gamePath','moduleName','installedModulePath','bannerIconsFile','nativeBannerIconsFile','bannerDefinitionPaths','atlasSourceDirectory','thumbnailDirectory','nativeAssetDirectory','assetPackagePaths','atlasPrefix','dataDirectory'];
const lists=new Set(['bannerDefinitionPaths','assetPackagePaths']);
export function fillSettings(config,{firstRun=false}={}){
  for(const field of settingFields){const input=document.getElementById(field);input.value=lists.has(field)?(config[field]||[]).join('\n'):config[field]||'';}
  if(firstRun)for(const field of ['moduleName','atlasPrefix','thumbnailDirectory'])document.getElementById(field).value='';
  document.getElementById('syncInstalledBanners').checked=!!config.syncInstalledBanners;
}
export function readSettings(){
  const result={};for(const field of settingFields){const value=document.getElementById(field).value.trim();result[field]=lists.has(field)?value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean):value;}
  result.syncInstalledBanners=document.getElementById('syncInstalledBanners').checked;return result;
}
export function setupSettingsBrowse(){
  const host=window.chrome?.webview;
  for(const button of document.querySelectorAll('[data-browse]')){
    button.hidden=!host||button.dataset.kind==='none';
    button.onclick=()=>host.postMessage({type:'browse-path',field:button.dataset.browse,kind:button.dataset.kind||'folder',current:document.getElementById(button.dataset.browse).value});
  }
  host?.addEventListener('message',event=>{
    if(event.data?.type!=='selected-path'||!settingFields.includes(event.data.field)||typeof event.data.path!=='string')return;
    document.getElementById(event.data.field).value=event.data.path;
  });
}
