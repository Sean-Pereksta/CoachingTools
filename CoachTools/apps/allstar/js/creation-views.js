/* Presentation only. Existing editors, complete drafts, evaluators and storage stay authoritative. */
'use strict';
(function(root){
  const byId=id=>document.getElementById(id),text=x=>esc(String(x??''));
  const serialize=x=>stableSerialize(x);
  let metricAll=false,metricSnapshot='',metricOriginal=null,metricOpened=null;
  const viewKey='allstar.creation.views.v1';
  let preferences={};try{preferences=JSON.parse(localStorage.getItem(viewKey)||'{}');}catch(_){}
  function remember(){try{localStorage.setItem(viewKey,JSON.stringify(preferences));}catch(_){} }
  function category(metric){
    if(metric.dataCategory==='datedStats')return 'Dated measurements';
    const framework=typeof sourceFramework==='function'?sourceFramework(metric.source):'';
    if(framework==='weekly_stat_file')return 'Dated measurements';
    return ['documented_coaching','checklist','qa','date'].includes(metric.source)||['dated_items','qa_export'].includes(framework)?'Dated events / records':'Non-dated source';
  }
  function metricSummary(m){
    if(m.dataCategory==='datedStats')return datedStatsMetricPresentation(m).summary;
    const field=m.field||'source records';
    const modes={count:`Count matching source rows (${field})`,distinct:`Distinct values of ${field}`,sum:`Sum of ${field}`,avg:`Average of ${field}`,median:`Median of ${field}`,min:`Minimum of ${field}`,max:`Maximum of ${field}`,component_avg:`Average selected fields: ${(m.componentFields||[]).join(' · ')}`,percent_item:`${field} ÷ ${m.percentOfField||'choose denominator'} · percentage`,pooled_rate:`${field} ÷ ${m.percentOfField||'choose eligible count'} · pooled rate`,percent:`Matching rows ÷ nonblank ${field} rows · percentage`,percent_total:`Matching rows ÷ nonblank ${field} rows · percentage`,percent_parent:`Matching rows ÷ nonblank ${field} rows · percentage`};
    return (m.mode==='formula'?'Custom calculation':modes[m.mode]||`${m.mode}: ${field}`)+` · ${(m.rules||[]).length} conditions`;
  }
  function section(id,title,summary){
    const node=document.createElement('details');node.id=id;node.className='creationSection';node.innerHTML=`<summary>${title} <span class="hint" data-view-summary>${text(summary)}</span></summary><div class="creationSectionBody"></div>`;
    return node;
  }
  function metricLayout(){
    const editor=byId('metricEditorModal'),panel=editor.querySelector('.modalBody > .panel');
    if(byId('metricCreationGuide'))return;
    const guide=document.createElement('div');guide.id='metricCreationGuide';guide.className='creationGuide';guide.innerHTML='<strong>Define a reusable value</strong><p class="hint" id="metricDefinitionSummary"></p><button type="button" id="metricAllSettingsBtn" class="smallBtn">All settings</button><p class="hint" id="metricCalculationHelp"></p><p class="hint" id="metricRetainedInputs"></p><span id="metricDraftStatus" role="status"></span>';
    panel.prepend(guide);
    const conditions=section('metricConditionsSection','Filters and conditions','No conditions'),appearance=section('metricAppearanceSection','Display and notes','Existing formatting');
    const ruleList=byId('metricRulesList'),ruleRow=byId('addMetricAndBtn').parentElement,ruleTitle=ruleRow.previousElementSibling;
    panel.insertBefore(conditions,ruleTitle);conditions.lastElementChild.append(ruleTitle,ruleRow,ruleList);
    panel.insertBefore(appearance,conditions);
    if(byId('rwMetricMetadata')){
      const metadata=byId('rwMetricMetadata'),formula=byId('rwBuildMetricFormula').closest('.row');metadata.before(formula);appearance.lastElementChild.appendChild(metadata);
    }
    appearance.lastElementChild.appendChild(byId('metricNotesInput').closest('.field'));
    const preview=document.createElement('section');preview.className='creationPreview';preview.id='metricPreviewSection';preview.innerHTML='<strong>Preview this draft</strong><p class="hint">All loaded source rows and all available dates. The evidence table shows the first 50 matching rows; it is not the full population.</p><div class="row" data-metric-preview-actions></div><div id="metricResultContext" role="status"></div>';
    panel.appendChild(preview);
    [byId('previewMetricFoundBtn'),byId('metricPreviewGrouping').parentElement,byId('metricPreviewSummary')].forEach(n=>preview.querySelector('[data-metric-preview-actions]').appendChild(n));
    preview.appendChild(byId('metricFoundPreview'));
    byId('metricAllSettingsBtn').onclick=()=>{metricAll=!metricAll;preferences.metricAll=metricAll;remember();updateMetricEditorVisibility();metricView();};
    const onEdit=event=>{
      if(event.target.closest('#metricCreationGuide')||event.target.closest('[data-metric-preview-actions]'))return;
      metricView();const signature=metricSignature();
      if(signature!==metricSnapshot){metricSnapshot=signature;byId('metricResultContext').textContent='Calculation changed. Preview again to update the result.';byId('metricFoundPreview').classList.add('creationStale');}
    };
    editor.addEventListener('input',onEdit);editor.addEventListener('change',onEdit);
  }
  function metricSignature(){
    const m={...metricFromEditor()};for(const key of ['name','notes','displayFormat','decimalPrecision','preferredDirection','target'])delete m[key];return serialize(m);
  }
  function refreshMetricDraft(){
    if(!byId('metricCreationGuide')||!els.metricEditorModal.classList.contains('open'))return;
    metricView();const signature=metricSignature();if(signature!==metricSnapshot){metricSnapshot=signature;byId('metricResultContext').textContent='Calculation changed. Preview again to update the result.';byId('metricFoundPreview').classList.add('creationStale');}
  }
  function metricView(){
    if(!byId('metricCreationGuide'))return;
    const m=metricFromEditor();byId('metricDefinitionSummary').textContent=metricSummary(m);
    byId('metricCalculationHelp').textContent=m.mode==='count'?'Counting unit: matching physical source rows. A distinct-value count is a separate existing mode.':m.mode==='formula'?'Custom calculation: inspect the expression directly or use Build formula.':m.mode==='component_avg'?'Choose component fields, then review zero and missing-value handling.':'Choose the source value, calculation, and any conditions on included rows.';
    const retained=[];
    if(m.percentOfField&&!['percent_item','pooled_rate'].includes(m.mode))retained.push('denominator');
    if(m.withinCompareField&&!m.mode.includes('within'))retained.push('within comparison');
    if(m.componentFields?.length&&m.mode!=='component_avg')retained.push('component fields');
    byId('metricRetainedInputs').textContent=retained.length?'Retained calculation inputs: '+retained.join(', ')+'. Inspect with All settings.':'';
    byId('metricConditionsSection').querySelector('[data-view-summary]').textContent=`${m.rules.length} conditions · ${m.gear?.valuesEnabled?'field value options active':'field value options off'}`;
    byId('metricAppearanceSection').querySelector('[data-view-summary]').textContent=`${m.displayFormat||'Existing formatting'} · ${m.notes?'notes present':'no notes'}`;
    const saved=state.metrics.find(saved=>saved.id===m.id);byId('metricDraftStatus').textContent=!saved?'New metric':serialize(saved)===serialize(m)?'Saved':'Unsaved changes';
    byId('metricAllSettingsBtn').setAttribute('aria-pressed',String(metricAll));
    const formula=byId('rwBuildMetricFormula')?.closest('.row');if(formula)formula.hidden=!metricAll&&m.mode!=='formula';
    if(metricAll){
      byId('metricConditionsSection').open=true;byId('metricAppearanceSection').open=true;
      document.querySelectorAll('#metricExtraOptions [class],#metricComponentOptions').forEach(n=>n.classList.remove('hidden'));
      els.metricFieldInput.closest('.field').classList.remove('hidden');
    }
  }
  const list=renderMetricList;
  renderMetricList=function(...args){const result=list(...args);els.metricsList.querySelectorAll('[data-mid]').forEach(row=>{
    const m=state.metrics.find(m=>m.id===row.dataset.mid);if(!m)return;
    if(m.dataCategory==='datedStats')row.children[2].textContent='Dated Stats';
    const description=document.createElement('p');description.className='metricDefinitionNote';description.textContent=metricSummary(m);row.appendChild(description);
    const status=document.createElement('span');status.className='hint';status.textContent=category(m);description.append(' · ',status);
    const actions=row.querySelector('.metricListActions'),more=document.createElement('details');more.className='creationMore';more.innerHTML='<summary>More</summary>';
    row.querySelectorAll('[data-mdup],[data-mdel]').forEach(n=>more.appendChild(n));more.onclick=e=>e.stopPropagation();actions.appendChild(more);
  });return result;};
  const openMetric=openMetricEditor,readMetric=metricFromEditor;
  metricFromEditor=function(){
    const next=readMetric();if(!metricOriginal||next.id!==metricOriginal.id||!metricOpened)return next;
    // No-edit reopening retains optional settings instead of filling them from UI defaults.
    const merged={...metricOriginal};for(const [key,value] of Object.entries(next))if(serialize(value)!==serialize(metricOpened[key]))merged[key]=value;
    for(const [id,key] of [['rwMetricTarget','target'],['rwMetricDirection','preferredDirection'],['rwMetricFormat','displayFormat']]){
      const input=byId(id);if(input&&input.value!==metricOpened['_'+id])merged[key]=input.value===''?'':key==='target'?Number(input.value):input.value;
    }
    if(merged.displayFormat)merged.decimalPrecision=Number(byId('rwMetricPrecision').value)||0;
    return merged;
  };
  openMetricEditor=function(mid){
    metricOriginal=null;metricOpened=null;const result=openMetric(mid);
    if(state.metrics.find(m=>m.id===mid)?.dataCategory==='datedStats')return result;
    metricLayout();metricOriginal=clonePlain(state.metrics.find(m=>m.id===mid)||null);metricOpened=readMetric();
    for(const id of ['rwMetricTarget','rwMetricDirection','rwMetricFormat'])metricOpened['_'+id]=byId(id)?.value;
    metricAll=!!preferences.metricAll;metricView();metricSnapshot=metricSignature();byId('metricDraftStatus').textContent=mid?'Editing saved metric':'New metric';byId('metricResultContext').textContent='Preview uses this draft and loaded source data.';byId('metricFoundPreview').classList.remove('creationStale');return result;
  };
  const visibility=updateMetricEditorVisibility;
  updateMetricEditorVisibility=function(...args){const result=visibility(...args);metricView();return result;};
  const metricRules=renderMetricRules;renderMetricRules=function(...args){const result=metricRules(...args);refreshMetricDraft();return result;};
  const metricGear=metricGearPopup;metricGearPopup=function(options){const apply=options.onApply;return metricGear({...options,onApply:value=>{apply?.(value);refreshMetricDraft();}});};
  const preview=renderMetricFoundPreview;
  renderMetricFoundPreview=function(){
    const result=preview(),m=metricFromEditor(),rows=getResearchSourceRows(m.source),warnings=[];
    const value=evaluateMetric(m,rows,m.source,warnings);
    byId('metricResultContext').innerHTML=`<p><strong>Draft result: ${text(value==null?'Unavailable':formatResearchValue(value,{valueField:'@'+m.name,decimals:m.decimalPrecision??2}))}</strong> · ${text(labelSource(m.source))} · all available dates · ${rows.length.toLocaleString()} loaded rows</p>${warnings.map(w=>`<p class="researchWarn">${text(w)}</p>`).join('')}${!rows.length?'<p>No source rows are loaded. This preview has no usable source data.</p>':''}`;
    byId('metricFoundPreview').classList.remove('creationStale');metricSnapshot=metricSignature();return result;
  };
  const save=saveMetricFromEditor;
  saveMetricFromEditor=async function(...args){
    if(metricOriginal&&serialize(metricFromEditor())===serialize(metricOriginal)){byId('metricDraftStatus').textContent='Saved · no changes';if(args[0])closeModal('metricEditorModal');return true;}
    const previous=clonePlain(state.metrics);try{const result=await save(...args);byId('metricDraftStatus').textContent=result?'Saved':'Save failed · draft retained';return result;}catch(error){state.metrics=previous;byId('metricDraftStatus').textContent='Save failed · draft retained: '+(error.message||error);return false;}
  };
  let researchPreview=null,researchPreviewDefinition=null,researchKey='',researchRevision=0,researchBusy=false;
  const appearanceKeys=['cardSize','showValues','showDateLabels','showPercent','decimals','tableDecimals','tableShowPercent','rotateLabels','wrapLabels','showLegend','showGridlines','smoothLine','useDots','highlightBest','highlightWorst','axisMin','axisMax','goalValue','barOrientation','rowDensity','textWrap','title'];
  function questionKey(item){const calculation=clonePlain(item);appearanceKeys.forEach(key=>delete calculation[key]);return serialize(calculation);}
  function researchLayout(){
    if(byId('creationResearchShow'))return;
    const editor=byId('researchEditorModal'),body=editor.querySelector('.modalBody');
    const controls=document.createElement('div');controls.className='creationLayoutControls';controls.innerHTML='<button type="button" class="smallBtn" id="researchAllSettingsBtn">All settings</button><span class="hint">Open a section to edit. Advanced settings retain the complete question.</span>';byId('guidedQuestionSummary').after(controls);
    const show=section('creationResearchShow','Show','Output and measurement'),people=section('creationResearchFor','For','Population and grouping'),when=section('creationResearchWhen','When','Evidence, conditions and dates'),advanced=section('creationResearchAdvanced','Additional existing settings','Expressions, columns and joins');
    const primarySections=[...body.children].filter(n=>n.matches('.researchSection'));
    controls.after(show,people,when,advanced);
    const add=(group,id)=>{const n=byId(id);if(n)group.lastElementChild.appendChild(n);};
    ['guidedStepSubject','guidedStepQuestion','guidedStepDisplay'].forEach(id=>add(show,id));
    const typed=byId('researchTypedMeasure')?.closest('.researchSection');if(typed)show.lastElementChild.appendChild(typed);
    ['researchPopulationScopeSection','guidedStepFilters'].forEach(id=>add(people,id));
    ['guidedStepEvidence','guidedStepConditions'].forEach(id=>add(when,id));
    const dates=body.querySelector('[data-research-section="build"]');if(dates)when.lastElementChild.appendChild(dates);
    const appearance=byId('researchVisualOptions');appearance.querySelector('summary').textContent='Appearance — chart and table formatting';appearance.dataset.show='all';appearance.classList.remove('hidden');
    for(const field of appearance.querySelectorAll('.researchStepGrid > .field'))if(!field.dataset.show){field.dataset.show='graph';field.classList.toggle('hidden',['table','conversation'].includes(els.researchOutputType.value));}
    for(const id of ['researchTableDecimals','researchTableShowPercent','researchRowDensity','researchTextWrap']){
      const field=byId(id)?.closest('.field');if(field)appearance.querySelector('.researchStepGrid').appendChild(field);
    }
    for(const n of primarySections){if(n===appearance||n.closest('.creationSection'))continue;advanced.lastElementChild.appendChild(n);}
    body.appendChild(appearance);
    const preview=document.createElement('section');preview.id='researchDraftPreview';preview.className='creationPreview';preview.innerHTML='<strong>Preview the current question</strong><p class="hint">Uses this unsaved draft, the existing evaluator, and real loaded data. Evidence is limited for display; the calculation uses the complete selected scope.</p><button type="button" id="researchDraftPreviewBtn">Update question preview</button><p id="researchDraftPreviewStatus" role="status"></p><div id="researchDraftPreviewResult"></div><div id="researchDraftPreviewEvidence"></div>';
    body.appendChild(preview);preview.append(byId('guidedCalculationPreview'),byId('researchFoundPreview'));
    byId('researchAllSettingsBtn').onclick=()=>{
      const all=byId('researchAllSettingsBtn').getAttribute('aria-pressed')!=='true';preferences.researchAll=all;remember();byId('researchAllSettingsBtn').setAttribute('aria-pressed',String(all));
      [show,people,when,advanced,appearance].forEach(n=>n.open=all||n===show);if(all)editor.querySelectorAll('details.guidedAdvancedBlock').forEach(n=>n.open=true);
    };
    for(const n of [show,people,when,advanced])n.addEventListener('toggle',()=>{preferences[n.id]=n.open;remember();});
    byId('researchDraftPreviewBtn').onclick=previewQuestion;
    editor.addEventListener('input',researchChanged);editor.addEventListener('change',researchChanged);
    editor.addEventListener('click',event=>{const target=event.target.closest('[data-rw-target]');if(target){const n=byId(target.dataset.rwTarget);const parent=n?.closest('.creationSection');if(parent)parent.open=true;}if(event.target.closest('[data-rw-mode="advanced"]')){when.open=true;advanced.open=true;}});
  }
  function researchSummary(){
    if(!byId('creationResearchShow'))return;
    const item=currentResearchItemFromEditor();
    byId('creationResearchShow').querySelector('[data-view-summary]').textContent=`${item.outputType} · ${item.valueField||item.measureId||item.valueMode} · ${labelSource(item.source)}`;
    byId('creationResearchFor').querySelector('[data-view-summary]').textContent=`${item.analysisGrain} · group ${item.groupField||'all'} · ${(item.filters||[]).length} population filters · ${Object.values(item.populationScope||{}).filter(Array.isArray).reduce((n,a)=>n+a.length,0)} saved population selections`;
    byId('creationResearchWhen').querySelector('[data-view-summary]').textContent=`${item.startDate||'All available dates'}${item.endDate?' → '+item.endDate:''} · ${(item.guidedConditions||[]).length} qualifying conditions · ${item.dateColumn||'no explicit date column'}`;
    byId('creationResearchAdvanced').querySelector('[data-view-summary]').textContent=`${(item.columns||[]).length} columns · ${item.crossSourceJoinMode||'existing join'}${item.valueMode==='expression'||item.groupExpression?' · custom expression active':''}${item.gearFilters&&Object.keys(item.gearFilters).length?' · field modifiers present':''}`;
  }
  function researchChanged(event){
    if(event.target.closest('.creationLayoutControls,.rwSteps,.rwEditorBar,#rwDraftRecovery,#rwHealth,#researchDraftPreview'))return;
    researchSummary();const item=currentResearchItemFromEditor();
    if(researchPreview&&questionKey(item)!==researchKey){researchRevision++;byId('researchDraftPreviewStatus').textContent='Question changed. Preview again to update the answer.';byId('researchDraftPreviewResult').classList.add('creationStale');byId('researchDraftPreviewEvidence').innerHTML='';}
    else if(researchPreview)renderQuestionPreview(item,researchPreview);
  }
  function showEvidence(id){
    const trace=state.researchTraceStore?.get(id),host=byId('researchDraftPreviewEvidence');if(!trace){host.textContent='Calculation evidence is no longer available. Update the preview.';return;}
    state.researchFeedbackState[id]=state.researchFeedbackState[id]||{shown:50};host.innerHTML=renderResearchCellFeedback(trace);
    host.querySelector('[data-research-feedback-close]').onclick=()=>{host.innerHTML='';};
    for(const [attr,amount] of [['next',50],['all',null],['collapse',0]])host.querySelector(`[data-research-trace-${attr}]`).onclick=()=>{state.researchFeedbackState[id].shown=amount===null?trace.matchedRows.length:amount===0?50:state.researchFeedbackState[id].shown+amount;showEvidence(id);};
    host.querySelector('[data-research-trace-export]').onclick=()=>exportResearchTrace(id);
  }
  function inspectValue(id){const version=researchRevision;return openResearchCellDrilldown(id,{draft:researchPreviewDefinition,host:byId('researchDraftPreviewEvidence'),cancelled:()=>version!==researchRevision});}
  function renderQuestionPreview(item,result){
    const host=byId('researchDraftPreviewResult'),limited={...result,totalCells:undefined,data:result.data?.slice(0,50).map(({cells,...row})=>row),rows:result.rows?.slice(0,50)};
    host.innerHTML=`<p class="hint">Current draft · ${text(labelSource(item.source))} · ${text(item.startDate||'all available dates')}${item.endDate?' → '+text(item.endDate):''} · ${text(item.analysisGrain)} · group ${text(item.groupField||'all')}. ${item.filters?.length||0} population filters; ${item.guidedConditions?.length||0} qualifying conditions.</p>${(result.warnings||[]).map(w=>`<p class="researchWarn">${text(w)}</p>`).join('')}${renderResearchResultContent(item,item.outputType==='table'||item.outputType==='conversation'?limited:result)}${item.outputType!=='table'&&item.outputType!=='conversation'?`<details><summary>Inspect calculated values and evidence</summary>${renderResearchTable(item,limited)}</details>`:''}<p class="hint">Tables show the first 50 calculated groups or records. Click a value to inspect its existing calculation trace. Matching a qualifying condition does not guarantee a usable numerical measurement.</p>`;
    host.classList.remove('creationStale');host.querySelectorAll('[data-trace-id]').forEach(node=>node.onclick=()=>showEvidence(node.dataset.traceId));
    host.querySelectorAll('[data-drilldown-id]:not([data-trace-id])').forEach(node=>node.onclick=()=>inspectValue(node.dataset.drilldownId));
    if(!(result.data?.length||result.rows?.length))host.insertAdjacentHTML('beforeend','<p>No usable result for this selected scope. Review the source and active conditions.</p>');
  }
  async function previewQuestion(){
    if(researchBusy)return;
    if(state.editingGuidedResearchActive)syncGuidedResearchToAdvanced();
    if(!validateResearchEditor()){byId('researchDraftPreviewStatus').textContent='Review the highlighted configuration before previewing.';return;}
    const item=clonePlain(currentResearchItemFromEditor()),key=questionKey(item),version=++researchRevision;
    researchBusy=true;byId('researchDraftPreviewBtn').disabled=true;byId('researchDraftPreviewStatus').textContent='Calculating with the selected loaded data…';
    try{
      const result=await evaluateResearchItemAsync(item,{token:{get cancelled(){return version!==researchRevision;}}});
      if(version!==researchRevision||key!==questionKey(currentResearchItemFromEditor())){byId('researchDraftPreviewStatus').textContent='Question changed during calculation. Update the preview again.';return;}
      researchPreview=result;researchPreviewDefinition=item;researchKey=key;renderQuestionPreview(item,result);byId('researchDraftPreviewStatus').textContent='Current draft preview · calculated with the existing Research engine.';
    }catch(error){byId('researchDraftPreviewStatus').textContent=error.message||String(error);}
    finally{researchBusy=false;byId('researchDraftPreviewBtn').disabled=false;}
  }
  const openResearch=openResearchItemEditor;
  openResearchItemEditor=function(...args){const result=openResearch(...args);if(!els.researchEditorModal.classList.contains('open'))return result;researchLayout();researchSummary();researchRevision++;researchPreview=null;researchKey='';byId('researchDraftPreviewResult').innerHTML='';byId('researchDraftPreviewEvidence').innerHTML='';byId('researchDraftPreviewStatus').textContent='Update the preview to inspect this draft.';for(const id of ['creationResearchShow','creationResearchFor','creationResearchWhen','creationResearchAdvanced'])byId(id).open=preferences.researchAll||preferences[id]||id==='creationResearchShow';return result;};
  const researchVisibility=updateResearchBuilderVisibility;
  updateResearchBuilderVisibility=function(...args){const result=researchVisibility(...args);if(byId('creationResearchShow')){researchSummary();if(researchPreview&&questionKey(currentResearchItemFromEditor())!==researchKey){researchRevision++;byId('researchDraftPreviewResult').classList.add('creationStale');byId('researchDraftPreviewStatus').textContent='Question changed. Preview again to update the answer.';byId('researchDraftPreviewEvidence').innerHTML='';}}return result;};
  root.AllStarCreationViews={metricSummary,category,previewQuestion,questionKey,inspectValue};
})(window);
