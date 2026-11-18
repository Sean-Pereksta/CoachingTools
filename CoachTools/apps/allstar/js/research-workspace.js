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
  function snapshotDisplay(item,result){
    const rows=Array.isArray(result.data)?result.data:[],columns=result.columns||[];
    if(item.datedStats||item.outputType==='conversation'||!rows.length)return 'saved';
    if(item.outputType==='scatter'&&(result.joinDiagnostics?.calls>0||result.lineage?.sources?.length>1))return 'unverified';
    const units=columns.map(c=>c.unit||c.displayFormat||(c.showAsPercent?'percent':''));
    if(columns.length>1&&units.some(unit=>!unit))return 'table';
    if(rows.length===1&&columns.length===1&&typeof rows[0]?.values?.[0]==='number')return 'number';
    if(!rows.some(row=>row.values?.some(value=>value!=null&&value!=='')))return 'table';
    const chartable=rows.every(row=>Array.isArray(row.values)&&row.values.every(value=>value==null||value===''||typeof value==='number'&&Number.isFinite(value)));
    if(!chartable)return 'table';
    if(new Set(units).size>1)return columns.length<=6&&rows.length<=50?'panels':'table';
    if(!['line','scatter','histogram','box','heatmap'].includes(item.outputType)&&rows.length>50)return 'table';
    return 'saved';
  }
  const api={editHistory,searchFields,formulaOperand,buildFormula,extraFilter,numericMetric,metricMetadata,snapshotDisplay};
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
    const menu=tools.querySelector('div');[...toolbar.children].filter(control=>!['researchNewQuestionBtn','researchLibraryToggle','addResearchItemBtn','renderAllResearchBtn','stopResearchRenderBtn','rwAnalysisBoard','researchDiagnosticsBtn','researchCanvasStatus','addCalculatedResearchBtn'].includes(control.id)).forEach(control=>menu.appendChild(control));toolbar.appendChild(tools);
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
currentResearchItemFromEditor=function(){const item=previousCurrentItem();const prior=(state.researchItems||[]).find(existing=>existing.id===item.id);const guided=guidedConfigFromForm();return {...(prior||{}),...item,...guided,guidedEnabled:item.guidedEnabled,questionKind:prior?.questionKind||byId("researchEditorModal")?.dataset.questionKind||undefined};};
  const previousOpenEditor=openResearchItemEditor;
  openResearchItemEditor=function(itemId){
    if(byId('researchEditorModal')?.classList.contains('open'))capture();init();closePicker();previousOpenEditor(itemId);
    byId('researchEditorModal').dataset.questionKind=state.newResearchQuestion?.questionKind||'';
    // A stable draft id avoids a new id each time the unsaved editor is inspected.
    if(!els.researchEditId.value)els.researchEditId.value=id();editingId=itemId||'';openedExisting=!!itemId;
    refreshMode(state.editingGuidedResearchActive?'guided':'advanced');const snapshot=controlsSnapshot();history.reset(snapshot);baseline=JSON.stringify(snapshot);updateSaveState();
    const draft=readStored(DRAFT_KEY,null);byId('rwDraftRecovery').classList.toggle('hidden',!draft||draft.itemId!==editingId||JSON.stringify(draft.snapshot)===baseline);renderFilterSets();
  };
  const previousCloseModal=closeModal;
  closeModal=function(modalId){hideHeaderSuggestions();if(modalId==='researchEditorModal'){clearTimeout(captureTimer);capture();closePicker();setResearchFullscreen(modalId,false);}if(modalId==='researchModal'){if(researchDrag)finishResearchDrag(false);exitItemFullscreen(false);setResearchFullscreen(modalId,false);}return previousCloseModal(modalId);};
  const previousSave=saveResearchItemFromEditor;
  saveResearchItemFromEditor=async function(options){capture();const key=els.researchEditId.value;const result=await previousSave(options);if(!byId('researchEditorModal')?.classList.contains('open')&&(state.researchItems||[]).some(item=>item.id===key)){baseline=JSON.stringify(controlsSnapshot());openedExisting=true;notice('Saved');try{const draft=readStored(DRAFT_KEY,null);if(draft?.itemId===editingId)localStorage.removeItem(DRAFT_KEY);}catch(_){}}return result;};
  if(typeof bindResearchCanvasActions==='function'){const previousBind=bindResearchCanvasActions;bindResearchCanvasActions=function(scope){previousBind(scope);enhanceCanvas();};}
  api.init=init;api.refresh=()=>{refreshMode(state.editingGuidedResearchActive?'guided':'advanced');scheduleCapture();};api.openFieldPicker=openPicker;api.fieldEntries=fieldEntries;api.openFormulaBuilder=formulaBuilder;api.refreshHealth=refreshHealth;api.duplicate=duplicateResearch;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(typeof window==='undefined'?globalThis:window);

// The library works from saved definitions. Only opening a snapshot reads its row chunks.
(function(root){
  if(typeof document==='undefined')return;
  const node=id=>document.getElementById(id),selection=new Set(),statuses=new Map();
  const preference='allstar.research.library.v1';
  let active=false,shownId='',request=0,comparing=false,displayed=[];
  try{active=localStorage.getItem(preference)==='true';}catch(_){}
  function itemById(id){return (state.researchItems||[]).find(item=>item.id===id);}
  function label(item){return item.questionKind||item.datedStats?.mode?.replace(/_/g,' ')||item.outputType||'Table';}
  function list(){
    const host=node('researchLibraryItems');if(!host)return;
    const q=node('researchLibrarySearch').value.trim().toLowerCase();
    const rows=(state.researchItems||[]).filter(item=>[item.title,labelSource(item.source),label(item)].join(' ').toLowerCase().includes(q));
    host.innerHTML=rows.map(item=>{
      const id=esc(item.id),title=esc(item.title||'Untitled Research');
      const stamp=item.renderedResult?.renderedAt;
      const status=statuses.get(item.id)||(stamp?'Snapshot saved '+new Date(stamp).toLocaleString():item.renderedResult?'Saved snapshot':'Definition only');
      return `<div class="rwLibraryRow"><input type="checkbox" data-lib-check="${id}" aria-label="Select ${title} for calculation" ${selection.has(item.id)?'checked':''}><div><strong>${title}</strong><span>${esc(label(item))} · ${esc(labelSource(item.source))}</span><span>${esc(status)}</span><div class="row"><button type="button" class="smallBtn" data-lib-open="${id}" ${item.renderedResult?'':'disabled'}>View snapshot</button><button type="button" class="smallBtn" data-lib-run="${id}">Run on current data</button><button type="button" class="smallBtn" data-lib-edit="${id}">Edit</button></div></div></div>`;
    }).join('')||'<p>No matching saved Research.</p>';
  }
  function refresh(){
    const library=node('researchLibrary');if(!library)return;
    library.hidden=!active;node('researchCanvas').hidden=active;
    node('researchModal')?.classList.toggle('rwLibraryActive',active);
    node('renderAllResearchBtn').textContent=active?'Run all':'Render All';
    node('researchLibraryToggle').setAttribute('aria-pressed',String(active));
    if(!active)return;
    invalidateMissing();
    list();
    if(!comparing&&(!shownId||!itemById(shownId))){shownId='';node('researchLibraryDetail').textContent='Choose a saved snapshot to view its result.';}
  }
  function invalidateMissing(){
    if(!displayed.some(id=>!itemById(id)?.renderedResult))return;
    displayed=[];comparing=false;shownId='';request++;
    const host=node('researchLibraryDetail');if(host)host.textContent='Choose a saved snapshot to view its result.';
    for(const id of selection)if(!itemById(id))selection.delete(id);
    statuses.clear();if(active)list();
  }
  async function view(id){
    const item=itemById(id);if(!item)return;
    comparing=false;displayed=[id];
    const generation=++request;shownId=id;
    const host=node('researchLibraryDetail');host.textContent='Opening saved snapshot…';
    const result=item.renderedResult?.result||await researchRenderedResultGet(id);
    if(generation!==request||!active||!itemById(id))return;
    if(!result){host.textContent='No stored result is available. Run this definition on current data.';return;}
    const definition={...(result.snapshotDefinition||item),outputType:result.snapshotDefinition?.outputType||item.renderedResult?.outputType||item.outputType};
    definition._frozenSnapshot={source:labelSource(definition.source),date:item.renderedResult?.renderedAt};
    const view=root.AllStarResearchWorkspace.snapshotDisplay(definition,result);
    host.innerHTML=`<h3>${esc(definition.title||'Research')}</h3><p>Snapshot saved ${esc(item.renderedResult.renderedAt||result.savedAt||'')}. ${esc(result.description||'')}</p>`;
    const display=document.createElement('div');host.appendChild(display);
    if(result.joinDiagnostics?.calls){
      const coverage=document.createElement('details');coverage.innerHTML='<summary>Full-run join coverage</summary>'+researchJoinSummaryHtml(result.joinDiagnostics);host.appendChild(coverage);
    }
    if(view==='unverified'){
      const note=document.createElement('p');note.textContent='The saved result does not verify one independently aggregated value on each side of the same person and period. Inspect the mappings, or select two saved snapshots for independent summaries.';display.before(note);
      const mapping=document.createElement('button');mapping.type='button';mapping.textContent='Review source mappings';
      mapping.onclick=()=>{openResearchItemEditor(id);const panel=node('researchSourceMappingPanel');if(panel){panel.open=true;panel.querySelector('select,button,summary')?.focus();}};note.after(mapping);
    }
    if(view==='saved')display.innerHTML=renderResearchResultByDisplay(definition,result);
    else if(view==='number'){
      const row=result.data[0],col=result.columns[0];display.innerHTML=`<div class="guidedSummaryCards"><div class="guidedSummaryCard"><strong>${esc([row.label,col.displayTitle||col.label].filter(Boolean).join(' · '))}</strong><span>${esc(String(formatResearchValue(row.values[0],definition,col)))}</span><small>${esc(col.mode||definition.valueMode||'')} · ${esc(String(row.rows??'Unknown'))} supporting rows</small></div></div>`;
    }else if(view==='panels'){
      const dated=result.data.every(row=>/^\d{4}-\d{2}-\d{2}$/.test(row.label));
      for(const [index,column] of result.columns.entries()){
        const panel=document.createElement('section'),unit=column.unit||column.displayFormat||(column.showAsPercent?'percent':'');
        const panelItem={...definition,id:definition.id+'-measure-'+index,title:[column.displayTitle||column.label,unit].filter(Boolean).join(' · '),valueField:column.field,outputType:dated?'line':'bar',showPercent:['percentage','percent'].includes(unit),barOrientation:'horizontal',panelField:''};
        const values={...result,columns:[column],data:result.data.map(row=>({...row,values:[row.values[index]],cells:row.cells?[row.cells[index]]:undefined,pointDetails:row.pointDetails?[row.pointDetails[index]]:undefined}))};
        panel.innerHTML=`<h4>${esc(panelItem.title)}</h4>`+renderResearchVisualization(panelItem,values);display.appendChild(panel);
      }
    }else showResultTable(display,result);
    if(view!=='saved'){
      const restore=document.createElement('button');restore.type='button';restore.textContent='Use saved display';
      restore.onclick=()=>{display.innerHTML=renderResearchResultByDisplay(definition,result);bindResearchCanvasActions(display);restore.remove();};
      display.after(restore);
    }
    if(Array.isArray(result.data)&&definition.outputType!=='conversation'){
      const button=document.createElement('button');button.type='button';button.textContent='Export full result CSV';
      button.onclick=()=>exportSnapshotCsv(definition,result);host.prepend(button);
    }
    if(!definition.datedStats&&Array.isArray(result.data)){
      if(!['table','unverified'].includes(view)&&definition.outputType!=='table'){
        const table=document.createElement('details');table.innerHTML='<summary>View table</summary><div></div>';
        table.addEventListener('toggle',()=>{if(table.open&&!table.lastChild.children.length)showResultTable(table.lastChild,result);});
        host.appendChild(table);
      }
      if(result.lineage){
        const evidence=document.createElement('details'),l=result.lineage;
        evidence.innerHTML=`<summary>Calculation evidence</summary><dl><dt>Grain</dt><dd>${esc(l.grain||'Source records')}</dd><dt>Population</dt><dd>${esc(String(l.population??'Unknown'))}</dd><dt>Dates</dt><dd>${esc([l.startDate,l.endDate].filter(Boolean).join(' through ')||'All loaded dates')}</dd><dt>Sources at calculation</dt><dd>${(l.sources||[]).map(s=>esc(labelSource(s.source))+' · '+Number(s.rows||0).toLocaleString()+' rows').join('<br>')}</dd></dl>`;
        host.appendChild(evidence);
      }
    }
    bindResearchCanvasActions(host);
  }
  function showResultTable(host,result){
    host.innerHTML='<label>Find result rows<input type="search"></label><div class="tableWrap"></div><div class="row"><button type="button">Previous</button><span role="status"></span><button type="button">Next</button></div>';
    const search=host.querySelector('input'),table=host.querySelector('.tableWrap'),[prev,next]=host.querySelectorAll('button'),status=host.querySelector('[role=status]');
    let page=0,rows=result.data;
    function paint(){
      const start=page*50;
      table.innerHTML=`<table><thead><tr><th>Group</th><th>Series</th>${result.columns.map(c=>`<th>${esc(c.displayTitle||c.label||c.field||'Value')} ${esc(c.unit||'')}</th>`).join('')}</tr></thead><tbody>${rows.slice(start,start+50).map(r=>`<tr><th>${esc(r.label)}</th><td>${esc([r.secondary,r.panel].filter(Boolean).join(' · '))}</td>${r.values.map((v,i)=>`<td>${esc(String(r.cells?.[i]?.text??v??'Missing'))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      status.textContent=rows.length?`${start+1}–${Math.min(start+50,rows.length)} of ${rows.length}`:'No matching rows';
      prev.disabled=!page;next.disabled=start+50>=rows.length;
    }
    prev.onclick=()=>{page--;paint();};next.onclick=()=>{page++;paint();};
    search.oninput=()=>{const q=search.value.trim().toLowerCase();page=0;rows=q?result.data.filter(r=>[r.label,r.secondary,r.panel,...r.values].join(' ').toLowerCase().includes(q)):result.data;paint();};paint();
  }
  async function compareSnapshots(){
    const selected=[...selection].map(itemById).filter(Boolean);
    if(selected.length!==2||selected.some(i=>!i.renderedResult)){setResearchCanvasStatus('Select two definitions with saved snapshots.');return;}
    const generation=++request;comparing=true;shownId='';displayed=selected.map(item=>item.id);
    const host=node('researchLibraryDetail');host.textContent='Opening both snapshots…';
    const snapshots=await Promise.all(selected.map(item=>item.renderedResult.result||researchRenderedResultGet(item.id)));
    if(generation!==request||!active)return;
    host.innerHTML='<h3>Independent source summaries</h3><p>Each column uses its own saved population, dates and units. No records are paired between columns.</p><div class="rwSnapshotPair"></div>';
    const pair=host.lastChild;
    if(snapshots.every(result=>result?.definition?.settings)){
      const aligned=window.AllStarDatedStats.alignResearchMeasures(...snapshots),panel=document.createElement('section');
      const titles=snapshots.map((r,i)=>r.definition.settings.measure==='coaching_count'?'Distinct coaching sessions':r.definition.metric?.name||selected[i].title);
      showDatedResearchRelationship(panel,{...aligned,xLabel:titles[0],yLabel:titles[1]});host.prepend(panel);
    }
    selected.forEach((item,i)=>{
      const result=snapshots[i],panel=document.createElement('section'),definition=result?.snapshotDefinition||item;
      panel.innerHTML=`<h4>${esc(definition.title||'Research')}</h4><p>${esc(labelSource(definition.source))} · ${esc(item.renderedResult.renderedAt||'Saved snapshot')}</p>`;
      pair.appendChild(panel);
      if(!result?.data){panel.append(document.createTextNode('No saved value rows are available.'));return;}
      if(definition.datedStats){
        const table={columns:[{label:'Value'},{label:'Unit'},{label:'Eligible representatives'},{label:'Numerator'},{label:'Denominator'}],data:result.data.map(p=>({label:p.label,secondary:p.line,values:[p.value,p.unit,p.eligibleRepresentatives,p.numerator,p.denominator]}))};
        const body=document.createElement('div');panel.appendChild(body);showResultTable(body,table);
      }else{
        const context=document.createElement('p');context.textContent=[result.lineage?.grain,(result.lineage?.startDate||result.lineage?.endDate)?[result.lineage?.startDate,result.lineage?.endDate].filter(Boolean).join(' through '):'All loaded dates'].filter(Boolean).join(' · ');panel.appendChild(context);
        const body=document.createElement('div');panel.appendChild(body);showResultTable(body,result);
      }
    });
    setResearchCanvasStatus('Showing two independently calculated snapshots.');
  }
  function exportSnapshotCsv(definition,result){
    const dated=!!definition.datedStats,columns=result.columns||[];
    const header=dated?['Period','Group','Value','Unit','Eligible reps','Missing reps','Numerator','Denominator']:['Group','Series','Panel',...columns.map((c,i)=>c.displayTitle||c.label||c.field||'Value '+(i+1))];
    const context=JSON.stringify(result.lineage||result.definition||definition.datedStats||{source:definition.source});
    const rows=result.data.map(row=>dated?[row.label,row.line,row.value,row.unit,row.eligibleRepresentatives,row.missingRepresentatives,row.numerator,row.denominator]:[row.label,row.secondary,row.panel,...row.values]);
    const quote=value=>{let s=String(value??'');if(typeof value==='string'&&/^[=+@\t\r-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
    const csv=[header.concat('Calculation context'),...rows.map(row=>row.concat(context))].map(row=>row.map(quote).join(',')).join('\r\n');
    downloadText((definition.title||'Research').replace(/[\\/:*?"<>|]/g,'-')+'.csv','\uFEFF'+csv);
  }
  async function run(ids){
    if(!ids.length){setResearchCanvasStatus('Choose a saved definition to run.');return;}
    const token=newResearchRenderToken('library');state.researchRenderAllToken=token;setResearchRenderAllRunning(true);
    let completed=0,failed=0;
    try{
      for(const id of ids){
        if(token.cancelled)break;
        const item=itemById(id);if(!item)continue;
        statuses.set(id,'Running');list();setResearchCanvasStatus('Running '+item.title);await yieldToBrowser();
        try{
          researchRequireCommittedInputs();
          const key=researchSnapshotKey(item);
          if(!item.datedStats)await ensureResearchExecutionIndexes(item,{token});
          researchThrowIfCancelled(token);
          const result=item.outputType==='conversation'?evaluateResearchRawRows(item):await evaluateResearchItemAsync(item,{token});
          researchThrowIfCancelled(token);
          if(!itemById(id)||researchSnapshotKey(itemById(id))!==key)throw new Error('Inputs changed. Run again.');
          const saved=await researchSaveRenderedResult(item,result,{token,inputKey:key});
          researchThrowIfCancelled(token);
          researchRequireCommittedInputs();
          if(!saved)throw new Error('Could not store this result. Check storage and run again.');
          completed++;statuses.delete(id);
          if(active&&(ids.length===1||shownId===id))await view(id);
        }catch(error){
          if(state.researchRenderAllToken!==token)break;
          if(token.cancelled||error.name==='AbortError'){statuses.set(id,'Stopped. Previous snapshot retained.');if(token.cancelled)break;}
          else {failed++;statuses.set(id,error.message||'Run failed.');}
        }
        await yieldToBrowser();
      }
    }finally{
      if(state.researchRenderAllToken===token){
        state.researchRenderAllToken=null;setResearchRenderAllRunning(false);
        setResearchCanvasStatus(`${token.cancelled?'Stopped':'Finished'} · ${completed} saved · ${failed} failed`);
      }
      if(state.researchRenderToken===token)state.researchRenderToken=null;
      list();
    }
  }
  function init(){
    const toggle=node('researchLibraryToggle');if(!toggle)return;
    toggle.onclick=()=>{
      active=!active;request++;
      if(state.researchRenderToken)state.researchRenderToken.cancelled=true;
      try{localStorage.setItem(preference,String(active));}catch(_){}
      refresh();if(!active)renderResearchCanvasAsync({reason:'cards'});
    };
    node('researchNewQuestionBtn').onclick=openResearchQuestion;
    node('researchSaveDefinitionBtn').onclick=()=>saveResearchItemFromEditor({definitionOnly:true});
    node('researchLibrarySearch').oninput=list;
    node('researchCompareSnapshots').onclick=compareSnapshots;
    node('researchRunSelected').onclick=()=>run([...selection].filter(id=>itemById(id)));
    node('researchRunStale').onclick=()=>{
      const ids=state.researchItems.filter(item=>!item.renderedResult?.inputKey||item.renderedResult.inputKey!==researchSnapshotKey(item)).map(item=>item.id);
      if(ids.length)run(ids);else setResearchCanvasStatus('All saved snapshots are current.');
    };
    const host=node('researchLibraryItems');
    host.onchange=event=>{const input=event.target.closest('[data-lib-check]');if(input){if(input.checked)selection.add(input.dataset.libCheck);else selection.delete(input.dataset.libCheck);}};
    host.onclick=event=>{const d=event.target.closest('button')?.dataset;if(d?.libOpen)view(d.libOpen);if(d?.libRun)run([d.libRun]);if(d?.libEdit)openResearchItemEditor(d.libEdit);};
    refresh();
  }
  root.AllStarResearchLibrary={enabled:()=>active,refresh,run,invalidateMissing,showTable:showResultTable,exportCsv:exportSnapshotCsv,newQuestion:async()=>{await openResearchWorkspace();openResearchQuestion();}};
  function openResearchQuestion(){
    const dialog=document.createElement('dialog');dialog.className='rwQuestionDialog';
    const intents=['Compare groups','Show a trend','Before and after','Find a relationship','Show a distribution','Find records or people'];
    const options=entries=>entries.map(([value,label])=>`<option value="${esc(String(value))}">${esc(label)}</option>`).join('');
    const sources=concreteResearchSources().filter(s=>{
      if(['monthly_opportunity','monthly_wiper'].includes(s.value))return !!state.sourceMeta[s.value]?.rowCount;
      if([NONDATED_SOURCE,DATED_SOURCE].includes(s.value))return !!state.categorized[s.value===DATED_SOURCE?'dated':'nondated']?.rows?.length;
      return !!getHeaders(s.value)?.length;
    });
    dialog.setAttribute('aria-labelledby','rwQuestionTitle');
    dialog.innerHTML=`<h2 id="rwQuestionTitle">New Research</h2><form method="dialog"><label>What do you want to answer?<select name="intent">${options(intents.map(i=>[i,i]))}</select></label><div class="rwQuestionFields">
      <label>Source<select name="source">${options(sources.map(s=>[s.value,s.label]))}</select></label>
      <label>Find a measure<input name="search" type="search" placeholder="Column, metric, or model"></label>
      <label>Measure<select name="measure"></select></label><label>Compare by<select name="group"></select></label>
      <label>Population<select name="population"></select></label><label>Time<select name="time"></select></label>
      <label data-question-window>From<input type="date" name="from"></label><label data-question-window>Through<input type="date" name="through"></label>
      </div><p data-question-summary role="status"></p><div class="row"><button type="button" class="green" data-question-open>Continue</button><button type="button" data-question-calculated>Calculated number</button><button type="button" data-question-advanced>Advanced</button><button>Cancel</button></div></form>`;
    document.body.appendChild(dialog);
    const form=dialog.querySelector('form'),c=form.elements,summary=dialog.querySelector('[data-question-summary]'),next=dialog.querySelector('[data-question-open]');
    let measures=[],available=[],headers=[],numeric=[],date='',weekly=[];
    const intent=()=>c.intent.value,source=()=>c.source.value,selected=()=>available[Number(c.measure.value)];
    function load(){
      const src=source();headers=src?(getHeaders(src)||[]).filter(h=>h&&!h.startsWith('_')):[];
      const rows=src?(getRowsRaw(src)||[]):[],count=Math.min(64,rows.length),sample=[];
      for(let i=0;i<count;i++)sample.push(rows[Math.floor(i*rows.length/count)]);
      const fields=src?researchMappedSourceFields(src):{};
      date=headers.includes(fields.date)?fields.date:'';
      weekly=isDatedStatsSource(src)?datedStatsAvailableMetrics(src):[];
      if(weekly.length)date=datedStatsConfig(src).dateField;
      numeric=headers.filter(h=>{
        if([date,fields.rep,fields.coach].includes(h))return false;
        const values=sample.map(r=>r[h]).filter(v=>v!=null&&String(v).trim()!=='');
        return values.length&&values.every(v=>!(v instanceof Date)&&Number.isFinite(toNum(v)));
      });
      const numbers=new Set(numeric);
      measures=[{label:'Record count',field:'',mode:'count',unit:'records'},...headers.map(field=>({field,label:field,mode:numbers.has(field)?'avg':'count',unit:numbers.has(field)?'average of values':'records per category'}))];
      for(const metric of state.metrics||[])if(metric.source===src&&metric.dataCategory!=='datedStats')measures.push({label:metric.name,field:'@'+metric.name,mode:'avg',unit:metric.displayFormat||'saved metric'});
      for(const model of state.models||[])for(const criterion of model.criteria||[])if(criterion.source===src)measures.push({label:model.name+' / '+criterion.name,field:`model(${JSON.stringify(model.id)},${JSON.stringify(criterion.id)})`,mode:'avg',unit:'model criterion'});
      c.search.value='';filterMeasures();configure();
    }
    function filterMeasures(){
      const q=c.search.value.trim().toLowerCase(),kind=intent();
      let entries=measures;
      if(kind==='Show a distribution'||kind==='Find a relationship')entries=entries.filter(m=>numeric.includes(m.field));
      if(kind==='Find a relationship'&&weekly.length&&datedStatsConfig(source()).calendar?.reviewed&&datedStatsConfig(source()).calendar.frequency==='week'){
        entries=[...weekly.filter(metric=>!metric.directField&&metric.output!=='summary').map(metric=>({label:metric.name+' versus coaching sessions',metric,paired:true,field:metric.field,mode:metric.aggregation,unit:metric.kind==='percentage'?'%':metric.kind})),...entries];
      }
      if(kind==='Before and after'||kind==='Show a trend'&&weekly.length)entries=weekly.filter(m=>kind!=='Before and after'||!m.directField&&datedStatsConfig(source()).calendar?.frequency==='week'&&datedStatsConfig(source()).calendar?.reviewed).map(metric=>({label:metric.name,metric,field:metric.field,mode:metric.aggregation,unit:metric.kind==='percentage'?'%':metric.kind}));
      else if(kind==='Show a trend')entries=entries.filter(m=>m.mode!=='count'||!m.field);
      else if(kind==='Find records or people')entries=entries.filter(m=>headers.includes(m.field));
      available=entries.filter(m=>m.label.toLowerCase().includes(q));
      c.measure.innerHTML=options(available.map((m,i)=>[i,m.label+' · '+m.unit]));
    }
    function configure(){
      const m=selected(),kind=intent(),prior=c.group.value;
      const groups=m?.metric?[['all','All eligible representatives'],['coach','Assigned coach'],['representative','Representative'],['organization','Organization'],['manager','Manager']]:kind==='Find a relationship'?numeric.filter(h=>h!==m?.field).map(h=>[h,h]):kind==='Show a distribution'||kind==='Find records or people'?[['','Source records']]:kind==='Show a trend'?[['', 'One series'],['_team','Coach'],['_rep','Representative']]:[['_team','Coach or team'],['_rep','Representative'],...headers.map(h=>[h,h])];
      c.group.innerHTML=options(groups);if(groups.some(g=>g[0]===prior))c.group.value=prior;
      if(m?.paired)c.group.innerHTML=options([['all','One pair per representative and reporting week']]);
      const pops=[['','All in current scope'],...(state.orgs||[]).map(o=>['org/'+o.id,o.name]),...(!m?.metric?(state.researchGroups||[]).map(g=>['group/'+g.id,g.name]):[])];
      const previousPopulation=c.population.value;c.population.innerHTML=options(pops);if(pops.some(p=>p[0]===previousPopulation))c.population.value=previousPopulation;
      const times=kind==='Before and after'?[['periods','Reviewed reporting weeks']]:m?.metric?[[m.metric.directField?'dates':'periods',m.metric.directField?'Use source dates':'Choose report periods']]:date?[['dates','Use source dates'],...(!['Show a trend'].includes(kind)?[['snapshot','Use all loaded rows']]:[])]:[['snapshot','Use loaded snapshot']];
      const previousTime=c.time.value;c.time.innerHTML=options(times);if(times.some(t=>t[0]===previousTime))c.time.value=previousTime;
      describe();
    }
    function describe(){
      const m=selected(),kind=intent(),group=c.group.selectedOptions[0]?.textContent||'',time=c.time.selectedOptions[0]?.textContent||'',pop=c.population.selectedOptions[0]?.textContent;
      const hasDates=c.time.value!=='snapshot'&&!!date;
      dialog.querySelectorAll('[data-question-window]').forEach(label=>label.hidden=!hasDates);
      if(hasDates&&c.from.value&&c.through.value&&c.from.value>c.through.value){next.disabled=true;summary.textContent='Choose an end date on or after the start date.';return;}
      const problem=!source()?'Add a source in Update Data to build this question.':kind==='Show a trend'&&!date?'Choose a source with a mapped date.':!m?(kind==='Before and after'?'Choose a Weekly Stats source with a saved metric and reviewed weekly calendar.':'No matching measure is available for this question.'):kind==='Find a relationship'&&!c.group.value?'Choose a source with two numeric columns.':'';
      const pivot=kind==='Compare groups'&&m?.mode==='count'&&m.field&&m.field!==c.group.value&&!numeric.includes(c.group.value);
      const chart=({'Compare groups':pivot?'Category count heatmap':'Ranked bars','Show a trend':'Line chart','Before and after':'Paired change by coaching week','Find a relationship':'Scatter plot','Show a distribution':'Histogram','Find records or people':'Record table'})[kind];
      const range=hasDates?[c.from.value,c.through.value].filter(Boolean).join(' through '):'';
      next.disabled=!!problem;summary.textContent=problem||[chart,m.label+' · '+m.unit,group,pop,time,range,m?.paired?'Match canonical representatives on identical reporting weeks. Compare distinct coaching sessions with one weekly performance value. Confirm event coverage in the editor.':''].filter(Boolean).join(' · ');
    }
    c.source.onchange=()=>{c.time.value='';load();};c.intent.onchange=()=>{filterMeasures();configure();};c.search.oninput=()=>{filterMeasures();configure();};c.measure.onchange=configure;
    c.group.onchange=c.population.onchange=c.time.onchange=c.from.oninput=c.through.oninput=describe;
    const opener=document.activeElement;dialog.addEventListener('close',()=>{dialog.remove();if(!dialog.dataset.routed)opener?.focus();},{once:true});
    const route=fn=>{dialog.dataset.routed='true';dialog.close();fn();};
    dialog.querySelector('[data-question-calculated]').onclick=()=>route(()=>root.AllStarSentenceWorkspace?.open(null,'calculated'));
    dialog.querySelector('[data-question-advanced]').onclick=()=>route(()=>{state.newResearchQuestion={guidedEnabled:false};try{openResearchItemEditor(null);}finally{delete state.newResearchQuestion;}});
    next.onclick=()=>{
      if(next.disabled)return;
      const m=selected(),kind=intent(),src=source(),pop=c.population.value,group=c.group.value;
      const dates=c.time.value==='snapshot'?{}:{startDate:c.from.value,endDate:c.through.value};
      const title=[kind,m.label,c.group.selectedOptions[0]?.textContent].filter(Boolean).join(' · ');
      if(m.metric){
        const settings=datedStatsSelectMetric({...dates,mode:kind==='Before and after'?'before_after':'fixed',groupBy:group,orgIds:pop.startsWith('org/')?[pop.slice(4)]:[]},m.metric);
        if(m.paired)settings.relationship='sessions_performance';
        return route(()=>openDatedStatsResearchEditor(null,src,{title,questionKind:kind,datedStats:settings}));
      }
      const outputType=({'Compare groups':'bar','Show a trend':'line','Find a relationship':'scatter','Show a distribution':'histogram','Find records or people':'conversation'})[kind];
      const categorical=kind==='Compare groups'&&m.mode==='count'&&m.field;
      const item={title,questionKind:kind,guidedEnabled:false,populationFilterVersion:2,source:src,outputType,analysisGrain:'rows',dateColumn:c.time.value==='snapshot'?'':date,valueMode:m.mode,valueField:m.field,columns:[{field:m.field,mode:m.mode,label:m.label}],groupField:kind==='Show a trend'?date:kind==='Show a distribution'?m.field:group,barOrientation:'horizontal',sort:kind==='Compare groups'?'yDesc':kind==='Show a trend'?'dateAsc':'default',populationScope:pop.startsWith('org/')?{includeOrgs:[pop.slice(4)]}:pop.startsWith('group/')?{includeResearchGroups:[pop.slice(6)]}:{},zeroDenominator:'blank',missingBehavior:'missing'};
      Object.assign(item,dates);
      if(categorical&&m.field!==group){item.useSecondaryGroup=true;item.secondaryGroupField=m.field;if(!numeric.includes(group))item.outputType='heatmap';}
      if(kind==='Show a trend'&&group){item.useSecondaryGroup=true;item.secondaryGroupField=group;}
      route(()=>{state.newResearchQuestion=item;try{openResearchItemEditor(null);}finally{delete state.newResearchQuestion;}});
    };
    load();dialog.showModal();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(typeof window==='undefined'?globalThis:window);
