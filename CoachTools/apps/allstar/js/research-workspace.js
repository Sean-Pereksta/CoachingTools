/* Additive Research workspace controls. Classic script; no server or external assets.
 * Existing Research definitions, controls, and saved keys remain authoritative. */
'use strict';
(function (root) {
  const DRAFT_KEY='allstar.research.editorDraft.v1', FILTER_KEY='allstar.research.filterSets.v1';
  const copy=value=>JSON.parse(JSON.stringify(value));
  const normalize=value=>String(value??'').trim().toLowerCase();
  const safeText=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const EXTRA_OPS=['starts with','ends with','is blank','is not blank','in list','not in list'];
  const METRIC_MODES=[['median','Median'],['min','Minimum'],['max','Maximum'],['distinct','Distinct count'],['formula','Calculated formula']];
  function editHistory(limit=40){
    let values=[],position=-1;
    return {
      reset(value){values=[JSON.stringify(value)];position=0;},
      push(value){const encoded=JSON.stringify(value);if(values[position]===encoded)return false;values=values.slice(0,position+1);values.push(encoded);if(values.length>limit)values.shift();position=values.length-1;return true;},
      undo(){if(position>0)position--;return position>=0?JSON.parse(values[position]):null;},
      redo(){if(position<values.length-1)position++;return position>=0?JSON.parse(values[position]):null;},
      get canUndo(){return position>0;},get canRedo(){return position<values.length-1;}
    };
  }
  function searchFields(entries,query,limit=60){
    const terms=normalize(query).split(/\s+/).filter(Boolean);
    return entries.map((entry,index)=>({entry,index,text:normalize([entry.label,entry.detail,entry.value,entry.group].join(' '))}))
      .filter(row=>terms.every(term=>row.text.includes(term)))
      .sort((a,b)=>(normalize(b.entry.label).startsWith(normalize(query))?1:0)-(normalize(a.entry.label).startsWith(normalize(query))?1:0)||a.index-b.index)
      .slice(0,limit).map(row=>row.entry);
  }
  function formulaOperand(field,aggregation='sum'){
    const value=String(field||'').trim();
    if(!value)throw new Error('Choose both measures before creating a formula.');
    if(/^[-+]?\d+(?:\.\d+)?$/.test(value))return value;
    if(/^(@|model\(|measure\()/i.test(value))return '('+value+')';
    const token=/^(?:!\[|\[)/.test(value)?value:'['+value+']';
    return ['sum','avg','min','max','count','unique'].includes(aggregation)?aggregation+'('+token+')':token;
  }
  function buildFormula(operation,left,right,aggregation='sum'){
    const a=formulaOperand(left,aggregation),b=formulaOperand(right,aggregation);
    const expressions={ratio:`(${a}) / (${b})`,percentage:`((${a}) / (${b})) * 100`,difference:`(${a}) - (${b})`,points:`(${a}) - (${b})`,change:`(((${a}) - (${b})) / (${b})) * 100`,add:`(${a}) + (${b})`,multiply:`(${a}) * (${b})`};
    if(!expressions[operation])throw new Error('Select a supported calculation.');
    return expressions[operation];
  }
  function extraFilter(value,operator,expected){
    const actual=normalize(value), wanted=normalize(expected);
    if(operator==='is blank')return !actual;
    if(operator==='is not blank')return !!actual;
    if(operator==='starts with')return actual.startsWith(wanted);
    if(operator==='ends with')return actual.endsWith(wanted);
    if(operator==='in list'||operator==='not in list'){
      const values=Array.isArray(expected)?expected:String(expected??'').split(/[;,\n]/);
      const match=values.some(v=>normalize(v)===actual);return operator==='in list'?match:!match;
    }
    return undefined;
  }
  function numericMetric(values,mode){
    const present=values.filter(v=>v!=null&&String(v).trim()!=='');
    if(mode==='distinct')return new Set(present.map(v=>String(v).trim())).size;
    const numbers=present.map(v=>typeof toNum==='function'?toNum(v):Number(v)).filter(Number.isFinite);
    if(!numbers.length)return null;
    if(mode==='min')return numbers.reduce((a,b)=>Math.min(a,b),Infinity);
    if(mode==='max')return numbers.reduce((a,b)=>Math.max(a,b),-Infinity);
    numbers.sort((a,b)=>a-b);const middle=Math.floor(numbers.length/2);
    return numbers.length%2?numbers[middle]:(numbers[middle-1]+numbers[middle])/2;
  }
  function metricMetadata(metric={}){
    const result={};
    if(metric.displayFormat!==undefined)result.displayFormat=['number','percentage','ratio','points'].includes(metric.displayFormat)?metric.displayFormat:'number';
    if(metric.decimalPrecision!==undefined)result.decimalPrecision=Math.max(0,Math.min(6,Math.floor(Number(metric.decimalPrecision)||0)));
    if(metric.preferredDirection!==undefined)result.preferredDirection=['higher','lower','neutral'].includes(metric.preferredDirection)?metric.preferredDirection:'neutral';
    if(metric.target!==undefined)result.target=metric.target===''?'':(Number.isFinite(Number(metric.target))?Number(metric.target):'');
    if(metric.formula!==undefined)result.formula=String(metric.formula||'');
    return result;
  }
  const api={editHistory,searchFields,formulaOperand,buildFormula,extraFilter,numericMetric,metricMetadata};
  root.AllStarResearchWorkspace=api;
  if(typeof document==='undefined'||typeof state==='undefined')return;
  const byId=id=>document.getElementById(id);
  const history=editHistory(),metricStack=[];
  let baseline='',editingId='',restoring=false,captureTimer,initialized=false;
  let metricCycle=false,openedExisting=false;
  let canvasView='cards',focusedItemId='',itemFullscreenReturn=null,layoutPending=false;
  const fullscreenGlyph='<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M 7 3 H 3 V 7 M 13 3 H 17 V 7 M 3 13 V 17 H 7 M 17 13 V 17 H 13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
  function notice(message){const status=byId('rwSaveState');if(status)status.textContent=message;}
  function readStored(key,fallback){try{return JSON.parse(localStorage.getItem(key)||'null')||fallback;}catch(_){return fallback;}}
  function writeStored(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch(_){return false;}}
  function controlsSnapshot(){
    const controls={};byId('researchEditorModal')?.querySelectorAll('input[id],select[id],textarea[id]').forEach(input=>{
      if(input.id.startsWith('rw')||input.type==='file')return;
      controls[input.id]=input.multiple?[...input.options].filter(o=>o.selected).map(o=>o.value):(input.type==='checkbox'?input.checked:input.value);
    });
    const editing={};['editingResearchFilters','editingGuidedResearchConditions','editingResearchColumns','editingResearchPopulationScope','editingResearchPopulationFilterVersion','editingPercentBuilder','editingResearchGroupAxisItems','editingResearchGear','editingGuidedResearchActive'].forEach(key=>{if(state[key]!==undefined)editing[key]=copy(state[key]);});
    return {controls,editing};
  }
  function setControls(controls){Object.entries(controls||{}).forEach(([id,value])=>{const input=byId(id);if(!input)return;if(input.multiple&&Array.isArray(value))[...input.options].forEach(o=>o.selected=value.includes(o.value));else if(input.type==='checkbox')input.checked=!!value;else input.value=value??'';});}
  function restoreSnapshot(snapshot){
    if(!snapshot)return;restoring=true;
    try{
      Object.entries(snapshot.editing||{}).forEach(([key,value])=>state[key]=copy(value));setControls(snapshot.controls);
      renderResearchPopulationEditor();renderResearchFiltersEditor();renderResearchColumnsEditor();renderResearchGroupAxisItemsEditor();renderGuidedResearchConditions();
      renderPercentBuilderEditor(currentResearchItemFromEditor());updateResearchBuilderVisibility();setControls(snapshot.controls);
      renderResearchPopulationBehaviorEditor();updateGuidedResearchUi();refreshMode();refreshHealth();
    }finally{restoring=false;updateSaveState();}
  }
  function updateSaveState(){
    const snapshot=controlsSnapshot(),dirty=JSON.stringify(snapshot)!==baseline;
    notice(dirty?'Unsaved changes':(openedExisting?'Saved':'New analysis'));
    const undo=byId('rwUndo'),redo=byId('rwRedo');if(undo)undo.disabled=!history.canUndo;if(redo)redo.disabled=!history.canRedo;
    if(dirty){const ok=writeStored(DRAFT_KEY,{version:1,itemId:editingId,savedAt:Date.now(),snapshot});if(!ok)notice('Unsaved changes · draft could not be stored');}
  }
  function capture(){if(restoring||!byId('researchEditorModal')?.classList.contains('open'))return;syncResearchEditorStateFromDom();history.push(controlsSnapshot());updateSaveState();}
  function scheduleCapture(){clearTimeout(captureTimer);captureTimer=setTimeout(capture,180);}
  function refreshMode(mode){
    const editor=byId('researchEditorModal');if(!editor)return;
    const current=mode||editor.dataset.workspaceMode||(state.editingGuidedResearchActive?'guided':'advanced');editor.dataset.workspaceMode=current;
    editor.querySelectorAll('[data-rw-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.rwMode===current)));
    if(current==='advanced')editor.querySelectorAll('details.guidedAdvancedBlock').forEach(detail=>detail.open=true);
  }
  function setMode(mode){
    capture();
    // A presentation switch never regenerates columns or discards advanced configuration.
    // Guided editing becomes active only after the user edits a guided control.
    if(mode==='advanced')state.editingGuidedResearchActive=false;
    refreshMode(mode);scheduleCapture();
  }
  function refreshHealth(){
    const box=byId('rwHealthBody');if(!box)return;
    try{
      const item=currentResearchItemFromEditor(),health=typeof researchHealthCheck==='function'?researchHealthCheck(item):null;
      const source=typeof resolveDynamicResearchSource==='function'?resolveDynamicResearchSource(item):item.source;
      const count=(getRowsRaw(source)||[]).length;
      const rows=[{level:'information',text:`${count.toLocaleString()} source rows before population and date filters.`}];
      if(health)['blocking','warnings','information'].forEach(level=>(health[level]||[]).forEach(entry=>rows.push({level,text:typeof entry==='string'?entry:(entry.message||entry.label||JSON.stringify(entry))})));
      else if(!count)rows.push({level:'warnings',text:'No rows are loaded for this source. Update Data or choose another source.'});
      box.innerHTML=rows.slice(0,24).map(entry=>`<div class="rwHealthItem ${entry.level}"><strong>${entry.level==='blocking'?'Blocking':entry.level==='warnings'?'Warning':'Information'}</strong> ${safeText(entry.text)}</div>`).join('');
    }catch(error){box.textContent='Choose a source and measures to check this analysis. '+(error.message||error);}
  }
  function fieldEntries(input){
    const populationList=(input.getAttribute('data-header-list')||input.getAttribute('list'));
    if(populationList&&/Population|TeamFilter/.test(populationList))return [...(byId(populationList)?.querySelectorAll('option')||[])].map(o=>({label:o.label||o.value,value:o.value,group:/Org/.test(populationList)?'Organizations':/Rep/.test(populationList)?'Representatives':'Teams and coaches',detail:''}));
    const source=(input.dataset.gc?state.editingGuidedResearchConditions?.[Number(input.dataset.i)]?.source:'')||input.closest('[data-rw-formula-source]')?.dataset.rwFormulaSource||(input.closest('#metricEditorModal')?els.metricSourceSelect?.value:els.researchSource?.value);
    const entries=[],seen=new Set(),add=entry=>{if(!seen.has(entry.value)){seen.add(entry.value);entries.push(entry);}};
    const sources=concreteResearchSources().slice().sort((a,b)=>(a.value===source?-1:0)-(b.value===source?-1:0));
    sources.forEach(src=>(getResearchHeaders(src.value)||[]).forEach(header=>add({label:plainHeaderName(header),value:src.value===source?bracketedHeaderSuggestion(header):sourceQualifiedFieldSuggestion(src.value,header),group:/date|time|week|month|day/i.test(header)?'Dates':'Columns',detail:src.label})));
    (state.metrics||[]).forEach(metric=>add({label:metric.name,value:'@'+metric.name,group:metric.mode==='formula'?'Calculated fields':'Metrics',detail:labelSource(metric.source)+' · '+metric.mode}));
    if(!input.closest('.rwDialogBackdrop')&&typeof RESEARCH_TYPED_MEASURES!=='undefined')RESEARCH_TYPED_MEASURES.forEach(measure=>add({label:measure.label,value:researchMeasureRef(measure.id),group:'Metrics',detail:measure.category||'Built-in measure'}));
    (state.models||[]).forEach(model=>{add({label:model.name,value:`model(${JSON.stringify(model.name||model.id)})`,group:'Models',detail:'Whole model'});(model.criteria||[]).forEach(criterion=>add({label:criterion.name||criterion.id,value:`model(${JSON.stringify(model.name||model.id)},${JSON.stringify(criterion.name||criterion.id)})`,group:'Model criteria',detail:model.name}));});
    [['_rep','Representative'],['_team','Team / coach']].forEach(([value,label])=>add({label,value,group:'Identity fields',detail:'Normalized relationship'}));
    return entries;
  }
  function closePicker(){hideHeaderSuggestions();}
  function openPicker(input){if(input){input.dataset.rwField='';showHeaderSuggestions(input,headerAutocompleteContext(input));}}
  function filterSets(){const sets=readStored(FILTER_KEY,[]);return Array.isArray(sets)?sets:[];}
  function renderFilterSets(){const select=byId('rwFilterSet');if(select)select.innerHTML='<option value="">Saved filter sets…</option>'+filterSets().map((set,index)=>`<option value="${index}">${safeText(set.name)}</option>`).join('');}
  function saveFilterSet(){syncResearchEditorStateFromDom();const name=byId('rwFilterName').value.trim();if(!name){byId('rwFilterName').focus();return;}const sets=filterSets(),entry={name,filters:copy(state.editingResearchFilters||[]),conditions:copy(state.editingGuidedResearchConditions||[]),population:copy(state.editingResearchPopulationScope||{}),populationBehavior:readResearchPopulationBehaviorEditor()};const existing=sets.findIndex(set=>set.name===name);if(existing<0)sets.push(entry);else sets[existing]=entry;if(writeStored(FILTER_KEY,sets))renderFilterSets();else notice('Filter set could not be stored. Export your analysis to keep a copy.');}
  function applyFilterSet(){const value=byId('rwFilterSet').value;if(value==='')return;const set=filterSets()[Number(value)];if(!set)return;capture();state.editingResearchFilters=copy(set.filters||[]);state.editingGuidedResearchConditions=copy(set.conditions||[]);state.editingResearchPopulationScope=copy(set.population||{});if(set.populationBehavior)renderResearchPopulationBehaviorEditor(set.populationBehavior);renderResearchFiltersEditor();renderGuidedResearchConditions();renderResearchPopulationEditor();capture();refreshHealth();}
  function formulaBuilder(target){
    const dialog=document.createElement('div');dialog.className='rwDialogBackdrop';dialog.dataset.rwFormulaSource=target.closest('#metricEditorModal')?els.metricSourceSelect?.value:els.researchSource?.value;dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','rwFormulaTitle');
    dialog.innerHTML=`<section class="rwDialog"><h3 id="rwFormulaTitle">Build a calculation</h3><p>Choose two measures. Raw columns are aggregated; saved metrics and model results use their own calculation.</p><div class="rwFormulaGrid"><label>First measure / current value<input data-rw-field data-formula="left" placeholder="Search columns, metrics, models"></label><label>Calculation<select data-formula="operation"><option value="ratio">Ratio / rate (A ÷ B)</option><option value="percentage">Percentage (A ÷ B × 100)</option><option value="difference">Difference (A − B)</option><option value="points">Percentage-point difference (A − B)</option><option value="change">Percent change ((A − B) ÷ B × 100)</option><option value="add">Add (A + B)</option><option value="multiply">Multiply (A × B)</option></select></label><label>Second measure / previous value<input data-rw-field data-formula="right" placeholder="Search columns, metrics, models"></label><label>Column aggregation<select data-formula="aggregation"><option value="sum">Sum</option><option value="avg">Average</option><option value="count">Count</option><option value="unique">Distinct count</option><option value="min">Minimum</option><option value="max">Maximum</option></select></label></div><p class="hint">Percentage-point difference expects both inputs on the same 0–100 scale. A zero denominator returns a missing value and a warning.</p><output class="rwFormulaOutput"></output><div class="row"><button type="button" data-formula-cancel class="dark">Cancel</button><button type="button" data-formula-apply class="green">Use formula</button></div></section>`;
    document.body.appendChild(dialog);const close=()=>{closePicker();dialog.remove();target.focus();};dialog.querySelector('[data-formula-cancel]').onclick=close;
    const value=name=>dialog.querySelector(`[data-formula="${name}"]`).value;
    const update=()=>{try{dialog.querySelector('output').textContent=buildFormula(value('operation'),value('left'),value('right'),value('aggregation'));}catch(error){dialog.querySelector('output').textContent=error.message;}};
    dialog.addEventListener('input',update);dialog.addEventListener('change',update);dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();close();}if(event.key==='Tab'){const focusable=[...dialog.querySelectorAll('input,select,button')],first=focusable[0],last=focusable[focusable.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}});
    dialog.querySelector('[data-formula-apply]').onclick=()=>{try{target.value=buildFormula(value('operation'),value('left'),value('right'),value('aggregation'));if(target.id==='metricFieldInput')els.metricModeSelect.value='formula';target.dispatchEvent(new Event('input',{bubbles:true}));target.dispatchEvent(new Event('change',{bubbles:true}));if(target.id==='metricFieldInput')updateMetricEditorVisibility();close();}catch(error){dialog.querySelector('output').textContent=error.message;}};
    dialog.querySelector('input').focus();update();
  }
  function duplicateResearch(itemId){const original=state.researchItems.find(item=>item.id===itemId);if(!original)return;const duplicate=copy({...original,renderedResult:null,id:id(),title:(original.title||'Research')+' — Copy'});state.researchItems.push(duplicate);saveResearchItems();renderResearchCanvasAsync({reason:'duplicate'});openResearchItemEditor(duplicate.id);}
  function matchingResearchItems(){
    const terms=normalize(byId('rwResearchSearch')?.value).split(/\s+/).filter(Boolean);
    return (state.researchItems||[]).filter(item=>{const text=normalize([item.title,labelSource(item.source)||item.source,item.outputType].join(' '));return terms.every(term=>text.includes(term));});
  }
  function selectViewingOption(select,value){
    if(!select)return;
    const options=[...select.options];options.forEach(option=>{option.selected=false;});
    const selected=options.find(option=>option.value===value);if(selected)selected.selected=true;
  }
  function reflowResearchViews(){
    if(layoutPending)return;layoutPending=true;
    requestAnimationFrame(()=>{layoutPending=false;const canvas=byId('researchCanvas');if(!byId('researchModal')?.classList.contains('open'))return;
      canvas?.querySelectorAll('[data-research-card]:not([hidden]) [data-virtual-table]').forEach(table=>renderResearchVirtualWindow(table.dataset.virtualTable));
      canvas?.querySelectorAll('[data-research-card]:not([hidden])').forEach(card=>bindResearchCanvasCharts(card));
    });
  }
  function setResearchFullscreen(modalId,enabled){
    const modal=byId(modalId);if(!modal)return;
    modal.classList.toggle('rwWorkspaceFullscreen',enabled);
    const button=modal.querySelector('[data-rw-fullscreen]');if(button){button.textContent=enabled?'Exit fullscreen':'Fullscreen';button.setAttribute('aria-pressed',String(enabled));}
    reflowResearchViews();
  }
  function exitItemFullscreen(restoreFocus=true){
    if(!itemFullscreenReturn)return;
    const prior=itemFullscreenReturn;itemFullscreenReturn=null;canvasView=prior.view;focusedItemId=prior.itemId;
    setResearchFullscreen('researchModal',prior.workspaceFullscreen);applyCanvasView();
    if(restoreFocus){const card=[...byId('researchCanvas').querySelectorAll('[data-research-card]')].find(c=>c.dataset.researchCard===prior.returnItemId);(card?.querySelector('[data-rw-fullscreen-item]')||byId('rwCanvasView'))?.focus();}
  }
  function toggleResearchFullscreen(modalId){
    if(modalId==='researchModal'&&itemFullscreenReturn){exitItemFullscreen();return;}
    setResearchFullscreen(modalId,!byId(modalId)?.classList.contains('rwWorkspaceFullscreen'));
  }
  function focusResearchItem(itemId,fullscreen=false){
    const canvas=byId('researchCanvas'),card=[...canvas.querySelectorAll('[data-research-card]')].find(c=>c.dataset.researchCard===itemId);
    if(!card||!matchingResearchItems().some(item=>item.id===itemId))return;
    if(fullscreen&&card.querySelector('[data-asc-viewer]')&&root.AllStarCharts){root.AllStarCharts.openViewer(itemId).catch(error=>root.alert?.(error.message));return;}
    if(fullscreen&&itemFullscreenReturn&&focusedItemId===itemId){exitItemFullscreen();return;}
    if(fullscreen&&!itemFullscreenReturn)itemFullscreenReturn={view:canvasView,itemId:focusedItemId,returnItemId:itemId,workspaceFullscreen:byId('researchModal').classList.contains('rwWorkspaceFullscreen')};
    focusedItemId=itemId;canvasView='focus';if(fullscreen)setResearchFullscreen('researchModal',true);applyCanvasView();
    (fullscreen?card.querySelector('[data-rw-fullscreen-item]'):card)?.focus();
  }
  function setCanvasView(view){
    if(!['cards','list','focus'].includes(view))return;if(researchDrag)finishResearchDrag(false);
    if(itemFullscreenReturn)exitItemFullscreen(false);
    canvasView=view;applyCanvasView();
  }
  function stepResearchItem(direction){
    const items=matchingResearchItems(),index=items.findIndex(item=>item.id===focusedItemId),next=items[index+direction];
    if(next)focusResearchItem(next.id);
  }
  function applyCanvasView(reflow=true){
    const canvas=byId('researchCanvas');if(!canvas)return;
    const items=matchingResearchItems(),matchingIds=new Set(items.map(item=>item.id));
    if(!matchingIds.has(focusedItemId))focusedItemId=items[0]?.id||'';
    if(itemFullscreenReturn&&!items.length){exitItemFullscreen(false);return;}
    canvas.dataset.view=canvasView;canvas.classList.toggle('rwItemFullscreen',!!itemFullscreenReturn);
    canvas.querySelectorAll('[data-research-card]').forEach(card=>{
      const selected=card.dataset.researchCard===focusedItemId;
      card.hidden=!matchingIds.has(card.dataset.researchCard)||(canvasView==='focus'&&!selected);
      card.classList.toggle('rwFocusedItem',canvasView==='focus'&&selected);
      const drag=card.querySelector('[data-rw-drag]');if(drag)drag.disabled=canvasView==='focus'||!!itemFullscreenReturn;
      const fullscreen=card.querySelector('[data-rw-fullscreen-item]');if(fullscreen){const active=!!itemFullscreenReturn&&selected;fullscreen.innerHTML=active?'×':fullscreenGlyph;fullscreen.setAttribute('aria-label',active?'Close fullscreen':'Open fullscreen');fullscreen.setAttribute('aria-pressed',String(active));}
    });
    selectViewingOption(byId('rwCanvasView'),canvasView);
    const picker=byId('rwItemPicker');if(picker){picker.innerHTML='<option value="">Choose an item…</option>'+items.map(item=>`<option value="${safeText(item.id)}">${safeText(item.title||'Research Item')}</option>`).join('');selectViewingOption(picker,canvasView==='focus'?focusedItemId:'');picker.disabled=!items.length;}
    const index=items.findIndex(item=>item.id===focusedItemId);
    const previous=byId('rwPreviousItem'),next=byId('rwNextItem');
    if(previous){previous.hidden=canvasView!=='focus';previous.disabled=index<=0;}
    if(next){next.hidden=canvasView!=='focus';next.disabled=index<0||index>=items.length-1;}
    const count=byId('rwViewCount');if(count)count.textContent=canvasView==='focus'&&items.length?`Item ${index+1} of ${items.length}`:`${items.length} of ${(state.researchItems||[]).length} items`;
    const clear=byId('rwClearSearch');if(clear)clear.hidden=!byId('rwResearchSearch').value;
    let empty=canvas.querySelector('[data-rw-no-matches]');
    if(!items.length&&(state.researchItems||[]).length){if(!empty){empty=document.createElement('div');empty.className='researchEmpty';empty.dataset.rwNoMatches='';empty.textContent='No Research items match this search. Clear the search to see all items.';canvas.appendChild(empty);}}else empty?.remove();
    if(reflow===true)reflowResearchViews();
  }
  let researchDrag=null;
  function positionResearchCards(ids){
    const canvas=byId('researchCanvas'),cards=new Map([...canvas.querySelectorAll('[data-research-card]')].map(card=>[card.dataset.researchCard,card]));
    ids.forEach(id=>{const card=cards.get(id);if(card)canvas.appendChild(card);});
  }
  function researchOrderAt(ids,id,target,before){
    if(id===target||!ids.includes(id)||!ids.includes(target))return ids;
    const next=ids.filter(value=>value!==id),index=next.indexOf(target);next.splice(index+(before?0:1),0,id);return next;
  }
  function finishResearchDrag(save=false){
    const drag=researchDrag;if(!drag)return;researchDrag=null;drag.cleanup?.();
    const canvas=byId('researchCanvas');canvas.querySelectorAll('.rwDragging,.rwDropBefore,.rwDropAfter').forEach(node=>node.classList.remove('rwDragging','rwDropBefore','rwDropAfter'));
    drag.handle.setAttribute('aria-pressed','false');
    const previous=state.researchItems,ids=previous.map(item=>item.id);
    if(save&&JSON.stringify(drag.order)!==JSON.stringify(ids)){
      const byId=new Map(previous.map(item=>[item.id,item]));
      state.researchItems=[...drag.order.filter(id=>byId.has(id)).map(id=>byId.get(id)),...previous.filter(item=>!drag.order.includes(item.id))];
      try{persistResearchItemsToLocalStorage();setResearchCanvasStatus('Item order saved.');}
      catch(error){state.researchItems=previous;setResearchCanvasStatus('Could not save the new order. The previous order was restored.');}
    }else setResearchCanvasStatus(save?'Item order unchanged.':'Reordering cancelled.');
    positionResearchCards(state.researchItems.map(item=>item.id));applyCanvasView(false);drag.handle.focus();
  }
  function addResearchDragHandle(card){
    if(card.querySelector('[data-rw-drag]'))return;
    const heading=card.querySelector('.researchCardHead>div'),handle=document.createElement('button');if(!heading)return;
    handle.type='button';handle.className='rwDragHandle';handle.dataset.rwDrag=card.dataset.researchCard;handle.textContent='⠿';handle.setAttribute('aria-label','Reorder '+(state.researchItems.find(i=>i.id===card.dataset.researchCard)?.title||'Research item'));handle.setAttribute('aria-pressed','false');handle.title='Drag to reorder. Keyboard: Space to pick up, arrow keys to move, Enter to place, Escape to cancel.';heading.classList.add('rwCardHeading');heading.prepend(handle);
    const begin=kind=>{
      if(handle.disabled)return false;if(researchDrag)finishResearchDrag(false);
      researchDrag={id:card.dataset.researchCard,handle,kind,order:state.researchItems.map(item=>item.id)};handle.setAttribute('aria-pressed','true');card.classList.add('rwDragging');
      setResearchCanvasStatus('Move the item, then release to place it. Keyboard: arrows to move, Enter to place, Escape to cancel.');return true;
    };
    handle.onpointerdown=event=>{
      if(event.button!==0||!begin('pointer'))return;event.preventDefault();handle.focus();const drag=researchDrag;
      const move=e=>{
        if(researchDrag!==drag)return;
        const canvas=byId('researchCanvas'),rect=canvas.getBoundingClientRect?.(),target=document.elementFromPoint?.(e.clientX,e.clientY)?.closest('[data-research-card]');
        canvas.querySelectorAll('.rwDropBefore,.rwDropAfter').forEach(node=>node.classList.remove('rwDropBefore','rwDropAfter'));
        if(rect&&e.clientX>=rect.left&&e.clientX<=rect.right){if(e.clientY<rect.top+40)canvas.scrollTop-=20;else if(e.clientY>rect.bottom-40)canvas.scrollTop+=20;}
        drag.order=state.researchItems.map(item=>item.id);
        if(!target||target===card||target.hidden||!canvas.contains(target))return;
        const bounds=target.getBoundingClientRect(),horizontal=canvasView==='cards'&&rect&&bounds.width<rect.width*.75,before=horizontal?e.clientX<bounds.left+bounds.width/2:e.clientY<bounds.top+bounds.height/2;
        target.classList.add(before?'rwDropBefore':'rwDropAfter');drag.order=researchOrderAt(drag.order,drag.id,target.dataset.researchCard,before);
      };
      const up=e=>{move(e);finishResearchDrag(true);},cancel=()=>finishResearchDrag(false),key=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancel();}};
      document.addEventListener('pointermove',move);document.addEventListener('pointerup',up);document.addEventListener('pointercancel',cancel);document.addEventListener('keydown',key,true);
      drag.cleanup=()=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);document.removeEventListener('pointercancel',cancel);document.removeEventListener('keydown',key,true);};
    };
    handle.onkeydown=event=>{
      if(event.key==='Escape'&&researchDrag?.handle===handle){event.preventDefault();event.stopPropagation();finishResearchDrag(false);return;}
      if([' ','Enter'].includes(event.key)){event.preventDefault();if(researchDrag?.handle===handle)finishResearchDrag(true);else begin('keyboard');return;}
      if(researchDrag?.handle!==handle||researchDrag.kind!=='keyboard'||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))return;
      event.preventDefault();const drag=researchDrag,visible=new Set([...byId('researchCanvas').querySelectorAll('[data-research-card]')].filter(c=>!c.hidden).map(c=>c.dataset.researchCard)),ids=drag.order.filter(id=>visible.has(id)),index=ids.indexOf(drag.id),before=['ArrowUp','ArrowLeft'].includes(event.key),target=ids[index+(before?-1:1)];
      if(target){drag.order=researchOrderAt(drag.order,drag.id,target,before);positionResearchCards(drag.order);handle.focus();setResearchCanvasStatus(`Item position ${drag.order.indexOf(drag.id)+1} of ${drag.order.length}. Enter to save; Escape to cancel.`);}
    };
  }
  function enhanceCanvas(){
    const canvas=byId('researchCanvas');if(!canvas)return;
    canvas.querySelectorAll('[data-research-card]').forEach(card=>{
      const actions=card.querySelector('.researchActions');if(!actions)return;
      card.tabIndex=0;addResearchDragHandle(card);
      if(!card.querySelector('[data-rw-fullscreen-item]')){
        const more=document.createElement('details');more.className='rwCardMore';more.innerHTML='<summary aria-label="More Research actions" title="More actions">⋯</summary><div class="rwCardMoreMenu"></div>';
        const menu=more.querySelector('div');[...actions.children].forEach(button=>menu.appendChild(button));
        actions.insertAdjacentHTML('afterbegin',`<button type="button" class="smallBtn rwFullscreenButton" data-rw-fullscreen-item="${safeText(card.dataset.researchCard)}" aria-label="Open fullscreen" title="Open fullscreen (F)" aria-pressed="false">${fullscreenGlyph}</button>`);
        menu.insertAdjacentHTML('beforeend',`<button type="button" class="smallBtn" data-rw-view-item="${safeText(card.dataset.researchCard)}">View one item</button><button type="button" class="smallBtn" data-rw-duplicate="${safeText(card.dataset.researchCard)}">Duplicate</button>`);actions.appendChild(more);
      }
      const body=card.querySelector('.researchCardBody'),menu=card.querySelector('.rwCardMoreMenu'),resultActions=body?.querySelector('.asc-result-actions');
      if(resultActions){menu.querySelector('.asc-result-actions')?.remove();resultActions.querySelector('.hint')?.remove();menu.appendChild(resultActions);}
      const ambiguity=body?.querySelector('[data-research-ambiguous-joins]');
      if(ambiguity){menu.querySelector('[data-research-ambiguous-joins]')?.remove();menu.appendChild(ambiguity);}
      else if(!body?.querySelector('[data-ambiguous-count]:not([data-ambiguous-count="0"])'))menu.querySelector('[data-research-ambiguous-joins]')?.remove();
      if(body?.querySelector('[data-asc-viewer]')){
        card.classList.add('rwChartCard');
        let details=body.querySelector(':scope > .rwResultDetails');
        const diagnostics=[...body.children].filter(node=>node!==details&&!node.classList.contains('researchPopulationPreview')&&node.matches('.hint,.researchDiag,.researchDiagnostics,.researchPreviewSummary,.researchJoinPreview,.researchWeeklyFlow,.expressionSummary,details'));
        if(diagnostics.length){if(!details){details=document.createElement('details');details.className='rwResultDetails';details.innerHTML='<summary>Result details</summary>';body.appendChild(details);}diagnostics.forEach(node=>details.appendChild(node));}
        body.querySelectorAll(':scope > .researchWarn').forEach(node=>body.appendChild(node));
      }
    });
    if(!(state.researchItems||[]).length&&!canvas.querySelector('[data-rw-first]')){const empty=document.createElement('div');empty.className='rwEmptyStart';empty.innerHTML='<strong>Create your first Research analysis</strong><p>Compare metrics, discover trends, or investigate performance.</p><button class="green" type="button" data-rw-first="guided">Start Guided Research</button> <button class="dark" type="button" data-rw-first="advanced">Build Advanced Research</button>';canvas.appendChild(empty);}
    applyCanvasView(false);
  }
  function initResearchViewing(){
    const modal=byId('researchModal'),toolbar=modal?.querySelector('.researchToolbar');if(!toolbar)return;
    toolbar.insertAdjacentHTML('beforeend','<button class="dark" type="button" id="rwAnalysisBoard">Charts / Analysis board</button>');byId('rwAnalysisBoard').onclick=()=>root.AllStarCharts?.openBoard();
    const tools=document.createElement('details');tools.className='rwWorkspaceTools';tools.innerHTML='<summary>Research tools</summary><div class="rwToolsMenu"></div>';
    const menu=tools.querySelector('div');[...toolbar.children].filter(control=>!['addResearchItemBtn','renderAllResearchBtn','stopResearchRenderBtn','rwAnalysisBoard','researchDiagnosticsBtn','researchCanvasStatus','addCalculatedResearchBtn'].includes(control.id)).forEach(control=>menu.appendChild(control));toolbar.appendChild(tools);
    const browse=document.createElement('nav');browse.className='rwBrowseBar';browse.setAttribute('aria-label','View Research items');
    browse.innerHTML='<label>View<select id="rwCanvasView"><option value="cards">Cards</option><option value="list">List</option><option value="focus">One item</option></select></label><label class="rwItemPickerLabel">View item<select id="rwItemPicker"><option value="">Choose an item…</option></select></label><button type="button" class="smallBtn" id="rwPreviousItem" hidden>Previous</button><button type="button" class="smallBtn" id="rwNextItem" hidden>Next</button><label class="rwSearchLabel">Find analysis<input type="search" id="rwResearchSearch" placeholder="Title, source, or chart type"></label><button type="button" class="smallBtn" id="rwClearSearch" hidden>Clear search</button><span id="rwViewCount" class="hint" role="status" aria-live="polite"></span>';
    toolbar.after(browse);
    const diagnostics=byId('researchDiagnosticsDrawer'),diagnosticsButton=byId('researchDiagnosticsBtn');
    diagnosticsButton.onclick=()=>{if(diagnostics.open)return;if(diagnostics.showModal)diagnostics.showModal();else diagnostics.setAttribute('open','');diagnostics.querySelector('button').focus();};
    diagnostics.querySelector('[data-rw-close-diagnostics]').onclick=()=>{if(diagnostics.close)diagnostics.close();else diagnostics.removeAttribute('open');diagnosticsButton.focus();};
    diagnostics.addEventListener('close',()=>diagnosticsButton.focus());diagnostics.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();if(!diagnostics.close){diagnostics.removeAttribute('open');diagnosticsButton.focus();}}});byId('rwCanvasView').onchange=event=>setCanvasView(event.target.value);byId('rwItemPicker').onchange=event=>focusResearchItem(event.target.value);byId('rwPreviousItem').onclick=()=>stepResearchItem(-1);byId('rwNextItem').onclick=()=>stepResearchItem(1);byId('rwResearchSearch').oninput=()=>applyCanvasView();byId('rwClearSearch').onclick=()=>{byId('rwResearchSearch').value='';applyCanvasView();byId('rwResearchSearch').focus();};
    ['researchModal','researchEditorModal'].forEach(modalId=>{
      const target=byId(modalId),head=target.querySelector('.modalHead'),button=document.createElement('button');button.type='button';button.className='dark';button.dataset.rwFullscreen=modalId;button.textContent='Fullscreen';button.setAttribute('aria-pressed','false');button.setAttribute('aria-label',modalId==='researchModal'?'Toggle Research fullscreen':'Toggle Research editor fullscreen');head.insertBefore(button,head.querySelector('[data-close]'));button.onclick=()=>toggleResearchFullscreen(modalId);
      target.addEventListener('keydown',event=>{const itemActive=modalId==='researchModal'&&itemFullscreenReturn;if(event.key!=='Escape'||(!target.classList.contains('rwWorkspaceFullscreen')&&!itemActive))return;event.preventDefault();event.stopPropagation();if(itemActive)exitItemFullscreen();else setResearchFullscreen(modalId,false);});
    });
    canvasView=readStored('allstar.research.canvasView.v1','cards');if(!['cards','list','focus'].includes(canvasView))canvasView='cards';
    byId('rwCanvasView').addEventListener('change',()=>writeStored('allstar.research.canvasView.v1',canvasView));
    modal.addEventListener('keydown',event=>{if(event.key?.toLowerCase()!=='f'||event.ctrlKey||event.metaKey||event.altKey||event.target.closest('input,textarea,select,[contenteditable=true]'))return;const card=event.target.closest('[data-research-card]');if(card){event.preventDefault();focusResearchItem(card.dataset.researchCard,true);}});
    root.addEventListener?.('resize',reflowResearchViews);enhanceCanvas();
  }
  function addMetricControls(){const panel=byId('metricEditorModal')?.querySelector('.panel');if(!panel||byId('rwMetricMetadata'))return;
    METRIC_MODES.forEach(([value,label])=>{const option=document.createElement('option');option.value=value;option.textContent=label;els.metricModeSelect.appendChild(option);});
    const metadata=document.createElement('div');metadata.id='rwMetricMetadata';metadata.className='rwMetricMetadata';metadata.innerHTML='<div class="row"><button type="button" class="smallBtn" id="rwBuildMetricFormula">Build formula</button><span class="hint">Formulas can reference saved metrics and model criteria.</span></div><div class="researchStepGrid"><label>Display format<select id="rwMetricFormat"><option value="">Use existing formatting</option><option value="number">Number</option><option value="percentage">Percentage (0–100)</option><option value="ratio">Ratio (decimal)</option><option value="points">Percentage points</option></select></label><label>Decimal precision<input id="rwMetricPrecision" type="number" min="0" max="6" value="2"></label><label>Target (optional)<input id="rwMetricTarget" type="number" step="any"></label><label>Preferred direction<select id="rwMetricDirection"><option value="neutral">No preference</option><option value="higher">Higher is better</option><option value="lower">Lower is better</option></select></label></div>';
    panel.insertBefore(metadata,byId('metricNotesInput')?.closest('.field')||null);byId('rwBuildMetricFormula').onclick=()=>formulaBuilder(els.metricFieldInput);
  }
  function init(){
    initResearchRateControls();
    if(initialized||!byId('researchEditorModal'))return;initialized=true;
    const editor=byId('researchEditorModal'),body=editor.querySelector('.modalBody');
    const toolbar=document.createElement('div');toolbar.className='rwEditorBar';toolbar.innerHTML='<div class="rwMode" role="group" aria-label="Research presentation"><button type="button" data-rw-mode="guided">Guided</button><button type="button" data-rw-mode="advanced">Advanced</button></div><span id="rwSaveState" role="status" aria-live="polite">New analysis</span><button type="button" class="smallBtn" id="rwUndo" disabled>Undo</button><button type="button" class="smallBtn" id="rwRedo" disabled>Redo</button><button type="button" class="smallBtn" id="rwExportDraft">Export configuration</button>';
    body.prepend(toolbar);toolbar.querySelectorAll('[data-rw-mode]').forEach(button=>button.onclick=()=>setMode(button.dataset.rwMode));
    byId('rwUndo').onclick=()=>{capture();restoreSnapshot(history.undo());};byId('rwRedo').onclick=()=>restoreSnapshot(history.redo());
    byId('rwExportDraft').onclick=()=>downloadText('research-analysis.json',JSON.stringify({version:2,items:[currentResearchItemFromEditor()],metrics:state.metrics||[]},null,2));
    const recovery=document.createElement('div');recovery.id='rwDraftRecovery';recovery.className='rwDraftRecovery hidden';recovery.innerHTML='<span>A recovered unsaved draft is available for this analysis.</span><button type="button" class="smallBtn" id="rwRestoreDraft">Restore draft</button><button type="button" class="smallBtn" id="rwDismissDraft">Dismiss</button>';toolbar.after(recovery);
    byId('rwRestoreDraft').onclick=()=>{const draft=readStored(DRAFT_KEY,null);if(draft?.snapshot){restoreSnapshot(draft.snapshot);history.push(controlsSnapshot());updateSaveState();}recovery.classList.add('hidden');};byId('rwDismissDraft').onclick=()=>{recovery.classList.add('hidden');try{localStorage.removeItem(DRAFT_KEY);}catch(_){}};
    const steps=document.createElement('nav');steps.className='rwSteps';steps.setAttribute('aria-label','Research workflow');const targets=[['Question','guidedQuestionSummary'],['Population','researchPopulationScopeSection'],['Measure','guidedStepQuestion'],['Compare','guidedStepDisplay'],['Filter','guidedStepFilters'],['Visualize','guidedStepDisplay'],['Health','rwHealth']];steps.innerHTML=targets.map(([name,target],index)=>`<button type="button" data-rw-target="${target}"><span>${index+1}</span>${name}</button>`).join('');recovery.after(steps);steps.onclick=event=>{const target=event.target.closest('[data-rw-target]');if(target){const section=byId(target.dataset.rwTarget)||byId('guidedQuestionSummary');section?.scrollIntoView({behavior:'smooth',block:'start'});}};
    const health=document.createElement('details');health.id='rwHealth';health.className='researchSection rwHealth';health.innerHTML='<summary>Research health <span class="hint">Sources, dependencies, and warnings</span></summary><button type="button" class="smallBtn" id="rwCheckHealth">Check configuration</button><div id="rwHealthBody" aria-live="polite">Choose measures to check source availability and dependencies.</div>';body.appendChild(health);byId('rwCheckHealth').onclick=refreshHealth;health.addEventListener('toggle',()=>{if(health.open)refreshHealth();});
    const sets=document.createElement('div');sets.className='rwFilterSets';sets.innerHTML='<label>Reusable filter sets<select id="rwFilterSet" aria-label="Saved filter sets"></select></label><button type="button" class="smallBtn" id="rwApplyFilterSet">Apply set</button><input id="rwFilterName" aria-label="Filter set name" placeholder="Name this filter set"><button type="button" class="smallBtn" id="rwSaveFilterSet">Save set</button><span class="hint">Includes population filters and AND/OR qualification conditions.</span>';byId('researchFilters')?.before(sets);renderFilterSets();byId('rwSaveFilterSet').onclick=saveFilterSet;byId('rwApplyFilterSet').onclick=applyFilterSet;
    editor.addEventListener('input',()=>{scheduleCapture();scheduleResearchJoinPreview();});editor.addEventListener('change',()=>{scheduleCapture();scheduleResearchJoinPreview();});editor.addEventListener('click',event=>{if(!event.target.closest('.rwEditorBar,#rwDraftRecovery'))scheduleCapture();});
    editor.addEventListener('keydown',event=>{if(!(event.ctrlKey||event.metaKey)||event.altKey)return;if(event.target.matches('input,textarea'))return;if(event.key.toLowerCase()==='z'){event.preventDefault();if(event.shiftKey)restoreSnapshot(history.redo());else{capture();restoreSnapshot(history.undo());}}});
    document.addEventListener('click',event=>{const fullscreen=event.target.closest('[data-rw-fullscreen-item]');if(fullscreen)focusResearchItem(fullscreen.dataset.rwFullscreenItem,true);const view=event.target.closest('[data-rw-view-item]');if(view)focusResearchItem(view.dataset.rwViewItem);const duplicate=event.target.closest('[data-rw-duplicate]');if(duplicate)duplicateResearch(duplicate.dataset.rwDuplicate);const first=event.target.closest('[data-rw-first]');if(first){openResearchItemEditor(null);setMode(first.dataset.rwFirst);}});
    initResearchViewing();
    if(typeof MutationObserver!=='undefined'&&byId('researchCanvas'))new MutationObserver(enhanceCanvas).observe(byId('researchCanvas'),{childList:true});addMetricControls();
    root.addEventListener?.('beforeunload',()=>{if(editor.classList.contains('open'))capture();});
  }
  // Preserve all legacy calculation branches. New semantics are opt-in modes only.
  const previousNormalizeMetric=normalizeMetric;
  normalizeMetric=function(metric={}){return {...previousNormalizeMetric(metric),...metricMetadata(metric)};};
  const previousEvaluateMetric=evaluateMetric;
  evaluateMetric=function(metric,rows,source,warnings=[]){
    if(!['median','min','max','distinct','formula'].includes(metric?.mode))return previousEvaluateMetric(metric,rows,source,warnings);
    const key=metric.id||metric.name;
    if(metricStack.includes(key)){metricCycle=true;warnings.push('Circular metric reference: '+metricStack.concat(key).join(' → '));return null;}
    if(!metricStack.length)metricCycle=false;
    metricStack.push(key);
    try{
      const actualSource=metric.source||source;
      const found=metricRows(metric.mode==='formula'?{...metric,field:''}:metric,rows||[],actualSource,warnings);
      if(metric.mode==='formula'){
        const before=warnings.length,expression=metric.formula||metric.field;
        const value=evaluateResearchExpressionInContext(expression,found,{source:actualSource,zeroDenominator:'blank'},warnings);
        if(metricCycle||warnings.slice(before).some(message=>/Unknown expression reference|denominator is zero|Expression error|Circular metric/.test(message)))return null;
        if(value==null||value===''||!Number.isFinite(Number(value))){if(!warnings.slice(before).length)warnings.push(metric.name+': formula did not return a finite number.');return null;}
        return Number(value);
      }
      const value=numericMetric(found.map(row=>researchFieldValue(row,metric.field,actualSource)),metric.mode);
      if(value===null)warnings.push(metric.name+': no numeric values were available.');return value;
    }finally{metricStack.pop();}
  };
  const previousMetricFromEditor=metricFromEditor;
  metricFromEditor=function(){const metric=previousMetricFromEditor();if(metric.mode==='formula'){metric.formula=els.metricFieldInput.value;metric.field='('+metric.formula+')';}const format=byId('rwMetricFormat')?.value;if(format){metric.displayFormat=format;metric.decimalPrecision=Number(byId('rwMetricPrecision').value)||0;}const target=byId('rwMetricTarget')?.value;if(target)metric.target=target;const direction=byId('rwMetricDirection')?.value;if(direction&&direction!=='neutral')metric.preferredDirection=direction;return normalizeMetric(metric);};
  const previousOpenMetricEditor=openMetricEditor;
  openMetricEditor=function(metricId){init();previousOpenMetricEditor(metricId);const metric=(state.metrics||[]).find(item=>item.id===metricId)||{};if(!metricId&&state.editingMetricGear)state.editingMetricGear.valuesEnabled=false;if(metric.mode==='formula')els.metricFieldInput.value=metric.formula||metric.field||'';byId('rwMetricFormat').value=metric.displayFormat||'';byId('rwMetricPrecision').value=metric.decimalPrecision??2;byId('rwMetricTarget').value=metric.target??'';byId('rwMetricDirection').value=metric.preferredDirection||'neutral';};
  const previousValidateMetric=validateMetricNumeric;
  validateMetricNumeric=function(){const mode=els.metricModeSelect?.value;if(!METRIC_MODES.some(entry=>entry[0]===mode))return previousValidateMetric();const good=!!els.metricFieldInput?.value.trim();if(els.metricNumericWarn){els.metricNumericWarn.textContent=good?'':'Choose a field or formula for this metric.';els.metricNumericWarn.classList.toggle('hidden',good);}return good;};
  const previousFormat=typeof formatResearchValue==='function'?formatResearchValue:null;
  if(previousFormat)formatResearchValue=function(value,item={},column={}){const metric=findMetricByRef(column?.field||item.valueField);if(metric?.displayFormat&&value!=null&&value!==''&&Number.isFinite(Number(value))){const suffix=metric.displayFormat==='percentage'?'%':metric.displayFormat==='points'?' pp':'';return Number(value).toFixed(metric.decimalPrecision??2)+suffix;}return previousFormat(value,item,column);};
  const previousCompare=compareFilter;
  compareFilter=function(value,operator,expected,high){const result=extraFilter(value,operator,expected);return result===undefined?previousCompare(value,operator,expected,high):result;};
  const previousRenderFilters=renderResearchFiltersEditor;
  renderResearchFiltersEditor=function(){previousRenderFilters();els.researchFilters?.querySelectorAll('[data-rf="op"]').forEach(select=>{const filter=state.editingResearchFilters[Number(select.dataset.i)];if(findMetricByRef(filter?.field))return;EXTRA_OPS.forEach(operator=>{if(![...select.options].some(option=>option.value===operator)){const option=document.createElement('option');option.value=operator;option.textContent=operator;select.appendChild(option);}});if(EXTRA_OPS.includes(filter?.op))select.value=filter.op;});};
  const previousCurrentItem=currentResearchItemFromEditor;
  currentResearchItemFromEditor=function(){const item=previousCurrentItem();const prior=(state.researchItems||[]).find(existing=>existing.id===item.id);const guided=guidedConfigFromForm();return {...(prior||{}),...item,...guided,guidedEnabled:item.guidedEnabled};};
  const previousOpenEditor=openResearchItemEditor;
  openResearchItemEditor=function(itemId){
    if(byId('researchEditorModal')?.classList.contains('open'))capture();init();closePicker();previousOpenEditor(itemId);
    // A stable draft id avoids a new id each time the unsaved editor is inspected.
    if(!els.researchEditId.value)els.researchEditId.value=id();editingId=itemId||'';openedExisting=!!itemId;
    refreshMode(state.editingGuidedResearchActive?'guided':'advanced');const snapshot=controlsSnapshot();history.reset(snapshot);baseline=JSON.stringify(snapshot);updateSaveState();
    const draft=readStored(DRAFT_KEY,null);byId('rwDraftRecovery').classList.toggle('hidden',!draft||draft.itemId!==editingId||JSON.stringify(draft.snapshot)===baseline);renderFilterSets();
  };
  const previousCloseModal=closeModal;
  closeModal=function(modalId){hideHeaderSuggestions();if(modalId==='researchEditorModal'){clearTimeout(captureTimer);capture();closePicker();setResearchFullscreen(modalId,false);}if(modalId==='researchModal'){if(researchDrag)finishResearchDrag(false);exitItemFullscreen(false);setResearchFullscreen(modalId,false);}return previousCloseModal(modalId);};
  const previousSave=saveResearchItemFromEditor;
  saveResearchItemFromEditor=async function(){capture();const key=els.researchEditId.value;const result=await previousSave();if(!byId('researchEditorModal')?.classList.contains('open')&&(state.researchItems||[]).some(item=>item.id===key)){baseline=JSON.stringify(controlsSnapshot());openedExisting=true;notice('Saved');try{const draft=readStored(DRAFT_KEY,null);if(draft?.itemId===editingId)localStorage.removeItem(DRAFT_KEY);}catch(_){}}return result;};
  if(typeof bindResearchCanvasActions==='function'){const previousBind=bindResearchCanvasActions;bindResearchCanvasActions=function(scope){previousBind(scope);enhanceCanvas();};}
  api.init=init;api.refresh=()=>{refreshMode(state.editingGuidedResearchActive?'guided':'advanced');scheduleCapture();};api.openFieldPicker=openPicker;api.fieldEntries=fieldEntries;api.openFormulaBuilder=formulaBuilder;api.refreshHealth=refreshHealth;api.duplicate=duplicateResearch;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(typeof window==='undefined'?globalThis:window);
