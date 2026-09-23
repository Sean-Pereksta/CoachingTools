/* Model Builder navigation and previews. All scoring stays in the existing engine. */
'use strict';
(function(){
  let active=false, revision=0, timer, previewBusy=false;
  const byId=id=>document.getElementById(id);
  function describe(c){
    const source=c.calcType==='multi'?`${labelSource(c.leftSource||c.source)} / ${labelSource(c.rightSource||c.source)}`:labelSource(c.calcType==='custom'?(c.customSource||c.source):(c.source||'retail_sv2'));
    const measure=c.calcType==='custom'?c.expression:c.calcType==='multi'?`${c.leftColumn||'left value'} ${c.operator||'/'} ${c.rightColumn||'right value'}`:c.column||c.checkColumn||c.calcType||'value';
    const score=c.scoreType==='display'?'shows a display value':c.scoreType==='points'?`multiplies the value by ${Number(c.points)||0} points and weight ${Number(c.weight)||1}`:`ranks ${c.direction==='lower'?'lower':'higher'} values first, with weight ${c.weight||1}`;
    return `${source} → ${measure}; ${score}. Applies to ${c.audience==='rep'?'representatives':c.audience==='team'||c.audience==='coach'?'teams / coaches':'representatives and teams'}.`;
  }
  function moveCriterion(model,cid,offset){
    const list=model?.criteria||[], from=list.findIndex(c=>c.id===cid), to=from+offset;
    if(from<0||to<0||to>=list.length) return false;
    [list[from],list[to]]=[list[to],list[from]]; return true;
  }
  function summary(){
    const model=state.editModel, host=byId('modelWorkspaceSummary'); if(!model||!host) return;
    syncEditModelFields();
    const criteria=model.criteria||[], sources=requiredRunSourcesForModel(model,{});
    const health=typeof modelHealthDiagnostics==='function'?modelHealthDiagnostics(model):[];
    const blocking=health.filter(d=>d.blocking), warnings=health.filter(d=>!d.blocking);
    host.innerHTML=`<div class="modelWorkspaceCounts"><span><strong>${criteria.length}</strong> criteria</span><span><strong>${sources.length}</strong> sources</span><span><strong>${criteria.filter(c=>c.scoreType==='display').length}</strong> display fields</span><span><strong>${blocking.length}</strong> blockers · ${warnings.length} warnings</span></div><div class="hint">${sources.map(s=>esc(labelSource(s))).join(' · ')||'Add a criterion to choose your first data source.'}</div><details><summary>Model health ${blocking.length?'— needs attention':''}</summary>${health.map(d=>`<p class="${d.blocking?'researchWarn':'hint'}"><strong>${esc(d.title)}</strong> ${esc(d.message)}</p>`).join('')||'<p>Ready for a preview or full run.</p>'}</details>`;
    const saved=findModel(model.id), dirty=!saved||stableSerialize(saved)!==stableSerialize(model);
    byId('modelWorkspaceStatus').textContent=dirty?'Unsaved changes':'Saved';
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
    revision++;
    const body=els.editModelModal.querySelector('.modalBody');
    if(!byId('modelWorkspace')){
      const host=document.createElement('section'); host.id='modelWorkspace'; host.className='modelWorkspace';
      host.innerHTML='<div class="modelWorkspaceHead"><div><strong>Model workspace</strong><p class="hint">Choose sources, define criteria, then check the results before running a report.</p></div><span id="modelWorkspaceStatus" role="status"></span></div><nav aria-label="Model sections"><button type="button" data-model-jump="modelNameInput">Overview</button><button type="button" data-model-jump="sourceSettingsPanel">Sources</button><button type="button" data-model-section="all">Criteria</button><button type="button" data-model-section="scoring">Scoring</button><button type="button" data-model-section="display">Display fields</button><button type="button" data-model-section="filters">Filters</button><button type="button" data-model-jump="modelWorkspacePreview">Preview</button><button type="button" data-model-jump="modelWorkspaceSummary">Health</button></nav><div id="modelWorkspaceSummary"></div><div class="modelWorkspaceSearch"><label>Find a criterion<input id="modelCriterionSearch" type="search" placeholder="Name, source, or column"></label><label>Show<select id="modelCriterionScope"><option value="all">All criteria</option><option value="scoring">Scoring criteria</option><option value="display">Display fields</option><option value="filters">Criteria with filters</option></select></label></div><div id="modelWorkspacePreview"><button id="modelSamplePreviewBtn" type="button">Preview sample</button> <button id="modelFullRunBtn" type="button">Run saved model</button><p class="hint">Preview up to 30 representatives (or teams for team-only models) using the current unsaved definition and all available dates. Sample ranks are relative to this sample. Reports and saved results are unchanged.</p><div id="modelSamplePreviewResult" role="status"></div></div>';
      body.prepend(host);
      byId('modelCriterionSearch').oninput=filter; byId('modelCriterionScope').onchange=filter;
      host.addEventListener('click',event=>{
        const jump=event.target.closest('[data-model-jump]');
        if(jump){ const node=byId(jump.dataset.modelJump); node?.scrollIntoView?.({block:'start',behavior:'smooth'}); node?.focus?.(); }
        const section=event.target.closest('[data-model-section]');
        if(section){ byId('modelCriterionScope').value=section.dataset.modelSection; filter(); els.criteriaList?.scrollIntoView?.({block:'start'}); }
      });
      byId('modelSamplePreviewBtn').onclick=preview;
      byId('modelFullRunBtn').onclick=async()=>{
        if(!findModel(state.editModel?.id)) return alert('Save this model first, then run it.');
        await els.runBtn.onclick();
        els.runModelSelect.value=state.editModel.id;
        els.runModelSelect.dispatchEvent(new Event('change',{bubbles:true}));
      };
    }
    els.criteriaList?.querySelectorAll('[data-crit]').forEach((box,i)=>{
      const c=getEditCriterion(box.dataset.crit); if(!c) return;
      const row=box.querySelector('.row');
      if(!box.querySelector('[data-model-move]')){
        row.insertAdjacentHTML('beforeend',`<button type="button" class="smallBtn" data-model-move="-1" aria-label="Move ${esc(c.name)} up" ${i===0?'disabled':''}>↑</button><button type="button" class="smallBtn" data-model-move="1" aria-label="Move ${esc(c.name)} down" ${i===(state.editModel.criteria.length-1)?'disabled':''}>↓</button><button type="button" class="smallBtn" data-model-research>Research this criterion</button>`);
        const note=document.createElement('p'); note.className='modelCriterionExplanation hint'; note.textContent=describe(c); row.after(note);
      }
    });
    summary(); filter();
  }
  async function preview(){
    if(previewBusy) return; syncEditModelFields();
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
      out.innerHTML=`<div class="modelWorkspaceCounts"><span>${rows.length} sampled</span><span>${rows.filter(r=>r.eligible).length} qualifying</span><span>${rows.filter(r=>!r.eligible).length} not qualifying</span><span>${rows.filter(r=>r.noData).length} missing data</span><span>${mean.toFixed(2)} average score</span></div><div class="tableWrap"><table><thead><tr><th>${kind==='rep'?'Representative':'Team'}</th><th>Sample rank</th><th>Score</th><th>Status</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.entry.name)}</td><td>${r.overallRank}</td><td>${Number(r.overallScore).toFixed(2)}</td><td>${esc(r.eligible?'Qualifying':r.autofails.concat(r.minimumFails).join(', ')||'Not qualifying')}</td></tr>`).join('')}</tbody></table></div>`;
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
    renderEditModel=function(...args){ const result=render(...args); decorate(); return result; };
    els.editModelModal.addEventListener('input',()=>{ revision++; clearTimeout(timer); timer=setTimeout(summary,220); if(byId('modelSamplePreviewResult')) byId('modelSamplePreviewResult').textContent='Definition changed. Preview again to update the sample.'; });
    els.criteriaList.addEventListener('click',event=>{
      const box=event.target.closest('[data-crit]'); if(!box) return;
      const move=event.target.closest('[data-model-move]'); if(move&&moveCriterion(state.editModel,box.dataset.crit,Number(move.dataset.modelMove))) renderEditModel();
      if(event.target.closest('[data-model-research]')) researchCriterion(box.dataset.crit);
    });
  }
  window.AllStarModelWorkspace={init,describe,moveCriterion,preview};
})();
