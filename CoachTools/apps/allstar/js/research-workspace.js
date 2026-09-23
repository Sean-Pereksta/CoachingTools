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
  let baseline='',editingId='',restoring=false,captureTimer,activePicker=null,pickerSequence=0,initialized=false;
  let metricCycle=false,openedExisting=false;
  function notice(message){const status=byId('rwSaveState');if(status)status.textContent=message;}
  function readStored(key,fallback){try{return JSON.parse(localStorage.getItem(key)||'null')||fallback;}catch(_){return fallback;}}
  function writeStored(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch(_){return false;}}
  function controlsSnapshot(){
    const controls={};byId('researchEditorModal')?.querySelectorAll('input[id],select[id],textarea[id]').forEach(input=>{
      if(input.id.startsWith('rw')||input.type==='file')return;
      controls[input.id]=input.multiple?[...input.options].filter(o=>o.selected).map(o=>o.value):(input.type==='checkbox'?input.checked:input.value);
    });
    const editing={};['editingResearchFilters','editingGuidedResearchConditions','editingResearchColumns','editingResearchPopulationScope','editingPercentBuilder','editingResearchGroupAxisItems','editingResearchGear','editingGuidedResearchActive'].forEach(key=>{if(state[key]!==undefined)editing[key]=copy(state[key]);});
    return {controls,editing};
  }
  function setControls(controls){Object.entries(controls||{}).forEach(([id,value])=>{const input=byId(id);if(!input)return;if(input.multiple&&Array.isArray(value))[...input.options].forEach(o=>o.selected=value.includes(o.value));else if(input.type==='checkbox')input.checked=!!value;else input.value=value??'';});}
  function restoreSnapshot(snapshot){
    if(!snapshot)return;restoring=true;
    try{
      Object.entries(snapshot.editing||{}).forEach(([key,value])=>state[key]=copy(value));setControls(snapshot.controls);
      renderResearchPopulationEditor();renderResearchFiltersEditor();renderResearchColumnsEditor();renderResearchGroupAxisItemsEditor();renderGuidedResearchConditions();
      renderPercentBuilderEditor(currentResearchItemFromEditor());updateResearchBuilderVisibility();setControls(snapshot.controls);
      updateGuidedResearchUi();refreshMode();refreshHealth();
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
    const populationList=input.getAttribute('list');
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
  function closePicker(){if(!activePicker)return;const {input,panel}=activePicker;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');panel.remove();activePicker=null;}
  function openPicker(input,empty=false){
    if(!input||input.disabled)return;closePicker();const panel=document.createElement('div');panel.className='rwFieldPicker';panel.id='rwFields'+(++pickerSequence);panel.setAttribute('role','listbox');
    document.body.appendChild(panel);const rect=input.getBoundingClientRect();panel.style.left=Math.max(8,Math.min(rect.left,innerWidth-360))+'px';panel.style.top=Math.min(rect.bottom+5,Math.max(8,innerHeight-300))+'px';panel.style.width=Math.min(Math.max(rect.width,350),innerWidth-16)+'px';
    const entries=fieldEntries(input),matches=searchFields(entries,empty?'':input.value);
    let group='';panel.innerHTML=matches.map((entry,index)=>{const header=entry.group!==group?`<div class="rwPickerGroup">${safeText(entry.group)}</div>`:'';group=entry.group;return header+`<button type="button" role="option" aria-selected="false" id="${panel.id}_${index}" data-rw-choice="${index}"><strong>${safeText(entry.label)}</strong><small>${safeText(entry.detail)}</small></button>`;}).join('')||'<div class="rwPickerEmpty">No matches. You can still type an expression.</div>';
    input.setAttribute('role','combobox');input.setAttribute('aria-expanded','true');input.setAttribute('aria-controls',panel.id);input.setAttribute('aria-autocomplete','list');
    activePicker={input,panel,matches,index:-1};panel.addEventListener('mousedown',event=>event.preventDefault());panel.onclick=event=>{const choice=event.target.closest('[data-rw-choice]');if(choice)chooseField(Number(choice.dataset.rwChoice));};
  }
  function chooseField(index){const active=activePicker,entry=active?.matches[index];if(!entry)return;active.input.value=entry.value;closePicker();active.input.dispatchEvent(new Event('input',{bubbles:true}));active.input.dispatchEvent(new Event('change',{bubbles:true}));closePicker();let target=active.input;if(!target.isConnected){if(target.id)target=byId(target.id)||target;else for(const attr of ['rf','rc','gc']){if(target.dataset[attr]){target=document.querySelector(`[data-${attr}="${target.dataset[attr]}"][data-i="${target.dataset.i}"]`)||target;break;}}}target.focus();}
  function pickerEligible(input){return input?.matches?.('input[list="researchHeaderSuggestions"],input[list="metricHeaderSuggestions"],input[list^="researchPopulation"],input[list="researchTeamFilterSuggestions"],[data-rw-field]');}
  function pickerKey(event){
    if(!pickerEligible(event.target))return;
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();if(!activePicker||activePicker.input!==event.target)openPicker(event.target,true);
      const a=activePicker;if(!a||!a.matches.length)return;a.index=(a.index+(event.key==='ArrowDown'?1:-1)+a.matches.length)%a.matches.length;
      a.panel.querySelectorAll('[role="option"]').forEach((option,index)=>option.setAttribute('aria-selected',String(index===a.index)));const selected=byId(a.panel.id+'_'+a.index);a.input.setAttribute('aria-activedescendant',selected.id);selected.scrollIntoView?.({block:'nearest'});
    }else if(event.key==='Enter'&&activePicker?.input===event.target&&activePicker.index>=0){event.preventDefault();event.stopPropagation();chooseField(activePicker.index);}
    else if(event.key==='Escape'&&activePicker){event.preventDefault();event.stopPropagation();closePicker();}
  }
  function filterSets(){const sets=readStored(FILTER_KEY,[]);return Array.isArray(sets)?sets:[];}
  function renderFilterSets(){const select=byId('rwFilterSet');if(select)select.innerHTML='<option value="">Saved filter sets…</option>'+filterSets().map((set,index)=>`<option value="${index}">${safeText(set.name)}</option>`).join('');}
  function saveFilterSet(){syncResearchEditorStateFromDom();const name=byId('rwFilterName').value.trim();if(!name){byId('rwFilterName').focus();return;}const sets=filterSets(),entry={name,filters:copy(state.editingResearchFilters||[]),conditions:copy(state.editingGuidedResearchConditions||[]),population:copy(state.editingResearchPopulationScope||{})};const existing=sets.findIndex(set=>set.name===name);if(existing<0)sets.push(entry);else sets[existing]=entry;if(writeStored(FILTER_KEY,sets))renderFilterSets();else notice('Filter set could not be stored. Export your analysis to keep a copy.');}
  function applyFilterSet(){const value=byId('rwFilterSet').value;if(value==='')return;const set=filterSets()[Number(value)];if(!set)return;capture();state.editingResearchFilters=copy(set.filters||[]);state.editingGuidedResearchConditions=copy(set.conditions||[]);state.editingResearchPopulationScope=copy(set.population||{});renderResearchFiltersEditor();renderGuidedResearchConditions();renderResearchPopulationEditor();capture();refreshHealth();}
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
  function enhanceCanvas(){const canvas=byId('researchCanvas');if(!canvas)return;canvas.querySelectorAll('[data-research-card]').forEach(card=>{if(card.querySelector('[data-rw-duplicate]'))return;const button=document.createElement('button');button.type='button';button.className='smallBtn';button.dataset.rwDuplicate=card.dataset.researchCard;button.textContent='Duplicate';card.querySelector('.researchActions')?.appendChild(button);});if(!(state.researchItems||[]).length&&!canvas.querySelector('[data-rw-first]')){const empty=document.createElement('div');empty.className='rwEmptyStart';empty.innerHTML='<strong>Create your first Research analysis</strong><p>Compare metrics, discover trends, or investigate performance.</p><button class="green" type="button" data-rw-first="guided">Start Guided Research</button> <button class="dark" type="button" data-rw-first="advanced">Build Advanced Research</button>';canvas.appendChild(empty);}}
  function addMetricControls(){const panel=byId('metricEditorModal')?.querySelector('.panel');if(!panel||byId('rwMetricMetadata'))return;
    METRIC_MODES.forEach(([value,label])=>{const option=document.createElement('option');option.value=value;option.textContent=label;els.metricModeSelect.appendChild(option);});
    const metadata=document.createElement('div');metadata.id='rwMetricMetadata';metadata.className='rwMetricMetadata';metadata.innerHTML='<div class="row"><button type="button" class="smallBtn" id="rwBuildMetricFormula">Build formula</button><span class="hint">Formulas can reference saved metrics and model criteria.</span></div><div class="researchStepGrid"><label>Display format<select id="rwMetricFormat"><option value="">Use existing formatting</option><option value="number">Number</option><option value="percentage">Percentage (0–100)</option><option value="ratio">Ratio (decimal)</option><option value="points">Percentage points</option></select></label><label>Decimal precision<input id="rwMetricPrecision" type="number" min="0" max="6" value="2"></label><label>Target (optional)<input id="rwMetricTarget" type="number" step="any"></label><label>Preferred direction<select id="rwMetricDirection"><option value="neutral">No preference</option><option value="higher">Higher is better</option><option value="lower">Lower is better</option></select></label></div>';
    panel.insertBefore(metadata,byId('metricNotesInput')?.closest('.field')||null);byId('rwBuildMetricFormula').onclick=()=>formulaBuilder(els.metricFieldInput);
  }
  function init(){
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
    editor.addEventListener('input',scheduleCapture);editor.addEventListener('change',scheduleCapture);editor.addEventListener('click',event=>{if(!event.target.closest('.rwEditorBar,#rwDraftRecovery'))scheduleCapture();});
    editor.addEventListener('keydown',event=>{if(!(event.ctrlKey||event.metaKey)||event.altKey)return;if(event.target.matches('input,textarea'))return;if(event.key.toLowerCase()==='z'){event.preventDefault();if(event.shiftKey)restoreSnapshot(history.redo());else{capture();restoreSnapshot(history.undo());}}});
    document.addEventListener('input',event=>{if(pickerEligible(event.target))openPicker(event.target);});document.addEventListener('keydown',pickerKey,true);document.addEventListener('focusin',event=>{if(pickerEligible(event.target))openPicker(event.target,true);else if(!event.target.closest?.('.rwFieldPicker'))closePicker();});document.addEventListener('pointerdown',event=>{if(activePicker&&event.target!==activePicker.input&&!event.target.closest('.rwFieldPicker'))closePicker();});root.addEventListener?.('resize',closePicker);document.addEventListener('scroll',event=>{if(activePicker&&!activePicker.panel.contains(event.target))closePicker();},true);
    document.addEventListener('click',event=>{const duplicate=event.target.closest('[data-rw-duplicate]');if(duplicate)duplicateResearch(duplicate.dataset.rwDuplicate);const first=event.target.closest('[data-rw-first]');if(first){openResearchItemEditor(null);setMode(first.dataset.rwFirst);}});
    byId('researchModal')?.querySelector('.researchToolbar')?.insertAdjacentHTML('beforeend','<button class="dark" type="button" id="rwAnalysisBoard">Charts / Analysis board</button><label class="rwSearchLabel">Find analysis<input type="search" id="rwResearchSearch" placeholder="Search saved Research"></label>');byId('rwAnalysisBoard').onclick=()=>root.AllStarCharts?.openBoard();byId('rwResearchSearch').oninput=event=>byId('researchCanvas').querySelectorAll('[data-research-card]').forEach(card=>card.hidden=!normalize(card.querySelector('.researchCardTitle')?.textContent).includes(normalize(event.target.value)));
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
  closeModal=function(modalId){if(modalId==='researchEditorModal'){clearTimeout(captureTimer);capture();closePicker();}return previousCloseModal(modalId);};
  const previousSave=saveResearchItemFromEditor;
  saveResearchItemFromEditor=async function(){capture();const key=els.researchEditId.value;const result=await previousSave();if(!byId('researchEditorModal')?.classList.contains('open')&&(state.researchItems||[]).some(item=>item.id===key)){baseline=JSON.stringify(controlsSnapshot());openedExisting=true;notice('Saved');try{const draft=readStored(DRAFT_KEY,null);if(draft?.itemId===editingId)localStorage.removeItem(DRAFT_KEY);}catch(_){}}return result;};
  if(typeof bindResearchCanvasActions==='function'){const previousBind=bindResearchCanvasActions;bindResearchCanvasActions=function(){previousBind();enhanceCanvas();};}
  api.init=init;api.refresh=()=>{refreshMode(state.editingGuidedResearchActive?'guided':'advanced');scheduleCapture();};api.openFieldPicker=openPicker;api.fieldEntries=fieldEntries;api.openFormulaBuilder=formulaBuilder;api.refreshHealth=refreshHealth;api.duplicate=duplicateResearch;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(typeof window==='undefined'?globalThis:window);
