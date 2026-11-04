import {normalizeResourceSettings} from './resource-settings.mjs';
export const settingFields=['modulePath','gamePath','moduleName','installedModulePath','bannerIconsFile','nativeBannerIconsFile','bannerDefinitionPaths','atlasSourceDirectory','thumbnailDirectory','nativeAssetDirectory','assetPackagePaths','atlasPrefix','dataDirectory'];
const lists=new Set(['bannerDefinitionPaths','assetPackagePaths']);
const $=id=>document.getElementById(id);
let resourceMaterials=[];
const flagLines=value=>value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean);
function resourceControls(){
 $('resourceTextureFlags').disabled=!$('resourceTextureOverride').checked;
 for(const id of ['resourceBlendMode','resourceAlphaTest','resourceMaterialFlags','resourceShaderFlags','resourceVertexFlags'])$(id).disabled=!$('resourceMaterialOverride').checked;
 $('resourceQuality').disabled=$('resourceAtlasFormat').value==='rgba8'&&$('resourceGuiFormat').value==='rgba8';
 $('resourceCopyTemplate').disabled=!resourceMaterials.length;
 const size=Number($('resourceNewAtlasSize').value);$('resourceResolutionHelp').textContent='New PSD: '+size+'×'+size+' with '+size/4+'×'+size/4+' cells. Compiled resolution preserves the original source artwork and slot positions.';
}
function fillResourceSettings(config){
 const s=normalizeResourceSettings(config.resourceSettings);
 for(const [id,value] of Object.entries({resourceNewAtlasSize:s.newAtlasSize,resourceAtlasSize:s.atlasSize,resourceAtlasFormat:s.atlasFormat,resourceGuiFormat:s.guiFormat,resourceQuality:s.quality,resourceBlendMode:s.material.blendMode,resourceAlphaTest:s.material.alphaTest}))$(id).value=String(value);
 $('resourceMipmaps').checked=s.mipmaps;$('resourceTextureOverride').checked=s.textureFlags!==null;$('resourceTextureFlags').value=(s.textureFlags||[]).join('\n');$('resourceMaterialOverride').checked=s.material.override;
 for(const [id,value] of Object.entries({resourceMaterialFlags:s.material.flags,resourceShaderFlags:s.material.shaderFlags,resourceVertexFlags:s.material.vertexFlags}))$(id).value=value.join('\n');
 const select=$('resourceMaterialTemplate');if(s.material.template&&![...select.options].some(o=>o.value===s.material.template)){const option=document.createElement('option');option.value=s.material.template;option.textContent=s.material.template+' (saved)';select.append(option);}select.value=s.material.template;
 for(const id of ['resourceNewAtlasSize','resourceAtlasFormat','resourceGuiFormat','resourceTextureOverride','resourceMaterialOverride'])$(id).onchange=resourceControls;
 $('resourceCopyTemplate').onclick=()=>{const chosen=resourceMaterials.find(m=>m.name===$('resourceMaterialTemplate').value)||resourceMaterials[0];if(!chosen)return;$('resourceMaterialOverride').checked=true;$('resourceBlendMode').value=chosen.blendMode;$('resourceAlphaTest').value=chosen.alphaTest;for(const [id,value] of Object.entries({resourceMaterialFlags:chosen.flags,resourceShaderFlags:chosen.shaderFlags,resourceVertexFlags:chosen.vertexFlags}))$(id).value=value.join('\n');resourceControls();};
 resourceControls();
}
export async function refreshResourceOptions(api){
 resourceMaterials=(await api('/api/resource-options')).materials;const select=$('resourceMaterialTemplate'),saved=select.value;select.replaceChildren();const keep=document.createElement('option');keep.value='';keep.textContent='Keep existing · module default for new materials';select.append(keep);
 for(const material of resourceMaterials){const option=document.createElement('option');option.value=material.name;option.textContent=material.name;select.append(option);}
 if(saved&&!resourceMaterials.some(m=>m.name===saved)){const option=document.createElement('option');option.value=saved;option.textContent=saved+' (unavailable in loaded module)';select.append(option);}select.value=saved;resourceControls();
}
function readResourceSettings(){return normalizeResourceSettings({newAtlasSize:Number($('resourceNewAtlasSize').value),atlasSize:Number($('resourceAtlasSize').value),atlasFormat:$('resourceAtlasFormat').value,guiFormat:$('resourceGuiFormat').value,quality:$('resourceQuality').value,mipmaps:$('resourceMipmaps').checked,textureFlags:$('resourceTextureOverride').checked?flagLines($('resourceTextureFlags').value):null,material:{template:$('resourceMaterialTemplate').value,override:$('resourceMaterialOverride').checked,blendMode:$('resourceBlendMode').value,alphaTest:Number($('resourceAlphaTest').value),flags:flagLines($('resourceMaterialFlags').value),shaderFlags:flagLines($('resourceShaderFlags').value),vertexFlags:flagLines($('resourceVertexFlags').value)}});}
export function fillSettings(config,{firstRun=false}={}){
  for(const field of settingFields){const input=document.getElementById(field);input.value=lists.has(field)?(config[field]||[]).join('\n'):config[field]||'';}
  if(firstRun)for(const field of ['moduleName','atlasPrefix','thumbnailDirectory'])document.getElementById(field).value='';
  document.getElementById('syncInstalledBanners').checked=!!config.syncInstalledBanners;
  fillResourceSettings(config);
}
export function readSettings(){
  const result={};for(const field of settingFields){const value=document.getElementById(field).value.trim();result[field]=lists.has(field)?value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean):value;}
  result.syncInstalledBanners=document.getElementById('syncInstalledBanners').checked;result.resourceSettings=readResourceSettings();return result;
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
