import {decode,encode,defaultBanner} from './banner-code.mjs';
import {BannerRenderer} from './renderer.mjs';
import {setupAtlasUI} from './atlas-ui.mjs';
import {BANNER_SIZE,canvasToBanner} from './banner-space.mjs';
const $=id=>document.getElementById(id);
const clone=x=>structuredClone(x);
const state={library:null,renderer:null,layers:defaultBanner(),selected:1,entry:null,draft:null,baseline:'',history:[],future:[],kind:'all',tab:'symbols',shape:'square',colorTarget:'colorId',span:BANNER_SIZE,drag:null};
let toastTimer;
function toast(message,error=false){$('toast').textContent=message;$('toast').classList.toggle('error',error);$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,error?9000:4500);}
async function api(url,data){const response=await fetch(url,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Editor-Token':state.library.token},body:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw new Error(result.error||'Request failed.');return result;}
function currentCode(){return encode(state.layers);}
function dirty(){return currentCode()!==state.baseline;}
function checkpoint(){state.history.push({layers:clone(state.layers),selected:state.selected});if(state.history.length>150)state.history.shift();state.future=[];}
function changed(){try{localStorage.setItem('taom-banner-recovery',JSON.stringify({code:currentCode(),sourceKey:state.entry?.key,name:state.draft?.name||state.entry?.name||'Untitled banner'}));}catch{} render();}
function edit(fn){checkpoint();fn();changed();}
function selected(){return state.layers[state.selected];}
function newLayer(id=10000){return {meshId:id,colorId:selected()?.colorId??172,colorId2:selected()?.colorId2??171,width:500,height:500,x:764,y:764,stroke:0,mirror:0,rotation:0};}
function addLayer(id){if(state.layers.length>=33){toast('The game supports 32 symbol layers plus a background.',true);return;}edit(()=>{state.layers.push(newLayer(id));state.selected=state.layers.length-1;});}
function title(){return state.draft?.name||state.entry?.name||'Untitled banner';}
function setBanner(entry,draft=null){state.entry=entry;state.draft=draft;state.layers=decode(draft?.code||entry?.code||encode(defaultBanner()));state.selected=Math.min(1,state.layers.length-1);state.baseline=currentCode();state.history=[];state.future=[];try{localStorage.setItem('taom-banner-recovery',JSON.stringify({code:currentCode(),sourceKey:entry?.key,name:draft?.name||entry?.name||'Untitled banner'}));}catch{}renderLibrary();render();}
function permitNavigation(){return !dirty()||confirm('This banner has unsaved edits. Switch banners and discard these edits?');}
const thumbObserver=new IntersectionObserver(entries=>{for(const {isIntersecting,target} of entries)if(isIntersecting){thumbObserver.unobserve(target);target._draw?.();}},{rootMargin:'80px'});
function thumbnail(canvas,layers,options={}){canvas.width=96;canvas.height=96;canvas._draw=()=>state.renderer.render(canvas,layers,{shape:'shield',...options}).catch(()=>{});thumbObserver.observe(canvas);}
function clearThumbnails(container){container.querySelectorAll('canvas').forEach(c=>thumbObserver.unobserve(c));container.replaceChildren();}
function renderLibrary(){
  const query=$('librarySearch').value.toLowerCase();
  const items=state.kind==='drafts'?state.drafts:state.library.banners.filter(b=>state.kind==='all'||b.kind===state.kind);
  const filtered=items.filter(b=>(b.name+' '+b.id+' '+(b.culture||'')).toLowerCase().includes(query));
  $('libraryCount').textContent=filtered.length+' '+(state.kind==='drafts'?'saved drafts':'banners in module');
  clearThumbnails($('bannerList'));
  for(const item of filtered){
    const isDraft=state.kind==='drafts',button=document.createElement('button');button.className='banner-item';
    button.classList.toggle('active',isDraft?state.draft?.id===item.id:state.entry?.key===item.key&&!state.draft);
    const canvas=document.createElement('canvas');const text=document.createElement('span');text.className='item-info';
    const name=document.createElement('strong');name.textContent=item.name;const sub=document.createElement('small');sub.textContent=isDraft?'Draft · '+new Date(item.savedAt).toLocaleDateString():item.kind+' · '+item.id;
    text.append(name,sub);button.append(canvas,text);button.title=item.name+'\n'+(item.source||'Local draft');
    button.onclick=()=>{if(!permitNavigation())return;setBanner(isDraft?state.library.banners.find(b=>b.key===item.sourceKey)||null:item,isDraft?item:null);};
    $('bannerList').append(button);thumbnail(canvas,decode(item.code));
  }
  if(!filtered.length){const empty=document.createElement('div');empty.className='empty-state';empty.textContent=state.kind==='drafts'?'Your saved drafts will appear here.':'No matching banners.';$('bannerList').append(empty);}
}
function renderLayers(){
  clearThumbnails($('layersList'));$('layerTotal').textContent=state.layers.length;
  state.layers.map((layer,index)=>({layer,index})).reverse().forEach(({layer,index})=>{
    const button=document.createElement('button');button.className='layer-row'+(index===state.selected?' active':'');button.title=index===0?'Background pattern':'Select symbol layer '+index;
    const canvas=document.createElement('canvas');const name=document.createElement('span');name.textContent=index===0?'Background':'Symbol '+index;
    const id=document.createElement('small');id.textContent='#'+layer.meshId;button.append(canvas,name,id);
    button.onclick=()=>{state.selected=index;render();};$('layersList').append(button);
    if(index===0)thumbnail(canvas,[layer],{shape:'square'});
    else thumbnail(canvas,[{...state.layers[0],meshId:11,colorId:2001,colorId2:2001}, {...layer,width:450,height:450,x:764,y:764,rotation:0}],{shape:'square',span:512});
  });
  const background=state.selected===0;
  for(const id of ['duplicateButton','deleteButton'])$(id).disabled=background;
  $('backwardButton').disabled=state.selected<=1;$('forwardButton').disabled=background||state.selected>=state.layers.length-1;
  $('addLayerButton').disabled=state.layers.length>=33;
}
function renderInspector(){
  const l=selected(),bg=state.selected===0;
  $('selectedTitle').textContent=bg?'BACKGROUND PROPERTIES':'LAYER '+state.selected+' PROPERTIES';$('selectedName').textContent=bg?'Background':'Symbol '+state.selected;$('selectedId').textContent='#'+l.meshId;
  for(const field of ['meshId','x','y','width','height','rotation'])$(field).value=l[field];
  $('rotationValue').textContent=l.rotation+'°';$('stroke').checked=!!l.stroke;$('stroke').disabled=bg;
  $('mirrorButton').classList.toggle('active',!!l.mirror);
  $('mainColorPreview').style.background=state.renderer.color(l.colorId);$('secondColorPreview').style.background=state.renderer.color(l.colorId2);
  $('mainColorId').textContent='#'+l.colorId;
  $('secondColorText').replaceChildren(document.createTextNode(bg?'Secondary':'Outline'));
  const small=document.createElement('small');small.id='secondColorId';small.textContent='#'+l.colorId2;$('secondColorText').append(small);
  $('saveSourceButton').disabled=!state.entry;$('dirtyLabel').textContent=dirty()?'Unsaved changes':'Saved';$('dirtyLabel').classList.toggle('dirty',dirty());
  $('undoButton').disabled=!state.history.length;$('redoButton').disabled=!state.future.length;
  $('documentName').textContent=title();$('documentKind').textContent=state.draft?'LOCAL DRAFT':state.entry?state.entry.kind.toUpperCase()+' BANNER':'NEW COMPOSITION';
  $('layerCounter').textContent=(state.layers.length-1)+' / 32 symbol layers';
  $('statusText').textContent=state.entry?.source||'New banner · save a draft or export its banner code';
  const missing=state.layers.flatMap((l,i)=>{
    const issues=[];
    if(i===0&&!state.renderer.backgrounds.has(l.meshId))issues.push('Background #'+l.meshId);
    if(i>0){const icon=state.renderer.icons.get(l.meshId);const tex=state.library.assets.textures[state.library.assets.materials[icon?.material]?.slots?.['0']];if(!tex?.images?.length)issues.push('Symbol #'+l.meshId);}
    for(const id of [l.colorId,l.colorId2])if(!state.renderer.colors.has(id))issues.push('Colour #'+id);
    return issues;
  });
  if(state.layers.length>33)missing.push('More than 32 symbols');
  $('previewWarning').hidden=!missing.length;$('previewWarning').textContent='Preview unavailable for: '+[...new Set(missing)].join(', ')+'. The banner code is preserved.';
  document.querySelectorAll('.asset-tile').forEach(b=>b.classList.toggle('active',Number(b.dataset.id)===l.meshId));
}
function drawPreview(){return state.renderer.render($('preview'),state.layers,{span:state.span,shape:state.shape,guides:$('guidesToggle').checked,selected:state.selected===0?-1:state.selected}).catch(e=>toast(e.message,true));}
function render(){renderLayers();renderInspector();drawPreview();}
function renderAssets(){
  const pattern=state.tab==='patterns';const group=$('groupSelect').value;const query=$('symbolSearch').value.toLowerCase();
  const items=(pattern?state.library.backgrounds:state.library.icons).filter(i=>{
    const category=pattern||group==='all'||group==='taom'&&i.source==='TAOM'||group==='native'&&i.source==='Native'||Number(group)===i.group;
    return category&&(String(i.id)+' '+i.name+' '+(i.material||'')).toLowerCase().includes(query);
  });
  $('assetCount').textContent=items.length+' available';clearThumbnails($('assetGrid'));
  for(const item of items){
    const button=document.createElement('button');button.className='asset-tile';button.dataset.id=item.id;button.classList.toggle('active',selected().meshId===item.id);button.title=pattern?'Background pattern '+item.id:item.name+'\n'+item.material+' · tile '+item.index;
    const canvas=document.createElement('canvas'),small=document.createElement('small');small.textContent=item.id;button.append(canvas,small);$('assetGrid').append(button);
    button.onclick=event=>{
      if(pattern){edit(()=>{state.layers[0].meshId=item.id;state.selected=0;});}
      else if(event.shiftKey||state.selected===0)addLayer(item.id);else edit(()=>selected().meshId=item.id);
    };
    const base={...state.layers[0],meshId:11,colorId:2001,colorId2:2001,width:1528,height:1528,x:764,y:764,rotation:0,mirror:0};
    const icon={meshId:item.id,colorId:172,colorId2:171,width:490,height:490,x:764,y:764,rotation:0,mirror:0,stroke:0};
    thumbnail(canvas,pattern?[{...base,meshId:item.id,colorId:149,colorId2:172}]:[base,icon],{shape:'square',span:512});
  }
}
function setupGroups(){
  $('groupSelect').replaceChildren();
  for(const [value,label] of [['taom','All TAOM symbols'],['native','All native symbols'],['all','All symbols'],...state.library.groups.filter(g=>!g.pattern).sort((a,b)=>b.source.localeCompare(a.source)).map(g=>[String(g.id),g.name])]){
    const option=document.createElement('option');option.value=value;option.textContent=label;$('groupSelect').append(option);
  }
}
function renderPalette(){
  const q=$('colorSearch').value.toLowerCase();$('paletteGrid').replaceChildren();
  for(const color of state.library.colors.filter(c=>(String(c.id)+' '+c.hex).toLowerCase().includes(q))){
    const button=document.createElement('button');button.className='swatch';button.style.background=color.hex;button.title='Palette '+color.id+' · '+color.hex;button.setAttribute('aria-label',button.title);button.classList.toggle('active',selected()[state.colorTarget]===color.id);
    button.onmouseenter=()=>$('paletteFooter').textContent='Palette #'+color.id+' · '+color.hex.toUpperCase();
    button.onclick=()=>{edit(()=>selected()[state.colorTarget]=color.id);$('colorDialog').close();};$('paletteGrid').append(button);
  }
  $('paletteFooter').textContent=state.library.colors.length+' colours from Native + TAOM';
}
function openColors(target){state.colorTarget=target;$('paletteTitle').textContent='Choose '+(target==='colorId'?'primary colour':state.selected===0?'secondary colour':'outline colour');$('colorSearch').value='';renderPalette();$('colorDialog').showModal();}
function quickPalette(){
  $('quickPalette').replaceChildren();
  const ids=[2001,149,172,171,2002,2006,2008,2010,2012,2014,12,4,118,120,121,119,76,53,101,35];
  for(const id of ids){if(!state.renderer.colors.has(id))continue;const b=document.createElement('button');b.className='swatch';b.style.background=state.renderer.color(id);b.title='Set primary colour · #'+id;b.setAttribute('aria-label',b.title);b.onclick=()=>edit(()=>selected().colorId=id);$('quickPalette').append(b);}
}
async function loadData(preserve=true){
  const key=state.entry?.key;
  const [library,drafts]=await Promise.all([api('/api/library'),api('/api/drafts')]);state.library=library;state.drafts=drafts;state.renderer=new BannerRenderer(library);
  $('sourceBadge').textContent='TAOM · '+(library.config.modulePath.match(/v[\d.]+/)?.[0]||'DEV')+' · LIVE SOURCE';$('moduleLabel').textContent=library.config.modulePath.replaceAll('\\','/').split('/').slice(-2).join(' / ');$('sourceVersion').textContent=library.icons.length+' SYMBOLS · '+library.colors.length+' COLOURS';$('symbolCount').textContent=library.icons.length;
  $('modulePath').value=library.config.modulePath;$('gamePath').value=library.config.gamePath;
  $('assetErrors').textContent=library.assets.errors.join('\n');
  setupGroups();quickPalette();
  const initial=preserve&&key?library.banners.find(b=>b.key===key):library.banners.find(b=>b.kind==='Kingdom'&&/gondor/i.test(b.name))||library.banners.find(b=>b.kind==='Kingdom')||library.banners[0];
  setBanner(initial||null);renderAssets();
}
function undo(){if(!state.history.length)return;state.future.push({layers:clone(state.layers),selected:state.selected});Object.assign(state,state.history.pop());changed();}
function redo(){if(!state.future.length)return;state.history.push({layers:clone(state.layers),selected:state.selected});Object.assign(state,state.future.pop());changed();}
function duplicate(){if(!state.selected)return;if(state.layers.length>=33)return toast('Maximum of 32 symbol layers.',true);edit(()=>{const l=clone(selected());l.x+=12;l.y+=12;state.layers.splice(state.selected+1,0,l);state.selected++;});}
function remove(){if(!state.selected)return;edit(()=>{state.layers.splice(state.selected,1);state.selected=Math.min(state.selected,state.layers.length-1);});}
function bind(){
  setupAtlasUI({api,getLibrary:()=>state.library,onInstalled:async()=>{
    // Refresh the available symbols without replacing the composition being edited.
    const group=$('groupSelect').value;
    state.library=await api('/api/library');state.renderer=new BannerRenderer(state.library);
    $('symbolCount').textContent=state.library.icons.length;
    $('sourceVersion').textContent=state.library.icons.length+' SYMBOLS · '+state.library.colors.length+' COLOURS';
    setupGroups();if([...$('groupSelect').options].some(option=>option.value===group))$('groupSelect').value=group;
    renderAssets();renderLibrary();render();
  }});
  $('librarySearch').oninput=renderLibrary;$('symbolSearch').oninput=renderAssets;$('groupSelect').onchange=renderAssets;
  $('libraryTabs').onclick=e=>{const b=e.target.closest('button');if(!b)return;state.kind=b.dataset.kind;document.querySelectorAll('#libraryTabs button').forEach(x=>x.classList.toggle('active',x===b));renderLibrary();};
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===b));$('groupSelect').hidden=state.tab==='patterns';renderAssets();});
  document.querySelectorAll('[data-shape]').forEach(b=>b.onclick=()=>{state.shape=b.dataset.shape;document.querySelectorAll('[data-shape]').forEach(x=>x.classList.toggle('active',x===b));drawPreview();});
  $('viewSelect').onchange=()=>{state.span=Number($('viewSelect').value);drawPreview();};$('guidesToggle').onchange=drawPreview;
  for(const field of ['meshId','x','y','width','height'])$(field).oninput=$(field).onchange=event=>{
    if($(field).value===''||Number($(field).value)===selected()[field])return;
    const value=Number($(field).value);if(!Number.isInteger(value)||Math.abs(value)>2147483647){if(event.type==='input')return;toast('Enter a valid whole number.',true);renderInspector();return;}
    if(['width','height'].includes(field)&&(!value||Math.abs(value)>8000)){if(event.type==='input')return;toast('Size must be between −8000 and 8000, excluding zero.',true);renderInspector();return;}
    const candidate=field==='meshId'?(state.selected===0?state.renderer.backgrounds:state.renderer.icons):null;
    if(candidate&&!candidate.has(value)){if(event.type==='input')return;toast('This ID is not registered in the module.',true);renderInspector();return;}
    edit(()=>{if((field==='width'||field==='height')&&$('lockRatio').checked){const other=field==='width'?'height':'width';selected()[other]=Math.round(selected()[other]*value/(selected()[field]||1));}selected()[field]=value;});
  };
  $('stroke').onchange=()=>edit(()=>selected().stroke=Number($('stroke').checked));
  $('rotation').onpointerdown=checkpoint;$('rotation').onkeydown=e=>{if(e.key.startsWith('Arrow'))checkpoint();};$('rotation').oninput=()=>{selected().rotation=Number($('rotation').value);changed();};
  $('mirrorButton').onclick=()=>edit(()=>selected().mirror=1-selected().mirror);$('centerButton').onclick=()=>edit(()=>{selected().x=764;selected().y=764;});$('rotateButton').onclick=()=>edit(()=>selected().rotation=(selected().rotation+90)%360);
  $('mainColorButton').onclick=()=>openColors('colorId');$('secondColorButton').onclick=()=>openColors('colorId2');$('closeColorsButton').onclick=()=>$('colorDialog').close();$('colorSearch').oninput=renderPalette;
  $('undoButton').onclick=undo;$('redoButton').onclick=redo;$('duplicateButton').onclick=duplicate;$('deleteButton').onclick=remove;$('addLayerButton').onclick=()=>addLayer();
  for(const [id,delta]of [['backwardButton',-1],['forwardButton',1]])$(id).onclick=()=>edit(()=>{const next=state.selected+delta;[state.layers[next],state.layers[state.selected]]=[state.layers[state.selected],state.layers[next]];state.selected=next;});
  $('newButton').onclick=()=>{if(permitNavigation())setBanner(null);};
  $('codeButton').onclick=()=>{$('codeText').value=currentCode();$('codeDialog').showModal();};
  $('copyCodeButton').onclick=async()=>{try{await navigator.clipboard.writeText($('codeText').value);toast('Banner code copied.');}catch{$('codeText').select();toast('Press Ctrl+C to copy the selected code.');}};
  $('importCodeButton').onclick=()=>{try{const layers=decode($('codeText').value);checkpoint();state.layers=layers;state.selected=Math.min(1,layers.length-1);changed();$('codeDialog').close();toast('Banner code imported.');}catch(e){toast(e.message,true);}};
  $('exportButton').onclick=async()=>{try{const canvas=document.createElement('canvas');canvas.width=1536;canvas.height=1536;await state.renderer.render(canvas,state.layers,{span:state.span,shape:state.shape});const result=await api('/api/export',{name:title(),png:canvas.toDataURL('image/png')});const a=document.createElement('a');a.download=result.name;a.href=result.url;a.click();toast('PNG saved: '+result.path);}catch(error){toast(error.message,true);}};
  $('saveDraftButton').onclick=()=>{$('draftName').value=title();$('nameDialog').showModal();$('draftName').select();};$('cancelDraftButton').onclick=()=>$('nameDialog').close();
  $('draftForm').onsubmit=async e=>{e.preventDefault();try{const draft=await api('/api/drafts',{id:state.draft?.id,name:$('draftName').value,code:currentCode(),sourceKey:state.entry?.key});state.draft=draft;state.baseline=currentCode();state.drafts=await api('/api/drafts');$('nameDialog').close();renderLibrary();render();toast('Draft saved.');}catch(error){toast(error.message,true);}};
  $('saveSourceButton').onclick=()=>{$('saveDescription').textContent='Update the banner for '+state.entry.name+'?';$('saveDetails').textContent=state.entry.source+'\n'+state.entry.tag+' · '+state.entry.id+'\n'+state.entry.attribute+' · '+state.layers.length+' layers';$('saveDialog').showModal();};
  for(const id of ['cancelSaveButton','closeSaveButton'])$(id).onclick=()=>$('saveDialog').close();
  $('confirmSaveButton').onclick=async()=>{const b=$('confirmSaveButton');b.disabled=true;try{const result=await api('/api/save-source',{key:state.entry.key,code:currentCode(),expectedCode:state.entry.code});state.entry.code=currentCode();state.baseline=currentCode();$('saveDialog').close();render();toast(result.unchanged?'Banner is already up to date.':'Banner saved to module. Original XML backed up.');}catch(error){toast(error.message,true);}finally{b.disabled=false;}};
  $('settingsButton').onclick=()=>$('settingsDialog').showModal();
  async function busy(button,fn){const label=button.textContent;button.disabled=true;button.textContent='Working…';try{await fn();toast('Module assets refreshed.');}catch(e){toast(e.message,true);}finally{button.disabled=false;button.textContent=label;}}
  $('rebuildButton').onclick=()=>{if(!permitNavigation())return;busy($('rebuildButton'),async()=>{await api('/api/refresh',{extract:true});await loadData();$('settingsDialog').close();});};
  $('applySettingsButton').onclick=()=>{if(!permitNavigation())return;busy($('applySettingsButton'),async()=>{await api('/api/config',{modulePath:$('modulePath').value,gamePath:$('gamePath').value});await loadData(false);$('settingsDialog').close();});};
  $('reloadButton').onclick=()=>{if(!permitNavigation())return;busy($('reloadButton'),async()=>{await api('/api/refresh',{});await loadData();});};
  const preview=$('preview');
  const point=e=>{const r=preview.getBoundingClientRect();return canvasToBanner(e.clientX-r.left,e.clientY-r.top,r.width,r.height,state.span);};
  preview.onpointerdown=e=>{if(e.button!==0)return;const p=point(e);let index=-1;for(let i=state.layers.length-1;i>0;i--)if(state.renderer.hit(state.layers[i],p.x,p.y)){index=i;break;}if(index<0){state.selected=0;render();return;}state.selected=index;checkpoint();state.drag={start:p,x:selected().x,y:selected().y};preview.setPointerCapture(e.pointerId);preview.focus();render();};
  preview.onpointermove=e=>{if(!state.drag)return;const p=point(e);selected().x=Math.round(state.drag.x+p.x-state.drag.start.x);selected().y=Math.round(state.drag.y+p.y-state.drag.start.y);changed();};
  preview.onpointerup=preview.onpointercancel=()=>{state.drag=null;};
  preview.addEventListener('wheel',e=>{if(state.selected===0)return;e.preventDefault();const factor=e.deltaY<0?1.05:1/1.05;edit(()=>{for(const key of ['width','height'])selected()[key]=Math.max(1,Math.min(8000,Math.round(selected()[key]*factor)));});},{passive:false});
  document.addEventListener('keydown',e=>{
    if(e.target.matches('input,textarea,select')||document.querySelector('dialog[open]'))return;
    const ctrl=e.ctrlKey||e.metaKey;if(ctrl&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();}else if(ctrl&&e.key.toLowerCase()==='y'){e.preventDefault();redo();}else if(ctrl&&e.key.toLowerCase()==='d'){e.preventDefault();duplicate();}else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();remove();}else if(e.key.startsWith('Arrow')){e.preventDefault();const step=e.shiftKey?10:1;edit(()=>{if(e.key==='ArrowLeft')selected().x-=step;if(e.key==='ArrowRight')selected().x+=step;if(e.key==='ArrowUp')selected().y-=step;if(e.key==='ArrowDown')selected().y+=step;});}
  });
  window.addEventListener('beforeunload',e=>{if(dirty()){e.preventDefault();e.returnValue='';}});
}
try{let recovered=null;try{recovered=JSON.parse(localStorage.getItem('taom-banner-recovery')||'null');}catch{}await loadData(false);bind();if(recovered&&recovered.code!==state.library.banners.find(b=>b.key===recovered.sourceKey)?.code){const entry=state.library.banners.find(b=>b.key===recovered.sourceKey);setBanner(entry||null,{name:recovered.name,code:recovered.code});state.baseline=entry?.code||encode(defaultBanner());render();toast('Recovered your last editing session.');}}catch(error){$('documentName').textContent='Could not load the module';$('statusText').textContent=error.message;toast(error.message,true);}
