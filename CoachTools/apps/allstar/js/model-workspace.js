/* Model Builder navigation and previews. All scoring stays in the existing engine. */
'use strict';
(function(){
  let active=false, revision=0, timer, previewBusy=false, definitionKey='';
  const views=new Map();
  const preferenceKey='allstar.model.view.v1';
  let expanded=false;
  try{expanded=localStorage.getItem(preferenceKey)==='all';}catch(_){}
  const byId=id=>document.getElementById(id);
  function view(){
    const key=state.editModel?.id;
    if(!views.has(key)) views.set(key,{selected:null,sections:new Map()});
    return views.get(key);
  }
  function sourceSummary(model){
    return [...new Set((model.criteria||[]).flatMap(c=>c.calcType==='multi'?[c.leftSource||c.source,c.rightSource||c.source]:[c.calcType==='custom'?c.customSource||c.source:c.source]).filter(Boolean))];
  }
  function scoreSummary(c){
    const score=c.scoreType==='display'?'Display only · not scored':c.scoreType==='points'?`Points · multiplier ${c.points??1} · weight ${c.weight??1}`:`Ranked · ${c.direction==='lower'?'lower':'higher'} is better · weight ${c.weight??1}`;
    return score+(String(c.weight)==='autofail'?` · autofail ${c.autofailOperator||'greaterEqual'} ${c.autofailThreshold??1}${c.minimumEnabled?` · minimum ${c.minimum}`:''}`:'')+(c.trueValueEnabled?' · team True Value active':'')+(Number(c.minimumMonitors)>0?` · minimum ${c.minimumMonitors} monitors`:'');
  }
  function filterSummary(c){
    return `${(c.filters||[]).length} filters · ${isRowPullCriterion(c)?(c.rowPullConditions||[]).length:0} row conditions`;
  }
  function describe(c){
    const source=c.calcType==='multi'?`${labelSource(c.leftSource||c.source)} / ${labelSource(c.rightSource||c.source)}`:labelSource(c.calcType==='custom'?(c.customSource||c.source):(c.source||'retail_sv2'));
    const measure=c.calcType==='custom'?c.expression:c.calcType==='multi'?`${c.leftColumn||'left value'} ${c.operator||'/'} ${c.rightColumn||'right value'}`:c.column||c.checkColumn||c.calcType||'value';
    return `${source} → ${measure}; ${scoreSummary(c)}. Applies to ${c.audience==='rep'?'representatives':c.audience==='team'||c.audience==='coach'?'teams / coaches':'representatives and teams'}. ${filterSummary(c)}.`;
  }
  function moveCriterion(model,cid,offset){
    const list=model?.criteria||[], from=list.findIndex(c=>c.id===cid), to=from+offset;
    if(from<0||to<0||to>=list.length) return false;
    [list[from],list[to]]=[list[to],list[from]]; return true;
  }
  async function runSaved(mid){
    await els.runBtn.onclick();els.runModelSelect.value=mid;
    els.runModelSelect.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function overview(){
    if(!els.modelList)return;
    if(!byId('modelOverviewSearch')){
      const label=document.createElement('label');label.className='modelWorkspaceSearch';label.textContent='Find a model';
      const input=document.createElement('input');input.id='modelOverviewSearch';input.type='search';input.placeholder='Name, audience, or source';label.appendChild(input);els.modelList.before(label);
      input.oninput=()=>{const q=input.value.trim().toLowerCase();els.modelList.querySelectorAll('.modelRow').forEach(row=>row.hidden=!row.textContent.toLowerCase().includes(q));};
    }
    els.modelList.querySelectorAll('.modelRow').forEach((row,i)=>{
      const model=state.models[i];if(!model)return;
      const sources=sourceSummary(model),missing=sources.filter(s=>!getHeaders(s).length);
      const note=document.createElement('p');note.className='hint';note.textContent=`${model.criteria.length} criteria · ${sources.map(labelSource).join(' · ')||'No source selected'} · ${missing.length?missing.length+' sources need loaded headers':'Review configuration before running'}`;row.appendChild(note);
      const actions=row.querySelector('.row'),more=document.createElement('details');more.className='modelCriterionMore';more.innerHTML='<summary>More</summary><div class="row"></div>';
      row.querySelectorAll('[data-export-model],[data-delete-model]').forEach(n=>more.querySelector('.row').appendChild(n));
      const run=document.createElement('button');run.type='button';run.className='smallBtn';run.textContent='Run';run.onclick=()=>runSaved(model.id);actions.append(run,more);
    });
    byId('modelOverviewSearch').oninput();
  }
  function summary(){
    const model=state.editModel, host=byId('modelWorkspaceSummary'); if(!model||!host) return;
    const criteria=model.criteria||[], sources=sourceSummary(model);
    host.innerHTML=`<div class="modelWorkspaceCounts"><span><strong>${criteria.length}</strong> criteria</span><span><strong>${sources.length}</strong> sources</span><span><strong>${criteria.filter(c=>c.scoreType==='display').length}</strong> display fields</span></div><div class="hint">${sources.map(s=>esc(labelSource(s))).join(' · ')||'Add a criterion to choose your first data source.'}</div>`;
    const saved=findModel(model.id), dirty=!saved||stableSerialize(saved)!==stableSerialize(model);
    byId('modelWorkspaceStatus').textContent=dirty?'Unsaved changes':'Saved';
  }
  function invalidate(){
    const key=stableSerialize(state.editModel);
    if(key===definitionKey) return;
    definitionKey=key; revision++;
    if(byId('modelSamplePreviewResult')) byId('modelSamplePreviewResult').textContent='Definition changed. Preview again to update the sample.';
    if(byId('modelReadinessBody'))byId('modelReadinessBody').textContent='Review the changed definition to update configuration warnings.';
    els.criteriaList.querySelectorAll('[data-model-found-preview-for]').forEach(box=>{if(!box.classList.contains('hidden'))box.textContent='Criterion definition changed. Preview again to update these matching rows.';});
  }
  function focusCriterion(cid){
    view().selected=cid;
    els.criteriaList.querySelectorAll('[data-crit]').forEach(box=>{
      const selected=box.dataset.crit===cid;
      box.classList.toggle('modelCriterionSelected',selected);
      box.querySelector('.modelCriterionBody').hidden=!expanded&&!selected;
      box.querySelector('[data-model-edit]').setAttribute('aria-expanded',String(expanded||selected));
    });
  }
  function reveal(node){
    for(let parent=node?.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
    if(node?.tagName==='DETAILS')node.open=true;
    node?.scrollIntoView?.({block:'nearest'});node?.focus?.();
  }
  function reviewHealth(){
    const health=modelHealthDiagnostics(state.editModel),host=byId('modelReadinessBody');
    host.innerHTML=health.map((d,i)=>`<p class="${d.blocking?'researchWarn':'hint'}"><strong>${esc(d.title)}</strong> ${esc(d.message)} <button type="button" class="smallBtn" data-model-review="${i}">Review setting</button></p>`).join('')||'<p>No configuration warnings found by the existing preflight.</p>';
    host.querySelectorAll('[data-model-review]').forEach(button=>button.onclick=()=>{
      const d=health[Number(button.dataset.modelReview)],fields=['column','leftColumn','rightColumn','checkColumn','checkDateColumn','lookupMatchColumn','lookupReturnColumn'];
      const criterion=state.editModel.criteria.find(c=>fields.some(key=>c[key]&&c[key]===d.entity))||state.editModel.criteria.find(c=>c.source===d.source);
      if(!criterion)return reveal(byId('sourceSettingsPanel'));
      byId('modelCriterionSearch').value='';byId('modelCriterionScope').value='all';filter();focusCriterion(criterion.id);
      const box=[...els.criteriaList.querySelectorAll('[data-crit]')].find(n=>n.dataset.crit===criterion.id),key=fields.find(key=>criterion[key]===d.entity)||'source';
      reveal(box.querySelector(`[data-cfield="${key}"]`)||box.querySelector('[data-model-edit]'));
    });
  }
  function groupControls(box,c){
    const body=document.createElement('div');body.className='modelCriterionBody';
    const groups={};
    for(const [key,title,note] of [
      ['definition','Definition',c.calcType==='custom'?'Custom expression active':c.calcType],
      ['filters','Filters and conditions',filterSummary(c)],
      ['scoring','Scoring and eligibility',scoreSummary(c)],
      ['display','Display and additional settings',`${c.format||'number'} · ${(c.displayRules||[]).length} display rules`]
    ]){
      const section=document.createElement('details');section.dataset.modelGroup=key;section.className='modelSettingSection';
      section.innerHTML=`<summary>${title} <span class="hint">${esc(note)}</span></summary><div class="modelSettingContent"></div>`;
      const sectionKey=c.id+':'+key;
      section.open=expanded||(view().sections.get(sectionKey)??key==='definition');
      section.addEventListener('toggle',()=>{if(!expanded)view().sections.set(sectionKey,section.open);});
      groups[key]=section.querySelector('.modelSettingContent');body.appendChild(section);
    }
    const fields=[...box.children].filter(n=>n.matches('.grid5,.grid4')&&!n.dataset.block);
    for(const grid of fields){
      for(const node of [...grid.children]){
        const name=node.querySelector('[data-cfield]')?.dataset.cfield;
        if(!node.textContent.trim()&&!node.querySelector('input,select,button'))continue;
        const key=['scoreType','weight','direction','points'].includes(name)?'scoring':name==='format'?'display':'definition';
        groups[key].appendChild(node);
      }
      grid.remove();
    }
    for(const node of [...box.children].slice(1)){
      if(node.matches('[data-model-found-preview-for]'))continue;
      const block=node.dataset.block;
      const key=block==='checklist'||node.querySelector('[data-add-filter]')?'filters':['trueValueSettings','noScoreSettings','autofailSettings'].includes(block)?'scoring':'definition';
      groups[key].appendChild(node);
    }
    const help=document.createElement('p');help.className='hint';help.textContent='Choose the source and calculation, then review scoring or display. Weight uses the existing rank or points multiplier; it is not a percentage contribution.';
    groups.definition.prepend(help);
    const calculation=box.querySelector('[data-cfield="calcType"]');
    if(calculation) [...calculation.options].forEach(option=>option.title=({single:'Aggregate one column, for example sum of appointments.',multi:'Combine two columns with the existing operator.',custom:'Use your existing expression, for example [Appointments]/[Opportunities].',qaScore:'Use mapped QA scores and monitor settings.',checklistCount:'Count matching date rows using row conditions.',displayColumn:'Look up a value without scoring it.',datedStats:'Use the selected dated metric and reporting periods.'})[option.value]||'');
    box.appendChild(body);
    body.dataset.all=String(expanded);
    const found=box.querySelector('[data-model-found-preview-for]');if(found)box.appendChild(found);
  }
  function filter(){
    const q=(byId('modelCriterionSearch')?.value||'').trim().toLowerCase();
    const scope=byId('modelCriterionScope')?.value||'all';
    els.criteriaList?.querySelectorAll('[data-crit]').forEach(box=>{
      const c=getEditCriterion(box.dataset.crit); if(!c) return;
      const hit=(!q||`${c.name} ${describe(c)}`.toLowerCase().includes(q))&&(scope==='all'||(scope==='display'?c.scoreType==='display':scope==='filters'?(c.filters||[]).length>0:c.scoreType!=='display'));
      box.hidden=!hit;
    });
  }
  function decorate(){
    if(!active||!state.editModel) return;
    invalidate();
    const body=els.editModelModal.querySelector('.modalBody');
    if(!byId('modelWorkspace')){
      const host=document.createElement('section'); host.id='modelWorkspace'; host.className='modelWorkspace';
      host.innerHTML='<div class="modelWorkspaceHead"><div><strong>Model workspace</strong><p class="hint">Choose sources, define criteria, then check the results before running a report.</p></div><span id="modelWorkspaceStatus" role="status"></span></div><nav aria-label="Model sections"><button type="button" data-model-jump="modelNameInput">Overview</button><button type="button" data-model-jump="sourceSettingsPanel">Sources</button><button type="button" data-model-section="all">Criteria</button><button type="button" data-model-section="scoring">Scoring</button><button type="button" data-model-section="display">Display fields</button><button type="button" data-model-section="filters">Filters</button><button type="button" data-model-jump="modelWorkspacePreview">Preview</button><button type="button" data-model-jump="modelWorkspaceSummary">Health</button></nav><div id="modelWorkspaceSummary"></div><div class="modelWorkspaceSearch"><label>Find a criterion<input id="modelCriterionSearch" type="search" placeholder="Name, source, or column"></label><label>Show<select id="modelCriterionScope"><option value="all">All criteria</option><option value="scoring">Scoring criteria</option><option value="display">Display fields</option><option value="filters">Criteria with filters</option></select></label></div><div id="modelWorkspacePreview"><button id="modelSamplePreviewBtn" type="button">Preview sample</button> <button id="modelFullRunBtn" type="button">Run saved model</button><p class="hint">Preview up to 30 representatives (or teams for team-only models) using the current unsaved definition and all available dates. Sample ranks are relative to this sample. Reports and saved results are unchanged.</p><div id="modelSamplePreviewResult" role="status"></div></div>';
      body.prepend(host);
      const readiness=document.createElement('details');readiness.className='modelSettingSection';readiness.id='modelReadiness';readiness.innerHTML='<summary>Readiness and field warnings</summary><button type="button" class="smallBtn" id="modelReviewConfigBtn">Check configuration</button><div id="modelReadinessBody" class="modelSettingContent">Check when ready to review missing fields and source requirements.</div>';host.appendChild(readiness);byId('modelReviewConfigBtn').onclick=reviewHealth;
      body.appendChild(byId('modelWorkspacePreview'));
      const sources=document.createElement('details');sources.className='modelSettingSection';sources.innerHTML='<summary>Source settings <span class="hint">Existing mappings and layout controls</span></summary>';
      byId('sourceSettingsPanel').before(sources);sources.appendChild(byId('sourceSettingsPanel'));
      const toggle=document.createElement('button');toggle.type='button';toggle.id='modelAllSettingsBtn';toggle.textContent='Show all settings';
      toggle.setAttribute('aria-pressed',String(expanded));host.appendChild(toggle);
      toggle.onclick=()=>{expanded=!expanded;toggle.setAttribute('aria-pressed',String(expanded));try{localStorage.setItem(preferenceKey,expanded?'all':'focused');}catch(_){};renderEditModel();};
      byId('modelCriterionSearch').oninput=filter; byId('modelCriterionScope').onchange=filter;
      host.addEventListener('click',event=>{
        const jump=event.target.closest('[data-model-jump]');
        if(jump){ const node=byId(jump.dataset.modelJump==='modelWorkspaceSummary'?'modelReadiness':jump.dataset.modelJump);reveal(node); }
        const section=event.target.closest('[data-model-section]');
        if(section){ byId('modelCriterionScope').value=section.dataset.modelSection; filter(); els.criteriaList?.scrollIntoView?.({block:'start'}); }
      });
      byId('modelSamplePreviewBtn').onclick=preview;
      byId('modelFullRunBtn').onclick=async()=>{
        if(!findModel(state.editModel?.id)) return alert('Save this model first, then run it.');
        await runSaved(state.editModel.id);
      };
    }
    els.criteriaList?.querySelectorAll('[data-crit]').forEach((box,i)=>{
      const c=getEditCriterion(box.dataset.crit); if(!c) return;
      const row=box.querySelector('.row');
      groupControls(box,c);
      const title=document.createElement('strong');title.className='modelCriterionName';title.textContent=c.name;row.children[0].after(title);
      const edit=document.createElement('button');edit.type='button';edit.className='smallBtn';edit.dataset.modelEdit=c.id;edit.textContent='Edit';row.insertBefore(edit,row.children[2]);
      const more=document.createElement('details');more.className='modelCriterionMore';more.innerHTML='<summary>More</summary><div class="row"></div>';
      const actions=more.querySelector('.row');row.querySelectorAll('[data-remove-crit],[data-copy-crit]').forEach(n=>actions.appendChild(n));
      actions.insertAdjacentHTML('beforeend',`<button type="button" class="smallBtn" data-model-move="-1" aria-label="Move ${esc(c.name)} up" ${i===0?'disabled':''}>↑</button><button type="button" class="smallBtn" data-model-move="1" aria-label="Move ${esc(c.name)} down" ${i===(state.editModel.criteria.length-1)?'disabled':''}>↓</button><button type="button" class="smallBtn" data-model-research>Research this criterion</button>`);
      row.appendChild(more);
      const note=document.createElement('p');note.className='modelCriterionExplanation hint';note.textContent=describe(c);row.after(note);
    });
    if(!state.editModel.criteria.some(c=>c.id===view().selected))view().selected=state.editModel.criteria[0]?.id;
    focusCriterion(view().selected);
    summary(); filter();
  }
  async function preview(){
    if(previewBusy) return; syncEditModelFields();
    invalidate();
    const model=clonePlain(state.editModel), version=++revision, out=byId('modelSamplePreviewResult');
    const health=modelHealthDiagnostics(model).filter(d=>d.blocking);
    if(health.length){ out.textContent=health.map(d=>d.title).join(' · '); return; }
    previewBusy=true; byId('modelSamplePreviewBtn').disabled=true;
    out.textContent='Preparing source indexes…';
    showProgress('Preparing sample preview…',0);
    try{
      const opts={start:null,end:null,qaDateMode:'interaction',qaTeamScoreMode:'assignedReps',_sourceRowsCache:new Map(),_entryRowsCache:new Map(),_qaSheetTeamRowsCache:new Map(),_criterionFilteredRowsCache:new Map()};
      await ensureSelectedModelPreparedForRun(model,opts);
      if(version!==revision) return;
      const kind=model.criteria.some(c=>criterionAppliesToKind(c,'rep'))?'rep':'team';
      const entries=(kind==='rep'?allRepEntries(model,knownCoachNames()):teamEntries(knownCoachNames())).slice(0,30);
      opts._criterionPlan=compileRunCriterionPlan(model,opts);
      const pack=await computeEntriesAsync(model,entries,kind,opts,{label:'Sample preview'});
      if(version!==revision) return;
      const rows=pack.rows, mean=rows.length?rows.reduce((sum,r)=>sum+r.overallScore,0)/rows.length:0;
      const why=r=>`<details><summary>Why?</summary><p>All available dates · ${esc(r.entry.team||r.entry.name)} · ranks within this sample.</p>${pack.criteria.map(c=>`<p><strong>${esc(c.name)}</strong>: ${esc(r.values[c.id]??'Unavailable')} · ${r.missingScores[c.id]?'No usable scoring value':c.scoreType==='display'?'Displayed value; not scored':'Usable scoring value'} · sample criterion rank ${esc(r.ranks[c.id]??'—')} · contribution ${esc(r.scoreParts[c.id]??'Not scored')}<br>${esc(describe(c))}</p>`).join('')}<p>${esc([...r.autofails,...r.minimumFails].join(' · ')||'No eligibility failure reported by the existing engine.')}</p></details>`;
      out.innerHTML=`<p class="hint">Current draft · ${esc(sourceSummary(model).map(labelSource).join(' · '))} · all available dates · first up to 30 ${kind==='rep'?'representatives':'teams'}. These are sample counts and sample-relative ranks.</p><div class="modelWorkspaceCounts"><span>${rows.length} sampled</span><span>${rows.filter(r=>r.eligible).length} qualifying</span><span>${rows.filter(r=>!r.eligible).length} not qualifying</span><span>${rows.filter(r=>Object.values(r.missingScores).some(Boolean)).length} with unavailable scoring values</span><span>${mean.toFixed(2)} average score</span></div>${rows.length?`<div class="tableWrap"><table><thead><tr><th>${kind==='rep'?'Representative':'Team'}</th><th>Sample rank</th><th>Score</th><th>Status / evidence</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.entry.name)}</td><td>${r.overallRank}</td><td>${Number(r.overallScore).toFixed(2)}</td><td><span>${esc(r.eligible?'Qualifying':r.autofails.concat(r.minimumFails).join(', ')||'Not qualifying')}</span>${why(r)}</td></tr>`).join('')}</tbody></table></div>`:'<p>No usable population is loaded for this preview. Review the selected sources.</p>'}`;
    }catch(error){ if(version===revision) out.textContent=error?.message||String(error); }
    finally{ hideProgress(); previewBusy=false; if(byId('modelSamplePreviewBtn')) byId('modelSamplePreviewBtn').disabled=false; }
  }
  function researchCriterion(cid){
    const model=state.editModel, saved=findModel(model?.id), c=saved?.criteria?.find(c=>c.id===cid);
    if(!saved||!c||stableSerialize(saved)!==stableSerialize(model)) return alert('Save your model changes first so Research uses the same criterion.');
    openResearchItemEditor(null);
    state.editingGuidedResearchActive=false;
    fillGuidedResearchForm({source:c.source||'retail_sv2',guidedPrimarySource:c.source||'retail_sv2',guidedEvidenceSources:[c.source||'retail_sv2'],guidedConditions:[]});
    const expression=`model(${JSON.stringify(saved.id)},${JSON.stringify(c.id)})`;
    const group=c.audience==='team'||c.audience==='coach'?'_team':'_rep';
    els.researchTitleInput.value=`${saved.name} — ${c.name}`; els.researchMode.value='direct';
    els.researchSource.value=c.source||'retail_sv2'; populateResearchFieldSelectors({source:c.source||'retail_sv2',groupField:group});
    els.researchModelSelect.value=saved.id; populateResearchCriteria(c.id);
    const valueMode=c.calcType==='displayColumn'||c.scoreType==='display'?'direct':'expression';
    byId('researchModelEntityKind').value=group==='_team'?'team':'rep';
    els.researchValueMode.value='expression'; els.researchValueField.value=expression;
    els.researchAnalysisGrain.value=group==='_team'?'teams':'representatives';
    state.editingResearchColumns=[{label:c.name,mode:valueMode,field:expression}];
    renderResearchColumnsEditor();
    updateResearchBuilderVisibility();
    window.AllStarResearchWorkspace?.refresh?.();
  }
  function init(){
    if(active||!els.editModelModal) return; active=true;
    const entityKind=document.createElement('input'); entityKind.type='hidden'; entityKind.id='researchModelEntityKind';
    els.researchEditorModal.appendChild(entityKind);
    const openEditor=openResearchItemEditor, readEditor=currentResearchItemFromEditor;
    openResearchItemEditor=function(itemId){ const result=openEditor(itemId); entityKind.value=state.researchItems.find(item=>item.id===itemId)?.modelEntityKind||''; return result; };
    currentResearchItemFromEditor=function(){ return {...readEditor(),modelEntityKind:entityKind.value||undefined}; };
    els.researchAnalysisGrain.addEventListener('change',()=>{ if(entityKind.value) entityKind.value=els.researchAnalysisGrain.value==='teams'?'team':'rep'; });
    const render=renderEditModel;
    renderEditModel=function(...args){
      const scroll=els.editModelModal.querySelector('.modalBody').scrollTop;
      const current=document.activeElement,field=current?.dataset.cfield,cid=current?.closest('[data-crit]')?.dataset.crit;
      const before=new Set([...els.criteriaList.querySelectorAll('[data-crit]')].map(n=>n.dataset.crit));
      els.criteriaList.querySelectorAll('[data-model-group]').forEach(n=>{if(n.closest('.modelCriterionBody').dataset.all!=='true')view().sections.set(n.closest('[data-crit]').dataset.crit+':'+n.dataset.modelGroup,n.open);});
      const result=render(...args);
      const added=state.editModel.criteria.find(c=>!before.has(c.id));if(added&&before.size)view().selected=added.id;
      decorate();
      if(cid&&field) [...els.criteriaList.querySelectorAll('[data-crit]')].find(n=>n.dataset.crit===cid)?.querySelector(`[data-cfield="${field}"]`)?.focus();
      els.editModelModal.querySelector('.modalBody').scrollTop=scroll;
      return result;
    };
    const list=renderModelList;renderModelList=function(...args){const result=list(...args);overview();return result;};renderModelList();
    const foundPreview=renderModelCriterionPreview;renderModelCriterionPreview=function(...args){return '<p class="hint">Current criterion draft · all available dates · matching source rows. Matching a filter does not guarantee a usable scoring value.</p>'+foundPreview(...args);};
    const editEvent=event=>{
      if(event.target.closest('#modelWorkspace')||event.target.closest('#modelWorkspacePreview'))return;
      syncEditModelFields();invalidate();clearTimeout(timer);timer=setTimeout(()=>{summary();els.criteriaList.querySelectorAll('[data-crit]').forEach(box=>{const c=getEditCriterion(box.dataset.crit);box.querySelector('.modelCriterionExplanation').textContent=describe(c);box.querySelector('.modelCriterionName').textContent=c.name;});},220);
    };
    els.editModelModal.addEventListener('input',editEvent);els.editModelModal.addEventListener('change',editEvent);
    const save=saveEditModel;saveEditModel=function(exit){
      syncEditModelFields();const draft=clonePlain(state.editModel),models=clonePlain(state.models),original=state.editOriginalId;
      try{const result=save(exit);summary();return result;}catch(error){state.models=models;state.editModel=draft;state.editOriginalId=original;byId('modelWorkspaceStatus').textContent='Save failed · draft retained: '+(error.message||error);return false;}
    };
    els.criteriaList.addEventListener('click',event=>{
      const box=event.target.closest('[data-crit]'); if(!box) return;
      if(event.target.closest('[data-model-edit]'))focusCriterion(box.dataset.crit);
      const move=event.target.closest('[data-model-move]'); if(move&&moveCriterion(state.editModel,box.dataset.crit,Number(move.dataset.modelMove))) renderEditModel();
      if(event.target.closest('[data-model-research]')) researchCriterion(box.dataset.crit);
    });
  }
  window.AllStarModelWorkspace={init,describe,moveCriterion,preview,focusCriterion,sourceSummary};
})();
