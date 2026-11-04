export function setupValidationUI({api,getLibrary,openAtlas,openBanner,onRefreshed=async()=>{}}){
  const $=id=>document.getElementById(id);let report=null,busy=false,workspace=null;
  function draw(){
    const counts=report?.counts;$('validationSummary').textContent=counts?`${counts.errors} errors · ${counts.warnings} warnings · ${counts.info} notes · ${report.checked.symbols} symbols / ${report.checked.atlases} atlases`:'Check XML, IDs, references, textures, PSDs, GUI thumbnails and artwork alignment.';
    $('validationResults').replaceChildren();const severity=$('validationSeverity').value,query=$('validationSearch').value.toLowerCase();
    const items=(report?.issues||[]).filter(i=>(severity==='all'||i.severity===severity)&&JSON.stringify(i).toLowerCase().includes(query));
    for(const issue of items){
      const row=document.createElement('article');row.className='validation-issue '+issue.severity;
      const kind=document.createElement('span');kind.className='issue-kind';kind.textContent=issue.severity+' · '+issue.code;
      const message=document.createElement('strong');message.textContent=issue.message;const context=document.createElement('small');context.textContent=[issue.material,issue.iconId!==undefined?'Icon #'+issue.iconId:null,issue.slot!==undefined?'Slot '+issue.slot:null,issue.source].filter(Boolean).join(' · ');
      row.append(kind,message,context);if(issue.banners){const affected=document.createElement('p');affected.className='muted';affected.textContent=issue.banners.slice(0,6).map(b=>b.name).join(', ')+(issue.banners.length>6?' …':'');row.append(affected);}
      const actions=document.createElement('div');actions.className='issue-actions';
      if(issue.material){const button=document.createElement('button');button.textContent='Open atlas';button.onclick=async()=>{$('validationDialog').close();await openAtlas(issue.material,issue.slot);};actions.append(button);}
      if(issue.bannerKey){const button=document.createElement('button');button.textContent='Open banner';button.onclick=()=>{if(openBanner(issue.bannerKey))$('validationDialog').close();};actions.append(button);}
      row.append(actions);$('validationResults').append(row);
    }
    if(report&&!items.length){const empty=document.createElement('p');empty.className='empty-state';empty.textContent=report.issues.length?'No issues match this filter.':'No issues found in the checked assets.';$('validationResults').append(empty);}
    $('validationExportButton').disabled=!report||busy;$('validationRunButton').disabled=busy;$('validationRunButton').textContent=busy?'Checking assets…':'Run validation';
  }
  async function run(){if(busy)return;busy=true;$('validationStatus').textContent='Reading module files and inspecting atlas pixels. No module files are changed.';draw();try{const next=await api('/api/validation',{});await onRefreshed();report=next;workspace=report.workspaceId;$('validationStatus').textContent='Checked '+new Date(report.checkedAt).toLocaleString()+'. Existing issues are reported without modifying their data.';}catch(error){$('validationStatus').textContent=error.message;}finally{busy=false;draw();}}
  $('validationButton').onclick=async()=>{if(workspace!==getLibrary().workspaceId){report=null;workspace=getLibrary().workspaceId;}$('validationDialog').showModal();draw();if(!report)await run();};
  $('validationRunButton').onclick=run;$('closeValidationButton').onclick=()=>$('validationDialog').close();$('validationSeverity').onchange=$('validationSearch').oninput=draw;
  $('validationExportButton').onclick=()=>{if(!report)return;const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='asset-validation-'+report.moduleName.replace(/[^a-z0-9_-]/gi,'_')+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  return {invalidate(){report=null;$('validationStatus').textContent='Assets changed. Run validation again for an updated report.';}};
}
