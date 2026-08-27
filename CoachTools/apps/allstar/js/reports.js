/* Run preparation, ranking, reports, teams workspace, exports, and PDF generation.
 * Behavior-preserving extraction from the definitive All-Star application.
 */
'use strict';

async function buildRun(runRequest={}){
  if(runRequest instanceof Event) runRequest={};
  if(!runRequest.org && state.runMode==='multi') return buildMultiRun();
  const settings=runRequest.settings||captureRunExecutionSettings(), model=findModel(settings.modelId||els.runModelSelect?.value); if(!model) return null;
  const start=parseDateOnly(settings.startDate), end=parseDateOnly(settings.endDate); if(start&&end&&start>end){ const err=new Error('Start Date must be on or before End Date.'); if(runRequest.rethrow) throw err; alert(err.message); return null; }
  let teams=[], includeOrgNames=new Set(), excludeOrgNames=new Set();
  if(runRequest.org){
    includeOrgNames=orgCoachSet(runRequest.org); teams=knownCoachNames().filter(t=>includeOrgNames.has(normalizeOrgName(t)));
    if(!teams.length){ const err=new Error(`Organization "${runRequest.org.name}" does not contain any coaches found in the imported data.`); if(runRequest.rethrow) throw err; alert(err.message); return null; }
  }else{
    const selectedTeams=(settings.selectedTeams||[]).map(canonicalCoachName).filter(Boolean); includeOrgNames=selectedRunOrgSet(new Set(settings.includeOrgIds||[])); excludeOrgNames=selectedRunOrgSet(new Set(settings.excludeOrgIds||[]));
    if(!selectedTeams.length&&!includeOrgNames.size){ alert('Select at least one team or include org before running the report.'); return null; }
    teams=[...new Map([...selectedTeams,...knownCoachNames().filter(t=>includeOrgNames.has(normalizeOrgName(t)))].map(t=>[coachNameKey(t),canonicalCoachName(t)])).values()].filter(t=>!excludeOrgNames.has(normalizeOrgName(t)));
    if(!teams.length){ alert('No teams/coaches remain after org filters.'); return null; }
  }
  const qaDateMode=settings.qaDateMode||'interaction', qaTeamScoreMode=settings.qaTeamScoreMode||'assignedReps', view=settings.view||'both';
  resetExpressionRunStats();
  const opts={start,end,qaDateMode,qaTeamScoreMode,teamSpecificRepRanking:!!settings.teamSpecificRepRanking,selectedTeamNames:teams.slice(),organizationId:runRequest.org?.id||'',organizationName:runRequest.org?.name||'',_sourceRowsCache:new Map(),_entryRowsCache:new Map(),_qaSheetTeamRowsCache:new Map(),_criterionFilteredRowsCache:new Map(),runId:'run_'+Date.now().toString(36)};
  const oldRunText=els.executeRunBtn?.textContent||'';
  if(els.executeRunBtn&&!runRequest.multi){ els.executeRunBtn.disabled=true; els.executeRunBtn.textContent='Running...'; }
  try{
    const label=runRequest.org?.name?`${runRequest.org.name}: `:'', totalStart=performance.now(), perfStart=runPerfSnapshot(); console.groupCollapsed(`[All Star Run] ${runRequest.org?.name||'Single report'}`); console.time('[All Star Run] Total time from click to visible report');
    showProgress(`${label}determining required sources...`,2); await yieldToBrowser();
    console.time('[All Star Run] Required sources'); const plan=compileRunCriterionPlan(model,{qaTeamScoreMode,qaDateMode}); opts._criterionPlan=plan; console.timeEnd('[All Star Run] Required sources'); console.info('requiredSources',plan.requiredSources);
    updateProgress(`${label}awaiting matching preparation jobs`,8); console.time('[All Star Run] Awaited jobs');
    console.time('[All Star Run] Remaining preparation after final click'); await ensureSelectedModelPreparedForRun(model,{qaTeamScoreMode,qaDateMode}); console.timeEnd('[All Star Run] Awaited jobs'); console.timeEnd('[All Star Run] Remaining preparation after final click');
    console.time('[All Star Run] Reused indexes'); console.info('Run index counters',runPerfDelta(perfStart)); console.timeEnd('[All Star Run] Reused indexes');
    updateProgress(`${label}filtering rows by date`,18); console.time('[All Star Run] Date filtering'); const teamEntryList=teamEntries(teams), repEntryList=allRepEntries(model,teams); console.timeEnd('[All Star Run] Date filtering');
    console.time('[All Star Run] Team scoring'); const teamRows=await computeEntriesAsync(model,teamEntryList,'team',opts,{start:22,end:48,label:`${label}scoring teams`}); console.timeEnd('[All Star Run] Team scoring');
    console.time('[All Star Run] Representative scoring'); let repRows=await computeEntriesAsync(model,repEntryList,'rep',opts,{start:48,end:88,label:`${label}scoring representatives`}); console.timeEnd('[All Star Run] Representative scoring');
    console.time('[All Star Run] Rank calculation'); repRows=applyHideNoScoreRepOption(repRows); const teamRepRows=opts.teamSpecificRepRanking?buildTeamScopedRepresentativePack(repRows):repRows; console.timeEnd('[All Star Run] Rank calculation'); updateProgress(`${label}rendering report`,96); await yieldToBrowser();
    renderResults(model,teamRows,repRows,view,start,end,qaDateMode,opts,teamRepRows); console.timeEnd('[All Star Run] Total time from click to visible report'); console.info('[All Star Run] Perf counters',runPerfDelta(perfStart),'visibleMs',Math.round(performance.now()-totalStart)); console.groupEnd();
    if(runRequest.org&&els.workArea) els.workArea.querySelector('.reportMeta')?.insertAdjacentHTML('beforeend',`<span class="badge">Organization: ${esc(runRequest.org.name)}</span>`);
    else { const inc=(settings.includeOrgIds||[]).map(idv=>(state.orgs||[]).find(o=>o.id===idv)?.name).filter(Boolean), exc=(settings.excludeOrgIds||[]).map(idv=>(state.orgs||[]).find(o=>o.id===idv)?.name).filter(Boolean); if((inc.length||exc.length)&&els.workArea) els.workArea.querySelector('.reportMeta')?.insertAdjacentHTML('beforeend',`<span class="badge">Include Orgs: ${esc(inc.join(', ')||'None')}</span><span class="badge">Exclude Orgs: ${esc(exc.join(', ')||'None')}</span>`); }
    if(els.workArea) els.workArea.insertAdjacentHTML('beforeend',expressionSummaryPanel('Model run expression diagnostics')); updateProgress(`${label}report generated`,100); await yieldToBrowser(); saveRunSettings();
    if(!runRequest.keepModalOpen) closeModal('runModal'); return state.lastRenderedReport;
  }catch(err){
    console.error(err); if(runRequest.rethrow) throw err; alert(`The report could not finish running.${err?.message?' '+err.message:''}`); return null;
  }finally{
    if(els.executeRunBtn&&!runRequest.multi){ els.executeRunBtn.disabled=false; els.executeRunBtn.textContent=oldRunText||'Run Single Report'; } if(!runRequest.keepProgress) hideProgress();
  }
}
async function buildMultiRun(){
  if(state.multiRunActive) return;
  const orgs=[...(state.multiRunOrgIds||[])].map(idv=>(state.orgs||[]).find(o=>o.id===idv)).filter(Boolean); if(!orgs.length){ alert('Select at least one organization for the multi report.'); return; }
  const settings=captureRunExecutionSettings(), pdfOptions=mergePdfOptions(state.pdfOptions||loadPdfOptions()); if(!pdfHasAnyContent(pdfOptions)){ alert('Choose at least one PDF winner or breakdown option before running MultiReport.'); return; }
  if(!jsPDFCtor()){ alert('The PDF library did not load. Check the internet connection, refresh, and try again.'); return; }
  const oldText=els.executeRunBtn?.textContent||''; state.multiRunActive=true; if(els.executeRunBtn){ els.executeRunBtn.disabled=true; els.executeRunBtn.textContent=`Running 1 of ${orgs.length}...`; } saveRunSettings();
  const completed=[], failed=[];
  try{
    for(let i=0;i<orgs.length;i++){
      const org=orgs[i]; if(els.executeRunBtn) els.executeRunBtn.textContent=`Running ${i+1} of ${orgs.length}: ${org.name}`; showProgress(`MultiReport ${i+1} of ${orgs.length}: generating ${org.name}`,Math.floor(i/orgs.length*100)); await yieldToBrowser();
      try{ const report=await buildRun({org,settings,multi:true,keepModalOpen:true,keepProgress:true,rethrow:true}); if(!report) throw new Error('No report was produced.'); await exportPDF({report,fileNameBase:org.name,keepProgress:true,silent:true,progressLabel:`MultiReport ${i+1} of ${orgs.length}: exporting ${org.name}`}); completed.push(org.name); }
      catch(err){ console.error(`MultiReport failed for ${org.name}`,err); failed.push(`${org.name}: ${err?.message||err}`); }
      await yieldToBrowser();
    }
    updateProgress(`MultiReport finished: ${completed.length} exported${failed.length?`, ${failed.length} failed`:''}`,100); await yieldToBrowser(); closeModal('runModal');
    alert(`MultiReport complete. ${completed.length} organization PDF${completed.length===1?'':'s'} exported.${failed.length?`\n\nCould not export:\n${failed.join('\n')}`:''}`);
  }finally{ state.multiRunActive=false; if(els.executeRunBtn){ els.executeRunBtn.disabled=false; els.executeRunBtn.textContent=oldText||'Run & Export Selected Orgs'; } hideProgress(); }
}
function missingRankForCriterion(c){ return Math.max(1,Number(c.missingRank)||999); }
function missingPointsForCriterion(c){ return Number(c.missingPoints)||0; }
function criterionAllowsZero(c){ return !!c.zeroCanWin; }
function isScorableValue(c,v){ return Number.isFinite(v) && (v!==0 || criterionAllowsZero(c)); }
function criterionHasUsableValue(c,v){ return c?.calcType==='displayColumn' ? rawDisplayCellValue(v)!==null : isScorableValue(c,v); }
function criterionAppliesToKind(c,kind){ return c?.audience==='both'||c?.audience===kind||(kind==='team'&&c?.audience==='coach'); }
function rowSortScore(row){ return Number(row.overallScore)||0; }
function rowZeroBottom(row,kind){ return kind==='rep' && rowSortScore(row)===0 && !row.zeroCanWinOverall; }
function compareScoredRows(a,b,kind){
  if(a.eligible!==b.eligible) return a.eligible?-1:1;
  const aZero=rowZeroBottom(a,kind), bZero=rowZeroBottom(b,kind);
  if(aZero!==bZero) return aZero?1:-1;
  const av=rowSortScore(a), bv=rowSortScore(b);
  if(av!==bv) return av-bv;
  return a.entry.name.localeCompare(b.entry.name);
}
function assignOverallRanks(rows,kind){
  let lastKey=null, rank=0;
  rows.forEach(r=>{
    const key=[r.eligible?'eligible':'ineligible',rowZeroBottom(r,kind)?'zeroBottom':'normal',rowSortScore(r)].join('|');
    if(key!==lastKey){ rank+=1; lastKey=key; }
    r.overallRank=rank;
  });
}
function visibleMedalRankForRow(r,kind){ return kind==='rep' ? r.visibleMedalRank : r.overallRank; }
function medalForRow(r,kind){
  const medalRank=visibleMedalRankForRow(r,kind);
  if(kind!=='rep' || !r.eligible || rowZeroBottom(r,kind)) return '';
  if(medalRank===1) return '<span class="medalBadge gold" title="Gold">🥇</span>';
  if(medalRank===2) return '<span class="medalBadge silver" title="Silver">🥈</span>';
  if(medalRank===3) return '<span class="medalBadge bronze" title="Bronze">🥉</span>';
  return '';
}
function topRowClass(r,kind){ const medalRank=visibleMedalRankForRow(r,kind); return kind==='rep' && medalRank<=3 && r.eligible && !rowZeroBottom(r,kind) ? 'topRank' : ''; }
function firstWinningRow(rows,kind){ return (rows||[]).find(r=>r.eligible && !rowZeroBottom(r,kind)) || null; }
function rowHighlightClasses(r,kind,context={}){
  const out=[];
  const top=topRowClass(r,kind); if(top) out.push(top);
  if(kind==='team' && context.winningTeam===r) out.push('winningTeamRow');
  if(kind==='rep' && context.teamWinner===r) out.push('teamWinningRep');
  return out.join(' ');
}
function winnerBadge(kind){
  return kind==='team' ? '<span class="teamWinnerBadge">🏆 Winning Team</span>' : '<span class="teamRepWinnerBadge">⭐ Team Winner</span>';
}
function assignVisibleRepMedalRanks(rows){
  let lastKey=null, rank=0;
  (rows||[]).forEach(r=>{
    delete r.visibleMedalRank;
    if(!r.eligible || rowZeroBottom(r,'rep')) return;
    const key=rowSortScore(r);
    if(key!==lastKey){ rank+=1; lastKey=key; }
    r.visibleMedalRank=rank;
  });
}
function applyNoScoreForRank(rows,c,weight){
  const assigned=missingRankForCriterion(c);
  rows.forEach(r=>{
    const v=r.values[c.id];
    if(!isScorableValue(c,v)){
      r.ranks[c.id]=assigned;
      r.missingScores[c.id]=true;
    }
    if(c.scoreType==='rank' && Number.isFinite(r.ranks[c.id])){
      r.scoreParts[c.id]=r.ranks[c.id]*weight;
      r.overallScore+=r.scoreParts[c.id];
    }
    if(v===0 && criterionAllowsZero(c)) r.zeroCanWinOverall=true;
  });
}
async function computeEntriesAsync(model, entries, kind, opts, progress={}){
  const criteria=(opts?._criterionPlan ? (kind==='team'?opts._criterionPlan.teamCriteria:opts._criterionPlan.repCriteria).map(p=>p.criterion) : (model.criteria||[]).filter(c=>criterionAppliesToKind(c,kind)));
  const rows=entries.map(entry=>({entry, values:{}, ranks:{}, scoreParts:{}, missingScores:{}, overallScore:0, eligible:true, autofails:[], minimumFails:[], zeroCanWinOverall:false}));
  const start=Number(progress.start)||0, end=Number(progress.end)||100, span=end-start;
  const totalValueOps=Math.max(1,criteria.length*Math.max(1,rows.length));
  let done=0;
  const update=(label,extra=0)=>updateProgress(label, start + span*Math.min(.98,(done+extra)/totalValueOps));
  const chunkSize=35;
  for(const c of criteria){
    for(let i=0;i<rows.length;i++){
      rows[i].values[c.id]=criterionValue(c,rows[i].entry,opts);
      done++;
      if(done%chunkSize===0){ update(`${progress.label||'Scoring'}: ${esc(c.name||'criterion')}`); await yieldToBrowser(); }
    }
  }
  const applicableCriteria=criteria.filter(c=>c.scoreType!=='display');
  rows.forEach(r=>{
    const has=applicableCriteria.length ? applicableCriteria.some(c=>Number.isFinite(r.values[c.id])) : criteria.some(c=>criterionHasUsableValue(c,r.values[c.id]));
    r.hasAnyData=has; r.noData=!has;
    if(!has){ r.eligible=false; if(!r.minimumFails.includes('No imported data')) r.minimumFails.push('No imported data'); }
  });
  criteria.forEach(c=>{
    if(c.scoreType==='rank'){
      const valid=rows.filter(r=>isScorableValue(c,r.values[c.id]));
      valid.sort((a,b)=> c.direction==='lower' ? a.values[c.id]-b.values[c.id] : b.values[c.id]-a.values[c.id]);
      let last=null, rank=0;
      valid.forEach((r,i)=>{ const v=r.values[c.id]; if(last===null || v!==last) rank=i+1; r.ranks[c.id]=rank; last=v; });
    }
  });
  update(`${progress.label||'Scoring'}: applying no-score rules`,.25); await yieldToBrowser();
  rows.forEach(r=>{
    criteria.forEach(c=>{
      const v=r.values[c.id]; const isAutofailItem=String(c.weight)==='autofail'; const weight=isAutofailItem?0:Number(c.weight||1);
      if(isAutofailItem && c.minimumEnabled && (!Number.isFinite(v) || v < Number(c.minimum||0))){ r.eligible=false; r.minimumFails.push(c.name); }
      if(isAutofailItem && autofailHit(v,c)){ r.eligible=false; r.autofails.push(c.name); }
      if(c.scoreType==='rank'){
        applyNoScoreForRank([r],c,weight);
      }
      if(c.scoreType==='points'){
        if(isScorableValue(c,v)){
          r.scoreParts[c.id]=v*Number(c.points||0)*Math.max(1,weight||1);
          if(v===0 && criterionAllowsZero(c)) r.zeroCanWinOverall=true;
        }else{
          r.scoreParts[c.id]=missingPointsForCriterion(c);
          r.missingScores[c.id]=true;
        }
        if(Number.isFinite(r.scoreParts[c.id])) r.overallScore+=r.scoreParts[c.id];
      }
    });
  });
  rows.sort((a,b)=>compareScoredRows(a,b,kind));
  assignOverallRanks(rows,kind);
  if(kind==='rep') assignVisibleRepMedalRanks(rows);
  update(`${progress.label||'Scoring'} complete`,1);
  await yieldToBrowser();
  return {criteria, rows};
}
function computeEntries(model, entries, kind, opts){
  const criteria=(model.criteria||[]).filter(c=>criterionAppliesToKind(c,kind));
  const rows=entries.map(entry=>({entry, values:{}, ranks:{}, scoreParts:{}, missingScores:{}, overallScore:0, eligible:true, autofails:[], minimumFails:[], zeroCanWinOverall:false}));
  criteria.forEach(c=> rows.forEach(r=>{r.values[c.id]=criterionValue(c,r.entry,opts);}));
  const applicableCriteria=criteria.filter(c=>c.scoreType!=='display');
  rows.forEach(r=>{
    const has=applicableCriteria.length ? applicableCriteria.some(c=>Number.isFinite(r.values[c.id])) : criteria.some(c=>criterionHasUsableValue(c,r.values[c.id]));
    r.hasAnyData=has; r.noData=!has;
    if(!has){ r.eligible=false; if(!r.minimumFails.includes('No imported data')) r.minimumFails.push('No imported data'); }
  });
  criteria.forEach(c=>{
    if(c.scoreType==='rank'){
      const valid=rows.filter(r=>isScorableValue(c,r.values[c.id]));
      valid.sort((a,b)=> c.direction==='lower' ? a.values[c.id]-b.values[c.id] : b.values[c.id]-a.values[c.id]);
      let last=null, rank=0;
      valid.forEach((r,i)=>{ const v=r.values[c.id]; if(last===null || v!==last) rank=i+1; r.ranks[c.id]=rank; last=v; });
    }
  });
  rows.forEach(r=>{
    criteria.forEach(c=>{
      const v=r.values[c.id]; const isAutofailItem=String(c.weight)==='autofail'; const weight=isAutofailItem?0:Number(c.weight||1);
      if(isAutofailItem && c.minimumEnabled && (!Number.isFinite(v) || v < Number(c.minimum||0))){ r.eligible=false; r.minimumFails.push(c.name); }
      if(isAutofailItem && autofailHit(v,c)){ r.eligible=false; r.autofails.push(c.name); }
      if(c.scoreType==='rank') applyNoScoreForRank([r],c,weight);
      if(c.scoreType==='points'){
        if(isScorableValue(c,v)){
          r.scoreParts[c.id]=v*Number(c.points||0)*Math.max(1,weight||1);
          if(v===0 && criterionAllowsZero(c)) r.zeroCanWinOverall=true;
        }else { r.scoreParts[c.id]=missingPointsForCriterion(c); r.missingScores[c.id]=true; }
        if(Number.isFinite(r.scoreParts[c.id])) r.overallScore+=r.scoreParts[c.id];
      }
    });
  });
  rows.sort((a,b)=>compareScoredRows(a,b,kind));
  assignOverallRanks(rows,kind);
  if(kind==='rep') assignVisibleRepMedalRanks(rows);
  return {criteria, rows};
}
function buildTeamScopedRepresentativePack(repPack){
  const criteria=repPack?.criteria||[], grouped=new Map();
  (repPack?.rows||[]).forEach(row=>{
    const team=canonicalCoachName(row.entry?.team)||row.entry?.team||'No Team', key=coachNameKey(team)||'__no_team__';
    if(!grouped.has(key)) grouped.set(key,{team,rows:[]});
    grouped.get(key).rows.push(row);
  });
  const rescored=[];
  [...grouped.values()].sort((a,b)=>a.team.localeCompare(b.team)).forEach(group=>{
    const rows=group.rows.map(row=>({
      ...row,
      entry:{...row.entry},
      values:{...(row.values||{})},
      ranks:{},
      scoreParts:{},
      missingScores:{},
      overallScore:0,
      zeroCanWinOverall:false,
      autofails:[...(row.autofails||[])],
      minimumFails:[...(row.minimumFails||[])],
      rankingScope:'team'
    }));
    criteria.forEach(c=>{
      if(c.scoreType!=='rank') return;
      const valid=rows.filter(r=>isScorableValue(c,r.values[c.id]));
      valid.sort((a,b)=>c.direction==='lower'?a.values[c.id]-b.values[c.id]:b.values[c.id]-a.values[c.id]);
      let last=null, rank=0;
      valid.forEach((r,i)=>{ const value=r.values[c.id]; if(last===null||value!==last) rank=i+1; r.ranks[c.id]=rank; last=value; });
    });
    rows.forEach(r=>{
      criteria.forEach(c=>{
        const value=r.values[c.id], isAutofailItem=String(c.weight)==='autofail', weight=isAutofailItem?0:Number(c.weight||1);
        if(c.scoreType==='rank') applyNoScoreForRank([r],c,weight);
        if(c.scoreType==='points'){
          if(isScorableValue(c,value)){
            r.scoreParts[c.id]=value*Number(c.points||0)*Math.max(1,weight||1);
            if(value===0&&criterionAllowsZero(c)) r.zeroCanWinOverall=true;
          }else{
            r.scoreParts[c.id]=missingPointsForCriterion(c);
            r.missingScores[c.id]=true;
          }
          if(Number.isFinite(r.scoreParts[c.id])) r.overallScore+=r.scoreParts[c.id];
        }
      });
    });
    rows.sort((a,b)=>compareScoredRows(a,b,'rep'));
    assignOverallRanks(rows,'rep');
    assignVisibleRepMedalRanks(rows);
    rescored.push(...rows);
  });
  return {criteria,rows:rescored,rankingScope:'team'};
}

function autofailHit(v,c){
  if(!Number.isFinite(v)) return false;
  const t=Number(c.autofailThreshold||1);
  if(c.autofailOperator==='greaterThan') return v>t;
  if(c.autofailOperator==='equals') return v===t;
  return v>=t;
}

function sourceDateRangeText(src,rows){ const vals=(rows||[]).map(r=>rowDateMillisForSource(src,r)).filter(Number.isFinite); return vals.length ? `${ymd(new Date(Math.min(...vals)))} – ${ymd(new Date(Math.max(...vals)))}` : 'No mapped dates'; }
function dataHealthPanelHtml(){
  const indexCurrent=dataIndexReady();
  const rows=allSourceKeys().map(src=>{ const headers=sourceHeaders(src)||[], rows=sourceRows(src)||[], cfg=getSourceSetting(activeModelForImport(),src); const imported=sourceHasImportedData(src); const fw=isCustomSource(src)?` · ${frameworkDef(sourceFramework(src)).label}`:''; const keys=isCustomSource(src)?relevantMappingKeys(src,cfg.framework||sourceFramework(src)):[]; const mapped=keys.filter(k=>cfg.columns?.[k]).length; const mapText=isCustomSource(src)?` · ${mapped}/${keys.length} mappings set`:''; const warn=isCustomSource(src)?customSourceWarnings(src):[]; const cols=cfg.columns||{}; const mappedText=isCustomSource(src)?`<div class="checkResultMeta">Rep: <b>${esc(cols.rep||cols.fullName||'')}</b> · Team: <b>${esc(cols.team||cols.coach||'')}</b> · Date/Week: <b>${esc(cols.date||cols.week||cols.month||'')}</b></div>`:''; const warnText=warn.length?`<div class="checkResultMeta"><span class="badge warn">${warn.map(esc).join('</span> <span class="badge warn">')}</span></div>`:''; return `<div class="checkResultRow ${(imported&&!warn.length)?'okRow':'warnRow'}"><strong>${esc(labelSource(src))}${esc(fw)}</strong><div class="checkResultMeta">${rows.length.toLocaleString()} rows · ${headers.length} headers · ${esc(sourceDateRangeText(src,rows))} · indexes ${indexCurrent&&sourceIndex(src)?'current':'need rebuild'} · header row ${esc(cfg.headerRow||1)} · start column ${esc(cfg.startCol||1)}${mapText}</div>${mappedText}${warnText}</div>`; }).join('');
  return `<details class="panel" open><summary><strong>Data Health</strong> <span class="badge">${allSourceKeys().length} sources checked</span></summary><div class="checkResultList">${rows}</div><div class="checkResultList">${teamTotalsDiagnosticsHtml(state.data.retail.teamTotals)}${teamTotalsDiagnosticsHtml(state.data.referral.teamTotals)}</div></details>`;
}
function modelTraceFieldList(source,c){
  const fields=[], add=f=>{ f=plainHeaderName(f); if(f && !fields.includes(f)) fields.push(f); };
  add('_rep'); add('_team');
  if(c.calcType!=='displayColumn' && (c.calcType==='qaScore' || source==='qa' || isCustomQAStyleSource(source))){
    add('_qaTeam'); const qaCfg=isQADirectRawSource(source)?getSourceSetting(activeModelForImport(),'qa'):getSourceSetting(activeModelForImport(),source); add(c.qaColumns?.team || qaCfg.columns?.team || 'Team'); add(c.qaColumns?.score || qaCfg.columns?.score || 'Score %'); add(c.qaColumns?.date || 'Interaction Start Time'); add('Assigned Date');
  }else{
    add(c.column); add(c.leftColumn); add(c.rightColumn); add(c.withinCompareColumn); add(c.checkColumn); add(c.checkDateColumn);
  }
  (c.filters||[]).forEach(f=>{ add(f.column); add(f.targetValueColumn); });
  return fields.filter(Boolean).slice(0,14);
}
function modelTraceRowRefsForSource(source,rows,fields){
  return (rows||[]).slice(0,2000).map((r,i)=>({source,index:researchRowSourceIndex(source,r),fallback:i,rep:researchTraceRepName(r),team:researchRowTeam(r,source)||rowTeam(r)||'',evidence:researchCompactEvidenceSnapshot(source,r,fields)}));
}
function modelTraceRowsForCriterion(c,entry,opts){
  if(entry.kind==='team' && c.trueValueEnabled && TEAM_TOTAL_SOURCE_KEYS.includes(c.trueValueSource)){ const ds=teamTotalsDataset(c.trueValueSource); ensureTeamTotalsIndex(ds); const row=teamTotalsRowForTeam(ds,entry.team||entry.name||''); const fields=['_team','_controlTab','_summaryLookupKey','_summaryDisplayName','_summarySheet','_summaryRowNumber',c.trueValueColumn].filter(Boolean); return {trueValue:true,sourceKeys:[c.trueValueSource],refs:row?modelTraceRowRefsForSource(c.trueValueSource,[row],fields):[],rows:row?[row]:[],fields}; }
  if(c.calcType==='displayColumn'){
    const source=c.source||'retail_sv2', fields=['_rep','_team',c.column].filter(Boolean); let rows=[];
    if(entry.kind==='team' && TEAM_TOTAL_SOURCE_KEYS.includes(source)){ const ds=teamTotalsDataset(source); ensureTeamTotalsIndex(ds); const row=teamTotalsRowForTeam(ds,entry.team||entry.name||''); if(row) rows=[row]; }
    else if(entry.kind!=='team'){ const displayOpts={...opts,start:null,end:null,dateColumn:''}; rows=rowsForEntry(source,entry,displayOpts); if((c.filters||[]).length) rows=applyFilters(rows,c.filters,source,displayOpts); }
    return {displayColumn:true,sourceKeys:[source],refs:modelTraceRowRefsForSource(source,rows,fields),rows,fields};
  }
  if(c.calcType==='qaScore' || c.source==='qa' || isCustomQAStyleSource(c.source)){
    const source=directQATeamScoreMode(c,entry,opts) ? activeDirectQASource() : (c.source||'qa'), rows=qaRowsForEntry(c,entry,opts), fields=modelTraceFieldList(source,c);
    return {sourceKeys:[source], refs:modelTraceRowRefsForSource(source,rows,fields), rows, fields};
  }
  if(isRowPullCriterion(c)){
    const source=rowPullSourceForCriterion(c), rowPullOpts={...opts,dateColumn:c.checkDateColumn,checkValueType:c.checkValueType||'text'};
    let rows=rowsForEntry(source, entry, rowPullOpts); rows=applyFilters(rows,c.filters,source,rowPullOpts);
    const conditions=ensureRowPullConditions(c).map(cond=>({...cond,column:resolveColumn(source,cond.column),dateColumn:resolveColumn(source,cond.dateColumn||c.checkDateColumn)})).filter(cond=>cond.column && String(cond.phrasesText||'').trim());
    if(conditions.length) rows=rows.filter(r=>checklistRowPassesConditions(source,r,entry,rowPullOpts,conditions));
    const fields=modelTraceFieldList(source,c);
    return {sourceKeys:[source], refs:modelTraceRowRefsForSource(source,rows,fields), rows, fields};
  }
  if(c.calcType==='multi'){
    const leftRows=applyFilters(rowsForEntry(c.leftSource,entry,opts),c.filters,c.leftSource,opts);
    const rightRows=applyFilters(rowsForEntry(c.rightSource,entry,opts),c.filters,c.rightSource,opts);
    const leftFields=modelTraceFieldList(c.leftSource,{...c,column:c.leftColumn}), rightFields=modelTraceFieldList(c.rightSource,{...c,column:c.rightColumn});
    return {sourceKeys:[c.leftSource,c.rightSource].filter(Boolean), refs:[...modelTraceRowRefsForSource(c.leftSource,leftRows,leftFields),...modelTraceRowRefsForSource(c.rightSource,rightRows,rightFields)], rows:[...leftRows,...rightRows], fields:[...new Set([...leftFields,...rightFields])]};
  }
  const source=c.customSource||c.source||'retail_sv2', extra=isCustomWeeklyStatSource(source)?(customSource(source)?.columns||{}):{};
  let rows=rowsForEntry(source,entry,{...opts,dateBasis:extra.dateBasis,weekStart:extra.weekStart});
  rows=applyFilters(rows,c.filters,source,{...opts,dateBasis:extra.dateBasis,weekStart:extra.weekStart});
  const fields=modelTraceFieldList(source,c);
  return {sourceKeys:[source], refs:modelTraceRowRefsForSource(source,rows,fields), rows, fields};
}
function modelTraceCalcLines(c,row,kind,cellType,traceRows,opts){
  const entry=row.entry, value=row.values?.[c.id], score=Number.isFinite(row.scoreParts?.[c.id]) ? row.scoreParts[c.id] : row.ranks?.[c.id];
  const sourceKeys=traceRows.sourceKeys||[], lines=[`${kind==='team'?'Team':'Representative'}: ${entry.name}`,`Criterion: ${c.name}`,`Cell: ${cellType==='score'?'Score / rank':'Value'}`,`Source: ${sourceKeys.map(s=>labelSource(s)||s).join(', ')}`,`Matching rows after date range and filters: ${(traceRows.refs||[]).length.toLocaleString()}`];
  if(traceRows.displayColumn){ lines.push('Display Column',`Selected column: ${c.column||''}`,`Raw saved value: ${rawDisplayCellValue(value)??''}`,'This value is displayed without numeric conversion and does not affect scoring.');
  }else if(traceRows.trueValue){ const r=(traceRows.rows||[])[0]||{}, raw=r[c.trueValueColumn]; lines.push('True Team Value',`Value source: ${labelSource(c.trueValueSource)}`,`Selected column: ${c.trueValueColumn}`,`Team: ${entry.name}`,`Control tab: ${r._controlTab||''}`,`AA2 lookup key: ${r._summaryLookupKey||''}`,`Original summary name: ${r._summaryDisplayName||''}`,`Summary sheet: ${r._summarySheet||''}`,`Summary row: ${r._summaryRowNumber||''}`,`Raw source value: ${raw??''}`,`Parsed value: ${fmt(value,c.format)}`,'No representative aggregation was performed.');
  }else if(c.calcType==='qaScore' || c.source==='qa' || isCustomQAStyleSource(c.source)){
    const directTeamMode=directQATeamScoreMode(c,entry,opts);
    const mode=entry.kind==='team' ? (directTeamMode?'Direct raw QA upload: Assigned Date + QA Team + Score':'assigned representative roster') : 'representative name match';
    const calcSource=directTeamMode ? activeDirectQASource() : (c.source||'qa');
    const scoreColumn=qaScoreColumnForCriterion(calcSource,c);
    const nums=(traceRows.rows||[]).map(r=>scoreColumn?normalizeScore(scoreColumn==='_score'?r._score:r[scoreColumn]):(Number.isFinite(r._score)?r._score:NaN)).filter(Number.isFinite);
    lines.push(`QA team match mode: ${mode}`,`QA direct source used: ${activeDirectQASourceLabel()}`,`QA Assigned Date column used in direct team mode: ${qaLiteralAssignedDateColumn(calcSource)||'Assigned Date (not found)'}`,`QA Team column used in direct team mode: ${qaTeamColumnForCriterion(calcSource,c)||'Team (not found)'}`,`QA Score column averaged: ${scoreColumn||'Score % (not found)'}`,`${nums.length.toLocaleString()} numeric QA score rows averaged`,nums.length?`Average: ${nums.reduce((a,b)=>a+b,0).toFixed(2)} / ${nums.length} = ${fmt(value,c.format)}`:'No numeric QA scores found');
    if(c.minimumMonitors) lines.push(`Minimum monitors required: ${c.minimumMonitors}`);
  }else if(c.calcType==='multi'){
    lines.push(`Multi calculation: ${c.leftSource}.${c.leftColumn} ${c.operator} ${c.rightSource}.${c.rightColumn}`,`Result: ${fmt(value,c.format)}`);
  }else if(c.calcType==='custom'){
    lines.push(`Expression: ${c.expression||''}`,`Result: ${fmt(value,c.format)}`);
  }else{
    lines.push(`Aggregate: ${c.aggregate||'sum'}`,`Column: ${c.column||''}`,`Result: ${fmt(value,c.format)}`);
  }
  if(cellType==='score'){
    if(c.scoreType==='rank') lines.push(`Rank assigned: ${fmt(row.ranks?.[c.id],'number')}`,`Weight: ${String(c.weight)==='autofail'?'autofail':(c.weight||1)}`,`Score part: ${fmt(score,'number')}`);
    if(c.scoreType==='points') lines.push(`Points formula: ${fmt(value,c.format)} × ${c.points||0} × ${Math.max(1,Number(c.weight)||1)}`,`Score part: ${fmt(score,'number')}`);
    if(row.missingScores?.[c.id]) lines.push('No-score rule was applied to this criterion.');
  }
  return lines;
}
function createModelCellTrace(model,c,row,kind,cellType,opts){
  // Keep report rendering fast: store only a lightweight descriptor here.
  // Full evidence rows are resolved only if the user clicks the cell.
  if(!state.researchTraceStore) state.researchTraceStore=new Map();
  const traceId='mt_'+id();
  state.researchTraceStore.set(traceId,{traceId,_lazyModelTrace:true,model,c,row,kind,cellType,opts:opts||{}});
  return traceId;
}
function materializeModelCellTrace(traceId){
  const pending=state.researchTraceStore?.get(traceId);
  if(!pending || !pending._lazyModelTrace) return pending;
  const {model,c,row,kind,cellType,opts}=pending;
  const tr=modelTraceRowsForCriterion(c,row.entry,opts||{});
  const trace={traceId,title:model.name||'Model result',displayValue:cellType==='score'?scoreDisplay(row,c).replace(/<[^>]+>/g,''):valueDisplay(row,c).replace(/<[^>]+>/g,''),displayValueRaw:cellType==='score'?(row.scoreParts?.[c.id]??row.ranks?.[c.id]):row.values?.[c.id],valueMode:c.calcType||c.aggregate||'model',formula:c.expression||c.column||c.qaColumns?.score||'',sourceKeys:tr.sourceKeys,groupContext:{rowLabel:row.entry.name,columnLabel:`${c.name} ${cellType==='score'?'Score':'Value'}`},cohortContext:{rowCount:(tr.rows||[]).length},calculationLines:modelTraceCalcLines(c,row,kind,cellType,tr,opts||{}),matchedRows:tr.refs||[],evidenceFields:tr.fields||[],matchedEntities:researchTraceEntityList(tr.rows||[],tr.sourceKeys?.[0]||c.source),warnings:[]};
  state.researchTraceStore.set(traceId,trace);
  return trace;
}
function modelTraceCell(html,traceId){ return `<button class="researchTraceCell" style="border:0;background:transparent;padding:0;font:inherit;color:inherit" data-model-trace="${esc(traceId)}" type="button">${html}</button>`; }
function bindModelTraceCells(){
  els.workArea?.querySelectorAll('[data-model-trace]').forEach(b=>b.onclick=e=>{
    e.stopPropagation();
    materializeModelCellTrace(b.dataset.modelTrace);
    openResearchCellFeedback(b.dataset.modelTrace);
  });
}
function rosterReconciliationHtml(repPack,runOpts={}){
  if(!hasTrustedControlRoster() || !repPack) return '';
  const selected=runOpts.selectedTeamNames||[];
  const displayedByTeam=new Map();
  (repPack.rows||[]).forEach(r=>{ const k=coachNameKey(r.entry.team||''); displayedByTeam.set(k,(displayedByTeam.get(k)||0)+1); });
  const cards=selected.map(team=>{
    const roster=repsForTeam(team), displayed=displayedByTeam.get(coachNameKey(team))||0;
    const noData=(repPack.rows||[]).filter(r=>coachNameKey(r.entry.team||'')===coachNameKey(team) && Object.values(r.missingScores||{}).some(Boolean));
    const conflicts=(trustedRosterMaps().conflicts||[]).filter(c=>(c.possibleTeams||[]).some(t=>coachNameKey(t)===coachNameKey(team)));
    const warn=displayed!==roster.length || conflicts.length;
    const noDataList=roster.filter(rr=>!(repPack.rows||[]).some(r=>r.entry.rosterId===rr.rosterId || (r.entry.key===rr.key&&coachNameKey(r.entry.team)===coachNameKey(team))));
    return `<details class="panel" ${warn?'open':''}><summary><strong>${esc(team)} roster reconciliation</strong> <span class="badge">Trusted roster: ${roster.length}</span> <span class="badge">Displayed representatives: ${displayed}</span> <span class="badge">Without scores: ${noData.length+noDataList.length}</span> ${conflicts.length?`<span class="badge warn">${conflicts.length} conflicts</span>`:''}</summary>${warn?'<div class="checkResultRow warnRow">Warning: roster count differs from displayed count or unresolved identity conflicts exist. Ambiguous source rows are excluded from scoring.</div>':''}<details><summary>Roster representatives with no data</summary><div class="checkResultList">${noDataList.map(r=>`<div class="checkResultRow"><strong>${esc(r.name)}</strong><div class="checkResultMeta">Trusted team: ${esc(team)} · Source roster: ${esc(r.sourceArea||'')} · Tab: ${esc(r.tabName||r.sheetName||'')} · Row: ${esc(r.rowNumber||'')}</div></div>`).join('')||'<div class="checkResultRow okRow">No missing roster representatives.</div>'}</div></details><details><summary>Ambiguous or conflicting identities</summary><div class="checkResultList">${conflicts.map(c=>`<div class="checkResultRow warnRow"><strong>${esc(c.originalName||'Conflict')}</strong><div class="checkResultMeta">${esc(c.message||'')} · Teams: ${esc((c.possibleTeams||[]).join(', '))} · Status: ${esc(c.status||'unresolved')}</div></div>`).join('')||'<div class="checkResultRow okRow">No identity conflicts for this team.</div>'}</div></details></details>`;
  }).join('');
  return `<div class="resultSection"><h2>Roster Reconciliation</h2>${cards}</div>`;
}
function trueValueDiagnosticsHtml(runOpts={}){
  const all=Array.isArray(runOpts.trueValueDiagnostics)?runOpts.trueValueDiagnostics:[], failures=all.filter(d=>d?.reason);
  if(!all.length) return '';
  const unique=[] , seen=new Set();
  failures.forEach(d=>{ const key=[d.criterion,d.team,d.source,d.column,d.reason].join('\u001f'); if(!seen.has(key)){ seen.add(key); unique.push(d); } });
  const successCount=all.length-failures.length;
  const rows=unique.map(d=>`<div class="checkResultRow badRow"><strong>${esc(d.team||'Unknown team')} · ${esc(d.criterion||'True Value')}</strong><div class="checkResultMeta">${esc(labelSource(d.source)||d.source||'')} · ${esc(d.reason||'')} ${d.column?`· Column: <b>${esc(d.column)}</b>`:''}</div></div>`).join('');
  return `<details class="panel" ${unique.length?'open':''}><summary><strong>True Team Value Check</strong> <span class="badge ${unique.length?'warn':'good'}">${successCount} matched · ${unique.length} failed</span></summary><div class="checkResultList">${rows||'<div class="checkResultRow okRow"><strong>All configured true team values matched.</strong></div>'}</div></details>`;
}
function renderResults(model, teamPack, repPack, view, start, end, qaDateMode, runOpts={}, teamRepPack=repPack){
  state.lastRenderedReport={model,teamPack,repPack,teamRepPack,view,start,end,qaDateMode,runOpts};
  const html=[];
  const dateText=(start&&end)?`${ymd(start)} to ${ymd(end)}`:'All available dates';
  const teamCount=(state.selectedTeams||new Set()).size || runTeamNames().length;
  const qaDateBadge=modelUsesQA(model) ? `<span class="badge">QA Dates: ${qaDateMode==='assigned'?'Assigned Date':'Interaction Start Time'}</span>` : '';
  const qaTeamBadge=modelUsesQA(model) ? `<span class="badge">QA Team Scores: ${(runOpts.qaTeamScoreMode||'assignedReps')==='sheetTeam'?`Direct raw QA upload: ${esc(activeDirectQASourceLabel())}`:'Assigned representatives'}</span>` : '';
  const rankingBadge=`<span class="badge">Representative ranking: ${runOpts.teamSpecificRepRanking?'team-specific on team pages; overall on Total Representatives':'overall across the selected population'}</span>`;
  const rosterCount=(runOpts.selectedTeamNames||[]).reduce((n,t)=>n+repsForTeam(t).length,0);
  const rosterBadge=hasTrustedControlRoster()?`<span class="badge">Trusted roster: ${rosterCount.toLocaleString()}</span><span class="badge">Displayed representatives: ${(repPack?.rows?.length||0).toLocaleString()}</span><span class="badge">Hidden without scores: ${Math.max(0,rosterCount-(repPack?.rows?.length||0)).toLocaleString()}</span>`:'';
  state.researchTraceStore=new Map();
  const reportHeader=`<div class="reportHeader"><h1 class="resultTitle">${esc(model.name)}</h1><div class="reportMeta"><span class="badge">Date Range: ${esc(dateText)}</span><span class="badge">Teams: ${teamCount}</span><span class="badge">View: ${esc(view==='both'?'Teams + Representatives':view==='team'?'Teams':'Representatives')}</span>${qaDateBadge}${qaTeamBadge}${rankingBadge}${rosterBadge}<span class="badge">Medals: 🥇 first, 🥈 second, 🥉 third</span></div></div>`;
  html.push(`<div id="pdfContent">`);
  html.push(`<section class="pdfPage pdfOverviewPage">${reportHeader}${dataHealthPanelHtml()}${trueValueDiagnosticsHtml(runOpts)}${rosterReconciliationHtml(repPack,runOpts)}${(view==='both'||view==='team')?sectionTable('Team Breakdown',teamPack,'team',model,runOpts):''}</section>`);
  if(view==='both'||view==='rep') html.push(`<section class="pdfPage pdfTotalsPage"><div class="teamPageHeading"><h2>Total Representatives</h2><span class="badge">${repPack.rows.length.toLocaleString()} representatives · overall ranking</span></div>${sectionTable('Total Representative Ranking',repPack,'rep',model,runOpts)}</section>`);
  if(view==='both'||view==='rep') html.push(repTeamPages(teamRepPack,teamPack,model,runOpts));
  html.push('</div>');
  els.workArea.innerHTML=html.join('');
  bindModelTraceCells();
}
function repTeamPages(repPack,teamPack,model,runOpts={}){
  const byTeam=new Map();
  repPack.rows.forEach(r=>{const t=r.entry.team||'No Team';if(!byTeam.has(t))byTeam.set(t,[]);byTeam.get(t).push(r);});
  const teamRows=new Map((teamPack?.rows||[]).map(r=>[coachNameKey(r.entry.name),r]));
  return Array.from(byTeam.keys()).sort((a,b)=>a.localeCompare(b)).map(team=>{
    const reps=byTeam.get(team)||[];
    const teamRow=teamRows.get(coachNameKey(team));
    const teamSection=teamRow?sectionTable('Team Section',{criteria:teamPack.criteria||[],rows:[teamRow]},'team',model,runOpts):'';
    const repSection=`<div class="resultSection"><h2>Individual Team Representatives</h2><div class="tableWrap"><table>${sectionRowsOnly(repPack.criteria,reps,'rep',model,runOpts)}</table></div></div>`;
    return `<section class="pdfPage pdfTeamPage" data-pdf-team="${esc(team)}"><div class="teamPageHeading"><h2>${esc(team)}</h2><span class="badge">${reps.length.toLocaleString()} representative${reps.length===1?'':'s'} · ${runOpts.teamSpecificRepRanking?'team-specific ranking':'overall scoring'}</span></div>${teamSection}${repSection}</section>`;
  }).join('');
}

function displayMissingText(c){
  if(c.displayMissingMode==='na') return 'N/A';
  if(c.displayMissingMode==='notFound') return 'Not Found';
  if(c.displayMissingMode==='zero') return '0';
  if(c.displayMissingMode==='custom') return c.displayMissingText||'';
  return '';
}
function displayRuleMatches(rule,value){
  const blank=rawDisplayCellValue(value)===null;
  if(rule.op==='blank') return blank;
  if(rule.op==='notBlank') return !blank;
  if(blank) return false;
  if(rule.op==='contains') return normalizeResearchText(value).includes(normalizeResearchText(rule.value));
  if(rule.op==='equals'){ const a=toNum(value), b=toNum(rule.value); return Number.isFinite(a)&&Number.isFinite(b)?a===b:normalizeResearchText(value)===normalizeResearchText(rule.value); }
  if(rule.op==='dateWithin'||rule.op==='dateOlder'){ const d=parseDateOnly(value)||parseWeekLabel(value); if(!d) return false; const days=Math.floor(Math.abs(Date.now()-d.getTime())/86400000), n=Math.max(0,Number(rule.value)||0); return rule.op==='dateWithin'?days<=n:days>n; }
  const n=toNum(value), a=toNum(rule.value), b=toNum(rule.value2); if(!Number.isFinite(n)||!Number.isFinite(a)) return false;
  if(rule.op==='greater') return n>a; if(rule.op==='greaterEqual') return n>=a; if(rule.op==='less') return n<a; if(rule.op==='lessEqual') return n<=a; if(rule.op==='between') return Number.isFinite(b)&&n>=Math.min(a,b)&&n<=Math.max(a,b);
  return false;
}
function formatLookupDisplayValue(c,value){
  if(rawDisplayCellValue(value)===null) return displayMissingText(c);
  if(c.displayValueType==='percent'){ const n=toNum(value); return Number.isFinite(n)?`${(Math.abs(n)<=1?n*100:n).toLocaleString(undefined,{maximumFractionDigits:2})}%`:String(value); }
  if(c.displayValueType==='number'){ const n=toNum(value); return Number.isFinite(n)?n.toLocaleString(undefined,{maximumFractionDigits:2}):String(value); }
  if(c.displayValueType==='date'){ const d=parseDateOnly(value)||parseWeekLabel(value); return d?d.toLocaleDateString():String(value); }
  return String(value);
}
function displayRuleComparableValue(c,value){
  if(c.displayValueType!=='percent') return value;
  const n=toNum(value); return Number.isFinite(n)&&Math.abs(n)<=1?n*100:value;
}
function matchingLookupDisplayRule(c,value){ return (c.displayRules||[]).find(r=>displayRuleMatches(r,displayRuleComparableValue(c,value))); }
function lookupDisplayHtml(c,value){
  const rule=matchingLookupDisplayRule(c,value), text=rule?.display||formatLookupDisplayValue(c,value);
  if(!text && !rule) return '—';
  const color=rule?.color&&rule.color!=='none'?` lookup-${rule.color}`:'', style=rule?.style==='badge'?' lookupDisplayBadge':' lookupDisplayValue';
  return `<span class="${style.trim()}${color}">${esc(text)}</span>`;
}
function lookupDisplayCellClass(c,value){ const rule=matchingLookupDisplayRule(c,value); return rule?.style==='cell'&&rule.color&&rule.color!=='none'?`lookup-cell-${rule.color}`:''; }
function valueDisplay(r,c){
  if(c.calcType==='displayColumn') return lookupDisplayHtml(c,r.values?.[c.id]);
  return r.missingScores&&r.missingScores[c.id] ? '<span class="badge warn">No score</span>' : fmt(r.values[c.id],c.format);
}
function scoreDisplay(r,c){
  const score=Number.isFinite(r.scoreParts[c.id]) ? r.scoreParts[c.id] : r.ranks[c.id];
  if(r.missingScores&&r.missingScores[c.id]){
    if(c.scoreType==='rank') return `${fmt(score,'number')} <span class="badge warn">rank ${fmt(r.ranks[c.id],'number')}</span>`;
    if(c.scoreType==='points') return `${fmt(score,'number')} <span class="badge warn">no score</span>`;
  }
  return fmt(score,'number');
}
function criterionReportHeaderHtml(c,kind){
  if(c.calcType==='displayColumn') return `<th>${esc(c.name)}</th>`;
  return `<th class="right">${esc(c.name)} Value${kind==='team'&&c.trueValueEnabled?'<br><span class="badge">True Team Value</span>':''}</th><th class="right">${esc(c.name)} Score</th>`;
}
function criterionReportCellsHtml(model,c,r,kind,runOpts={}){
  if(c.calcType==='displayColumn') return `<td class="${lookupDisplayCellClass(c,r.values?.[c.id])}">${modelTraceCell(valueDisplay(r,c),createModelCellTrace(model,c,r,kind,'value',runOpts))}</td>`;
  return `<td class="right">${modelTraceCell(valueDisplay(r,c),createModelCellTrace(model,c,r,kind,'value',runOpts))}</td><td class="right">${modelTraceCell(scoreDisplay(r,c),createModelCellTrace(model,c,r,kind,'score',runOpts))}</td>`;
}
function sectionTable(title, pack, kind, model, runOpts={}){
  const criteria=pack.criteria||[];
  const context={winningTeam:kind==='team'?firstWinningRow(pack.rows,'team'):null};
  const head=`<tr><th>Rank</th><th>${kind==='team'?'Team':'Representative'}</th>${kind==='rep'?'<th>Team</th>':''}<th class="right">Score</th><th>Eligible</th>${criteria.map(c=>criterionReportHeaderHtml(c,kind)).join('')}<th>Autofail</th></tr>`;
  const body=pack.rows.map(r=>`<tr class="${rowHighlightClasses(r,kind,context)}"><td>${r.overallRank}${medalForRow(r,kind)}</td><td>${esc(r.entry.name)}${kind==='team'&&context.winningTeam===r?winnerBadge('team'):''}</td>${kind==='rep'?`<td>${esc(r.entry.team||'')}</td>`:''}<td class="right">${fmt(r.overallScore,'number')}</td><td>${r.eligible?'<span class="badge good">Yes</span>':'<span class="badge bad">No</span>'}</td>${criteria.map(c=>criterionReportCellsHtml(model,c,r,kind,runOpts)).join('')}<td>${esc([...r.autofails,...r.minimumFails].join(', '))}</td></tr>`).join('');
  return `<div class="resultSection"><h2>${esc(title)}</h2><div class="tableWrap"><table>${head}${body}</table></div></div>`;
}
function repByTeamSection(pack, model, runOpts={}){
  const byTeam=new Map();
  pack.rows.forEach(r=>{ const t=r.entry.team||'No Team'; if(!byTeam.has(t)) byTeam.set(t,[]); byTeam.get(t).push(r); });
  let html='<div class="resultSection"><h2>Representative Breakdown</h2>';
  Array.from(byTeam.keys()).sort((a,b)=>a.localeCompare(b)).forEach(t=>{ html+=`<h3>${esc(t)}</h3><div class="tableWrap"><table>${sectionRowsOnly(pack.criteria,byTeam.get(t),'rep',model,runOpts)}</table></div>`; });
  html+='</div>'; return html;
}
function sectionRowsOnly(criteria, rows, kind, model, runOpts={}){
  const teamWinner=firstWinningRow(rows,'rep');
  const localRanks=new Map(); let localRank=0,lastScore=null;
  (rows||[]).forEach(r=>{ if(!r.eligible||rowZeroBottom(r,'rep')) return; const score=rowSortScore(r); if(score!==lastScore){localRank++;lastScore=score;} localRanks.set(r,localRank); });
  const head=`<tr><th>Team Rank</th><th>Representative</th><th class="right">Score</th><th>Eligible</th>${criteria.map(c=>criterionReportHeaderHtml(c,kind)).join('')}<th>Autofail</th></tr>`;
  const body=rows.map(r=>`<tr class="${rowHighlightClasses(r,'rep',{teamWinner})}"><td>${localRanks.get(r)||'-'}${medalForRow(r,'rep')}</td><td>${esc(r.entry.name)}${teamWinner===r?winnerBadge('rep'):''}</td><td class="right">${fmt(r.overallScore,'number')}</td><td>${r.eligible?'<span class="badge good">Yes</span>':'<span class="badge bad">No</span>'}</td>${criteria.map(c=>criterionReportCellsHtml(model,c,r,kind,runOpts)).join('')}<td>${esc([...r.autofails,...r.minimumFails].join(', '))}</td></tr>`).join('');
  return head+body;
}
function populateRunModels(){
  const prev=els.runModelSelect.value;
  els.runModelSelect.innerHTML=state.models.map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join('');
  if(prev && state.models.some(m=>m.id===prev)) els.runModelSelect.value=prev;
  renderTeamSelect();
  updateRunQADateField();
}
function syncTeamSelectionsFromDom(){
  if(!els.teamSelectGrid) return;
  els.teamSelectGrid.querySelectorAll('input[type="checkbox"]').forEach(x=>{
    if(x.checked) state.selectedTeams.add(x.value); else state.selectedTeams.delete(x.value);
  });
}
function visibleTeams(){
  const q=String(state.teamSearch||'').toLowerCase().trim();
  return runTeamNames().filter(t=>!q || String(t).toLowerCase().includes(q));
}
function updateTeamCount(){
  if(!els.teamCountBadge) return;
  const total=runTeamNames().length, selected=(state.selectedTeams||new Set()).size, visible=visibleTeams().length;
  els.teamCountBadge.textContent=`${selected} selected • ${visible}/${total} shown`;
}
function renderTeamSelect(){
  const teams=runTeamNames();
  if(!state.selectedTeams) state.selectedTeams=new Set();
  if(!state.teamSelectionInitialized && teams.length){ state.selectedTeams=new Set(teams); state.teamSelectionInitialized=true; }
  const shown=visibleTeams();
  els.teamSelectGrid.innerHTML=shown.length ? shown.map(t=>`<label class="checkItem"><input type="checkbox" value="${esc(t)}" ${state.selectedTeams.has(t)?'checked':''}> ${esc(t)}</label>`).join('') : '<div class="checkItem">No teams match the search.</div>';
  els.teamSelectGrid.querySelectorAll('input[type="checkbox"]').forEach(x=>x.onchange=()=>{ state.teamSelectionInitialized=true; if(x.checked) state.selectedTeams.add(x.value); else state.selectedTeams.delete(x.value); updateTeamCount(); saveRunSettings(); });
  updateTeamCount();
}
function setVisibleTeamsChecked(checked){
  state.teamSelectionInitialized=true;
  visibleTeams().forEach(t=>checked?state.selectedTeams.add(t):state.selectedTeams.delete(t));
  renderTeamSelect(); saveRunSettings();
}
function importedTeamCounts(){
  return (currentTeamIndex().teamCounts||[]).slice().sort((a,b)=>a.team.localeCompare(b.team));
}
function repsForTeam(team){
  const idx=currentTeamIndex(), key=coachNameKey(team);
  const direct=(idx.repsByTeam||new Map()).get(team);
  if(direct) return direct.slice().sort((a,b)=>a.name.localeCompare(b.name));
  for(const [candidate,reps] of (idx.repsByTeam||new Map()).entries()){
    if(coachNameKey(candidate)===key) return (reps||[]).slice().sort((a,b)=>a.name.localeCompare(b.name));
  }
  return [];
}
function updateRowsToTeam(rows, headers, keySet, newTeam, headerCandidates){
  const teamH=findHeader(headers||[],headerCandidates||['Team','Team Name','Team_Name','Coach Assigned','Coach']);
  (rows||[]).forEach(r=>{
    if(keySet.has(r._repKey)){
      r._team=canonicalCoachName(newTeam);
      r._teamAssignedManually=true;
      if(teamH) r[teamH]=r._team;
    }
  });
}
async function moveSelectedRepsToTeam(){
  const selected=Array.from(els.teamRepList.querySelectorAll('input[type="checkbox"]:checked')).map(x=>x.value);
  const newTeam=els.teamMoveSelect.value;
  if(!selected.length){ els.teamMoveStatus.textContent='Select at least one representative.'; return; }
  if(!newTeam){ els.teamMoveStatus.textContent='Select a new team.'; return; }
  showProgress('Updating team assignments...',10);
  try{
    await yieldToBrowser();
    const keySet=new Set(selected);
    (state.data.retail.controlRoster||[]).forEach(r=>{ if(keySet.has(r._repKey||nameKey(r._rep||r.representative))){ r._team=canonicalCoachName(newTeam); r.team=r._team; r._teamAssignedManually=true; } });
    (state.data.referral.controlRoster||[]).forEach(r=>{ if(keySet.has(r._repKey||nameKey(r._rep||r.representative))){ r._team=canonicalCoachName(newTeam); r.team=r._team; r._teamAssignedManually=true; } });
    updateRowsToTeam(state.data.retail.sv2,state.data.retail.headers.sv2,keySet,newTeam,['Team_Name','Team Name','Team','Coach']);
    updateRowsToTeam(state.data.retail.wiper,state.data.retail.headers.wiper,keySet,newTeam,['Team_Name','Team Name','Team','Coach']);
    updateRowsToTeam(state.data.referral.sv2,state.data.referral.headers.sv2,keySet,newTeam,['Team_Name','Team Name','Team','Coach']);
    updateRowsToTeam(state.data.referral.wiper,state.data.referral.headers.wiper,keySet,newTeam,['Team_Name','Team Name','Team','Coach']);
    updateRowsToTeam(state.data.qa.rows,state.data.qa.headers,keySet,newTeam,['Team']);
    updateRowsToTeam(state.data.checklist.rows,state.data.checklist.headers,keySet,newTeam,['Coach Assigned','Coach','Team']);
    updateRowsToTeam(state.data.documented_coaching.rows,state.data.documented_coaching.headers,keySet,newTeam,['Job Coach','Coach Assigned','Coach','Team']);
    updateRowsToTeam(state.data.comp_calls.rows,state.data.comp_calls.headers,keySet,newTeam,['CSR Team/Coach','Coach Assigned','Coach','Team']);
    const canonicalNewTeam=canonicalCoachName(newTeam);
    selected.forEach(k=>state.repTeams.set(k,canonicalNewTeam));
    await finishDataChanged('team assignment update',45);
    state.activeTeam=canonicalNewTeam;
    els.teamMoveStatus.textContent=`Moved ${selected.length} representative${selected.length===1?'':'s'} to ${canonicalNewTeam}.`;
    renderTeamsImportedModal();
  }catch(err){ console.error(err); alert('Team move failed. Check the console for details.'); }
  finally{ hideProgress(); }
}
function visibleTeamRepRows(){ return Array.from(els.teamRepList?.querySelectorAll('input[type="checkbox"]')||[]); }
function setVisibleTeamRepsChecked(checked){ visibleTeamRepRows().forEach(x=>{ x.checked=checked; }); }
function repCandidateCacheSignature(){
  const v=state.versions||{};
  return [v.data||0,v.roster||0,v.teams||0,v.mappings||0,v.aliases||0,dataIndexSignature()].join('|');
}
function allRepConnectionCandidates(){
  const signature=repCandidateCacheSignature();
  if(state.repCandidateCache?.signature===signature) return state.repCandidateCache.candidates;
  const reps=new Map();
  allSourceKeys().forEach(src=>(getRowsRaw(src)||[]).forEach(r=>{
    const sourceArea=sourceAreaForSource(src)||(r?._sourceArea||'');
    const name=canonicalRepName(r?._rep||r?.Representative||r?.representative||r?.['Agent Name']||r?.['Associate Name']||r?.['Associate name']||r?.Name||'',sourceArea);
    const key=nameKey(name);
    if(!key||!name) return;
    const mapKey=`${sourceArea}\u0000${key}`;
    if(!reps.has(mapKey)) reps.set(mapKey,{key,name,sourceArea,rows:0,teams:new Set(),teamKeys:new Set(),tokens:cleanName(name).split(/\s+/).filter(Boolean).map(norm)});
    const rec=reps.get(mapKey);
    rec.rows++;
    const team=rowTeam(r)||r._team||'';
    if(team){ rec.teams.add(team); rec.teamKeys.add(coachNameKey(team)); }
  }));
  const candidates=[...reps.values()].map(r=>({...r,bucketStem:repSuggestionBucketKey(r.name,r.sourceArea,'')}));
  state.repCandidateCache={signature,candidates,builtAt:Date.now(),sourceRowScanCount:allSourceKeys().reduce((n,src)=>n+(getRowsRaw(src)||[]).length,0)};
  return candidates;
}
function lcsLength(a,b){
  a=norm(a); b=norm(b);
  if(!a||!b) return 0;
  const dp=new Array(b.length+1).fill(0);
  for(let i=1;i<=a.length;i++){
    let prev=0;
    for(let j=1;j<=b.length;j++){
      const tmp=dp[j];
      dp[j]=a[i-1]===b[j-1] ? prev+1 : Math.max(dp[j],dp[j-1]);
      prev=tmp;
    }
  }
  return dp[b.length];
}
function orderedNamePercent(a,b){
  const an=norm(a), bn=norm(b);
  if(!an||!bn) return 0;
  if(an===bn) return 100;
  const lcs=lcsLength(an,bn);
  return Math.round((lcs/Math.max(an.length,bn.length))*100);
}
function canonicalRepChoice(a,b){
  const score=x=>{
    const tokens=cleanName(x.name).split(/\s+/).filter(Boolean).length;
    const simple=stripRepNameAnnotations(x.name)===String(x.name||'').trim();
    return (tokens===2?50:0) + (simple?20:0) + Math.min(20,x.rows||0) - Math.abs(tokens-2)*6;
  };
  return score(a)>=score(b) ? a : b;
}
function repSuggestionBucketKey(name,sourceArea='',team=''){
  const p=splitPersonNameForFix(name), first=norm(p.first), last=norm(p.last), prefix=last.slice(0,3);
  return `${sourceArea||''}|${first[0]||''}|${last[0]||''}|${prefix}|${cleanName(name).split(/\s+/).filter(Boolean).length}|${coachNameKey(team||'')}`;
}
function repConnectionSuggestions(threshold=75, scope={}){
  const v=state.versions||{}, activeTeam=scope.team||state.activeTeam||'';
  const cacheKey=[v.data||0,v.roster||0,v.aliases||0,v.teams||0,scope.sourceArea||'',coachNameKey(activeTeam),threshold].join('|');
  if(state.repSuggestionCache?.has(cacheKey)) return state.repSuggestionCache.get(cacheKey);
  const all=allRepConnectionCandidates();
  const activeTeamKey=coachNameKey(activeTeam);
  const reps=activeTeam ? all.filter(r=>(r.teamKeys||new Set()).has(activeTeamKey)) : all;
  const buckets=new Map();
  all.forEach(r=>{
    const teams=[...(r.teams||new Set(['']))]; if(!teams.length) teams.push('');
    teams.forEach(t=>{ const key=repSuggestionBucketKey(r.name,scope.sourceArea||r.sourceArea||'',t); if(!buckets.has(key)) buckets.set(key,[]); buckets.get(key).push(r); });
  });
  const out=[], compared=new Set();
  reps.forEach(a=>{
    const teams=[...(a.teams||new Set(['']))]; if(!teams.length) teams.push('');
    const candidateSet=new Map();
    teams.forEach(t=>(buckets.get(repSuggestionBucketKey(a.name,scope.sourceArea||a.sourceArea||'',t))||[]).forEach(b=>candidateSet.set(b.key,b)));
    // Candidate bucketing prevents organization-wide pairwise fuzzy comparisons; tiny fallback only for small scopes.
    const candidates=candidateSet.size ? [...candidateSet.values()] : (reps.length<=80?reps:[]);
    candidates.forEach(b=>{
      if(a.key===b.key) return;
      const pair=[a.key,b.key].sort().join('\u0000'); if(compared.has(pair)) return; compared.add(pair);
      if(Math.abs(String(a.name||'').length-String(b.name||'').length)>8) return;
      const pct=orderedNamePercent(a.name,b.name);
      if(pct<threshold) return;
      const canonical=canonicalRepChoice(a,b), alias=canonical===a?b:a;
      out.push({aliasKey:alias.key,aliasName:alias.name,canonicalKey:canonical.key,canonicalName:canonical.name,pct,aliasRows:alias.rows,canonicalRows:canonical.rows,sourceArea:scope.sourceArea||alias.sourceArea||canonical.sourceArea||''});
    });
  });
  const used=new Set();
  const result=out.sort((a,b)=>b.pct-a.pct || (b.aliasRows+b.canonicalRows)-(a.aliasRows+a.canonicalRows)).filter(x=>{ if(used.has(x.aliasKey)) return false; used.add(x.aliasKey); return true; });
  state.repSuggestionCache=state.repSuggestionCache||new Map(); state.repSuggestionCache.set(cacheKey,result);
  return result;
}
function rosterEntryByKey(sourceArea,key){
  return ensureRosterIndex().bySourceRepKey.get(sourceRepCompositeKey(sourceArea,key)) || null;
}
function safeFallbackRosterIdentity(row,sourceArea){ return `${sourceArea||row?._sourceArea||'unknown'}|${coachNameKey(row?._team||rowTeam(row)||'')}|${fullNameIdentityKey(row?._rep||row?.representative||'')}`; }
function applyRepAliasMappingsToAllRows(){
  let changed=0;
  revalidateRepAliases();
  const applyRow=(r,src='')=>{
    if(!r || r._isControlRoster===true) return;
    const sourceArea=sourceAreaForSource(src)||r._sourceArea||'global';
    const before=cleanName(r._rawRep||r._rep||r.representative||r.Representative||'');
    if(!before) return;
    if(!r._rawRep){ r._rawRep=before; r._rawRepKey=fullNameIdentityKey(before); }
    const rec=state.repAliases?.get?.(aliasLookupKey(before,sourceArea));
    const next=rec?.canonical ? cleanName(rec.canonical) : before;
    const roster=rosterEntryByKey(sourceArea,fullNameIdentityKey(next));
    const nextKey=roster?._repKey || fullNameIdentityKey(next);
    if(next && (r._rep!==next || r._repKey!==nextKey || r._rosterId!==(roster?.rosterId||r._rosterId))){
      r._rep=roster?._rep||next; r._repKey=nextKey; r._rosterId=roster?.rosterId || r._rosterId || safeFallbackRosterIdentity(r,sourceArea); r._sourceArea=sourceArea; r._aliasApplied=!!rec; r._aliasRecord=rec?{alias:rec.alias,canonical:rec.canonical,sourceArea:rec.sourceArea}:null; r._matchMethod=rec?'alias':(r._matchMethod||'raw');
      if(r.representative!==undefined) r.representative=r._rep;
      changed++;
    }
  };
  allSourceKeys().filter(src=>!TEAM_TOTAL_SOURCE_KEYS.includes(src)).forEach(src=>(getRowsRaw(src)||[]).forEach(r=>applyRow(r,src)));
  // Alias application is intentionally side-effect-light; callers batch one team/index rebuild via finishDataChanged or markDataIndexDirty.
  invalidateRosterIndex('representative aliases applied');
  return changed;
}
function renderTeamConnectionPanel(){
  if(!els.teamConnectList) return;
  const threshold=Number(els.teamConnectThreshold?.value)||75;
  if(els.teamConnectThresholdValue) els.teamConnectThresholdValue.textContent=`${threshold}%`;
  const suggestions=repConnectionSuggestions(threshold,{team:state.activeTeam});
  if(els.teamConnectSummary) els.teamConnectSummary.textContent=`${suggestions.length.toLocaleString()} possible connection${suggestions.length===1?'':'s'} at or above ${threshold}%. Fuzzy suggestions are review-only and are not selected by default.`;
  els.teamConnectList.innerHTML=suggestions.length ? suggestions.slice(0,300).map((s,i)=>`<label class="teamConnectRow"><input type="checkbox" data-connect-rep="${i}"><span>${esc(s.aliasName)}<small>${s.aliasRows.toLocaleString()} row${s.aliasRows===1?'':'s'}</small></span><span>${esc(s.canonicalName)}<small>${s.canonicalRows.toLocaleString()} row${s.canonicalRows===1?'':'s'} · ${s.pct}% connected</small></span><span class="badge">${s.pct}%</span></label>`).join('') : '<div class="checkItem">No likely duplicate names above this margin.</div>';
  els.teamConnectList.dataset.suggestions=JSON.stringify(suggestions.slice(0,300));
}
async function connectRepMatches(onlyChecked=true){
  const suggestions=JSON.parse(els.teamConnectList?.dataset?.suggestions||'[]');
  const checked=new Set(Array.from(els.teamConnectList?.querySelectorAll('[data-connect-rep]:checked')||[]).map(x=>Number(x.dataset.connectRep)));
  const selected=suggestions.filter((_,i)=>!onlyChecked || checked.has(i));
  if(!selected.length){ if(els.teamConnectSummary) els.teamConnectSummary.textContent='No duplicate representative matches selected.'; return; }
  showProgress('Connecting duplicate representative names...',12);
  try{
    selected.forEach(s=>addRepAlias(s.aliasName||s.aliasKey, s.canonicalName, s.sourceArea||sourceAreaForSource(s.source||s.sourceKey)||'retail', {createdBy:'connect'}));
    saveRepAliases();
    const changed=applyRepAliasMappingsToAllRows();
    await finishDataChanged('representative duplicate connection update',45);
    if(els.teamConnectSummary) els.teamConnectSummary.textContent=`Connected ${selected.length.toLocaleString()} duplicate name${selected.length===1?'':'s'} and updated ${changed.toLocaleString()} imported row${changed===1?'':'s'}.`;
    renderTeamsImportedModal();
  }finally{ hideProgress(); }
}
function jaroWinklerScore(a,b){
  a=norm(a); b=norm(b);
  if(!a||!b) return 0;
  if(a===b) return 1;
  const range=Math.max(0,Math.floor(Math.max(a.length,b.length)/2)-1);
  const aMatch=new Array(a.length).fill(false), bMatch=new Array(b.length).fill(false);
  let matches=0;
  for(let i=0;i<a.length;i++){
    const start=Math.max(0,i-range), end=Math.min(i+range+1,b.length);
    for(let j=start;j<end;j++){
      if(bMatch[j] || a[i]!==b[j]) continue;
      aMatch[i]=true; bMatch[j]=true; matches++; break;
    }
  }
  if(!matches) return 0;
  const aChars=[], bChars=[];
  for(let i=0;i<a.length;i++) if(aMatch[i]) aChars.push(a[i]);
  for(let j=0;j<b.length;j++) if(bMatch[j]) bChars.push(b[j]);
  let trans=0;
  for(let i=0;i<aChars.length;i++) if(aChars[i]!==bChars[i]) trans++;
  const jaro=(matches/a.length + matches/b.length + (matches-trans/2)/matches)/3;
  let prefix=0;
  for(let i=0;i<Math.min(4,a.length,b.length);i++){ if(a[i]===b[i]) prefix++; else break; }
  return jaro + prefix*.1*(1-jaro);
}
function sortedTokenName(v){
  return cleanName(v).split(/\s+/).filter(Boolean).map(norm).filter(Boolean).sort().join('');
}
function teamFixTeamScore(a,b){
  const direct=jaroWinklerScore(a,b);
  const sorted=jaroWinklerScore(sortedTokenName(a),sortedTokenName(b));
  const lcs=orderedNamePercent(a,b)/100;
  return Math.round(Math.max(direct,sorted,lcs)*100);
}
function splitPersonNameForFix(name){
  const parts=cleanName(name).split(/\s+/).filter(Boolean);
  if(parts.length<2) return {first:parts[0]||'',last:''};
  return {first:parts[0],last:parts[parts.length-1]};
}
function closeRepFixScore(a,b){
  const ak=nameKey(a), bk=nameKey(b);
  if(ak && bk && ak===bk) return 100;
  const ap=splitPersonNameForFix(a), bp=splitPersonNameForFix(b);
  if(!ap.first||!ap.last||!bp.first||!bp.last) return Math.round(Math.max(jaroWinklerScore(a,b),orderedNamePercent(a,b)/100)*100);
  if(norm(ap.first)[0]!==norm(bp.first)[0]) return 0;
  const lastScore=jaroWinklerScore(ap.last,bp.last);
  if(lastScore<.84) return 0;
  const firstScore=jaroWinklerScore(ap.first,bp.first);
  const firstA=norm(ap.first), firstB=norm(bp.first);
  const lenDiff=Math.abs(firstA.length-firstB.length);
  if(lenDiff>=3 && !(firstA.startsWith(firstB)||firstB.startsWith(firstA))) return 0;
  if(firstScore<.78 && !(lenDiff<=1 && firstA[0]===firstB[0])) return 0;
  return Math.round((firstScore*.58 + lastScore*.42)*100);
}
function bestTargetRepForFix(sourceRep,targetReps){
  let best=null;
  (targetReps||[]).forEach(target=>{
    const pct=closeRepFixScore(sourceRep.name,target.name);
    if(pct>=86 && (!best || pct>best.pct || (pct===best.pct && String(target.name).localeCompare(best.targetName)<0))){
      best={sourceKey:sourceRep.key,sourceName:sourceRep.name,targetKey:target.key,targetName:target.name,pct};
    }
  });
  return best;
}
function buildFixTeamsSuggestions(){
  const counts=importedTeamCounts().filter(x=>coachNameKey(x.team)!==coachNameKey(NA_TEAM));
  const small=counts.filter(x=>x.count>0 && x.count<=3);
  const large=counts.filter(x=>x.count>20);
  const suggestions=[];
  small.forEach(src=>{
    const sourceKey=coachNameKey(src.team);
    const sourceReps=repsForTeam(src.team);
    const matches=large.filter(dst=>coachNameKey(dst.team)!==sourceKey).map(dst=>({
      sourceTeam:src.team,
      sourceTeamKey:sourceKey,
      sourceCount:src.count,
      targetTeam:dst.team,
      targetCount:dst.count,
      teamPct:teamFixTeamScore(src.team,dst.team),
      sourceReps,
      targetReps:repsForTeam(dst.team)
    })).filter(x=>x.teamPct>=86).sort((a,b)=>b.teamPct-a.teamPct || b.targetCount-a.targetCount || a.targetTeam.localeCompare(b.targetTeam));
    matches.forEach((m,i)=>{
      const repMatches=m.sourceReps.map(r=>bestTargetRepForFix(r,m.targetReps)).filter(Boolean);
      const {targetReps,...reviewMatch}=m;
      suggestions.push({...reviewMatch,repMatches,autoChecked:i===0});
    });
  });
  return suggestions.sort((a,b)=>b.teamPct-a.teamPct || a.sourceTeam.localeCompare(b.sourceTeam));
}
function renderFixTeamsReview(){
  if(!els.fixTeamsPanel||!els.fixTeamsReview) return;
  const suggestions=buildFixTeamsSuggestions();
  els.fixTeamsPanel.classList.remove('hidden');
  if(els.fixTeamsSummary){
    const tiny=importedTeamCounts().filter(x=>x.count>0&&x.count<=3).length;
    els.fixTeamsSummary.textContent=suggestions.length
      ? `${suggestions.length.toLocaleString()} likely tiny-team merge option${suggestions.length===1?'':'s'} found from ${tiny.toLocaleString()} team${tiny===1?'':'s'} with 3 or fewer reps. Top option for each tiny team is checked.`
      : `No likely tiny-team fixes found. This only checks teams with 3 or fewer reps against teams with more than 20 reps.`;
  }
  els.fixTeamsReview.dataset.suggestions=JSON.stringify(suggestions);
  els.fixTeamsReview.innerHTML=suggestions.length ? suggestions.map((s,i)=>{
    const repLines=s.sourceReps.map(r=>{
      const hit=s.repMatches.find(m=>m.sourceKey===r.key);
      return `<div class="fixTeamRep">${esc(r.name)}${hit?` -> ${esc(hit.targetName)} <span class="badge">${hit.pct}% rep match</span>`:' -> move as separate rep'}</div>`;
    }).join('');
    return `<label class="fixTeamCard"><div class="fixTeamHead"><input type="checkbox" data-fix-team="${i}" ${s.autoChecked?'checked':''}><div class="fixTeamNames">${esc(s.sourceTeam)} <span class="badge">${s.sourceCount} reps</span> -> ${esc(s.targetTeam)} <span class="badge">${s.targetCount} reps</span><small>Team name match: ${s.teamPct}%</small></div><span class="badge">${s.teamPct}%</span></div><div class="fixTeamRepList">${repLines}</div></label>`;
  }).join('') : '<div class="checkItem">No tiny teams are close enough to a larger coach/team name right now.</div>';
  renderFixRepReview();
}
function buildRosterRepMappingSuggestions(threshold=86){
  const rosterRows=controlRosterRows();
  const rosterByKey=new Map();
  rosterRows.forEach(r=>{ if(r._repKey&&!rosterByKey.has(r._repKey)) rosterByKey.set(r._repKey,{key:r._repKey,name:r._rep,team:r._team,sourceArea:r.sourceArea||r.source||''}); });
  const roster=[...rosterByKey.values()];
  if(!roster.length) return [];
  const buckets=new Map();
  roster.forEach(r=>{
    const p=splitPersonNameForFix(r.name), bucket=`${norm(p.first)[0]||''}|${norm(p.last)[0]||''}`;
    if(!buckets.has(bucket)) buckets.set(bucket,[]);
    buckets.get(bucket).push(r);
  });
  const out=[];
  allRepConnectionCandidates().forEach(src=>{
    if(rosterByKey.has(src.key)) return;
    const p=splitPersonNameForFix(src.name), bucket=`${norm(p.first)[0]||''}|${norm(p.last)[0]||''}`;
    const targets=buckets.get(bucket)||roster;
    let best=null;
    targets.forEach(target=>{
      const pct=closeRepFixScore(src.name,target.name);
      if(pct>=threshold && (!best || pct>best.pct || (pct===best.pct && target.name.localeCompare(best.canonicalName)<0))){
        best={aliasKey:src.key,aliasName:src.name,canonicalKey:target.key,canonicalName:target.name,targetTeam:target.team,sourceArea:target.sourceArea,pct,aliasRows:src.rows};
      }
    });
    if(best) out.push(best);
  });
  const used=new Set();
  return out.sort((a,b)=>b.pct-a.pct || b.aliasRows-a.aliasRows || a.aliasName.localeCompare(b.aliasName)).filter(x=>{
    if(used.has(x.aliasKey)) return false;
    used.add(x.aliasKey);
    return true;
  });
}
function renderFixRepReview(){
  if(!els.fixRepReview) return;
  const suggestions=buildRosterRepMappingSuggestions(86);
  if(els.fixRepSummary){
    const rosterCount=controlRosterRows().length;
    els.fixRepSummary.textContent=rosterCount
      ? `${suggestions.length.toLocaleString()} likely representative mapping${suggestions.length===1?'':'s'} found against ${rosterCount.toLocaleString()} Control-roster rep${rosterCount===1?'':'s'}.`
      : 'No Control roster has been loaded yet. Import Retail or Referral with a Control tab first.';
  }
  els.fixRepReview.dataset.suggestions=JSON.stringify(suggestions);
  els.fixRepReview.innerHTML=suggestions.length ? suggestions.slice(0,400).map((s,i)=>`
    <label class="teamConnectRow">
      <input type="checkbox" data-fix-rep="${i}">
      <span>${esc(s.aliasName)}<small>${s.aliasRows.toLocaleString()} uploaded row${s.aliasRows===1?'':'s'}</small></span>
      <span>${esc(s.canonicalName)}<small>${esc(s.targetTeam||'')} · Control roster</small></span>
      <span class="badge">${s.pct}%</span>
    </label>`).join('') : '<div class="checkItem">No clear representative-name matches to the Control roster right now.</div>';
}
async function applySelectedFixRepMatches(){
  const suggestions=JSON.parse(els.fixRepReview?.dataset?.suggestions||'[]');
  const checked=new Set(Array.from(els.fixRepReview?.querySelectorAll('[data-fix-rep]:checked')||[]).map(x=>Number(x.dataset.fixRep)));
  const selected=suggestions.filter((_,i)=>checked.has(i));
  if(!selected.length){ if(els.fixRepSummary) els.fixRepSummary.textContent='No representative mappings selected.'; return; }
  showProgress('Applying representative mappings...',10);
  try{
    selected.forEach(s=>{ if(s.aliasKey&&s.canonicalName) addRepAlias(s.aliasName||s.aliasKey, s.canonicalName, s.sourceArea||sourceAreaForSource(s.source||s.sourceKey)||'retail', {createdBy:'connect'}); });
    saveRepAliases();
    const changed=applyRepAliasMappingsToAllRows();
    await finishDataChanged('Control roster representative mapping update',45);
    if(els.fixRepSummary) els.fixRepSummary.textContent=`Applied ${selected.length.toLocaleString()} representative mapping${selected.length===1?'':'s'} and updated ${changed.toLocaleString()} row name${changed===1?'':'s'}.`;
    renderFixTeamsReview();
  }catch(err){ console.error(err); alert('Representative mapping failed. Check the console for details.'); }
  finally{ hideProgress(); }
}
function updateAllRowsToTeamForKeys(keySet,newTeam){
  const headersBySource=src=>getHeaders(src)||[];
  (state.data.retail.controlRoster||[]).forEach(r=>{ if(keySet.has(r._repKey||nameKey(r._rep||r.representative))){ r._team=canonicalCoachName(newTeam); r.team=r._team; r._teamAssignedManually=true; } });
  (state.data.referral.controlRoster||[]).forEach(r=>{ if(keySet.has(r._repKey||nameKey(r._rep||r.representative))){ r._team=canonicalCoachName(newTeam); r.team=r._team; r._teamAssignedManually=true; } });
  allSourceKeys().forEach(src=>updateRowsToTeam(getRowsRaw(src)||[],headersBySource(src),keySet,newTeam,['Team','Team Name','Team_Name','Coach','Coach Name','Coach Assigned','CSR Team/Coach','Job Coach','Assigned Coach','QA Coach','Team Lead']));
}
async function applySelectedFixTeams(){
  const suggestions=JSON.parse(els.fixTeamsReview?.dataset?.suggestions||'[]');
  const checked=new Set(Array.from(els.fixTeamsReview?.querySelectorAll('[data-fix-team]:checked')||[]).map(x=>Number(x.dataset.fixTeam)));
  const chosen=suggestions.filter((_,i)=>checked.has(i));
  if(!chosen.length){ if(els.fixTeamsSummary) els.fixTeamsSummary.textContent='No team fixes selected.'; return; }
  const bySource=new Map();
  chosen.forEach(s=>{
    const key=s.sourceTeamKey||coachNameKey(s.sourceTeam);
    const prev=bySource.get(key);
    if(!prev || s.teamPct>prev.teamPct) bySource.set(key,s);
  });
  showProgress('Applying selected team fixes...',10);
  try{
    await yieldToBrowser();
    let aliasCount=0, repMoveCount=0;
    for(const fix of bySource.values()){
      const keys=new Set((fix.sourceReps||[]).map(r=>r.key).filter(Boolean));
      updateAllRowsToTeamForKeys(keys,fix.targetTeam);
      const targetTeam=canonicalCoachName(fix.targetTeam);
      keys.forEach(k=>{ state.repTeams.set(k,targetTeam); repMoveCount++; });
      (fix.repMatches||[]).forEach(m=>{
        if(m.sourceKey && m.targetName && m.sourceKey!==m.targetKey){
          { const added=addRepAlias(m.sourceName||m.sourceKey,m.targetName,sourceAreaForSource(fix.sourceArea||'')||'retail',{createdBy:'fix-teams'}); if(added.ok) aliasCount++; }
        }
      });
    }
    saveRepAliases();
    const changed=applyRepAliasMappingsToAllRows();
    await finishDataChanged('tiny team fix merge',45);
    renderFixTeamsReview();
    if(els.fixTeamsSummary) els.fixTeamsSummary.textContent=`Applied ${bySource.size.toLocaleString()} team merge${bySource.size===1?'':'s'}, moved ${repMoveCount.toLocaleString()} rep assignment${repMoveCount===1?'':'s'}, connected ${aliasCount.toLocaleString()} close rep name${aliasCount===1?'':'s'}, and updated ${changed.toLocaleString()} imported row name${changed===1?'':'s'}.`;
  }catch(err){ console.error(err); alert('Team fix failed. Check the console for details.'); }
  finally{ hideProgress(); }
}
function debounce(fn,wait=180){ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args),wait); }; }
function teamDetailCacheKey(team){
  const v=state.versions||{};
  return `${coachNameKey(team)}|roster:${v.roster||0}|team:${v.teams||0}|alias:${v.aliases||0}|mapping:${v.mappings||0}|data:${v.data||0}`;
}

function renderTeamQuarantinePanel(team, quarantines){
  if(!els.teamQuarantineSummary||!els.teamQuarantineList) return;
  const q=quarantines||quarantinesForTeam(team);
  const org=ensureQuarantineIndex().unassigned||[];
  els.teamQuarantineSummary.textContent=`Quarantined Aliases (${q.length.toLocaleString()} for selected team${org.length?`, ${org.length.toLocaleString()} unassigned organization-level`:''}). These aliases were blocked and are not currently being applied.`;
  const rows=q.map(rec=>{
    const status=[rec.legacy?'legacy':'',rec.createdBy?`created by ${rec.createdBy}`:''].filter(Boolean).join(' · ')||'current quarantine';
    return `<div class="checkItem"><strong>⚠️ ${esc(rec.aliasName||rec.alias)}</strong><br><small>Attempted canonical: ${esc(rec.canonical||'—')} · Source area: ${esc(String(rec.sourceArea||'global').toUpperCase())} · Association: ${esc(rec.association||'unassigned')}${rec.ambiguous?' (ambiguous)':''}</small><br><small>Reason: ${esc(rec.reason||'Quarantined by alias safety validation.')}</small><br><small>Canonical currently on this team: ${rec.canonicalOnTeam?'Yes':'No'} · Alias found in imported rows: ${rec.aliasFoundInRows?'Yes':'No'} · ${esc(status)}</small></div>`;
  });
  const unassigned=org.length ? `<details class="checkItem"><summary><strong>Unassigned quarantined aliases (${org.length.toLocaleString()})</strong></summary>${org.map(rec=>`<div><strong>⚠️ ${esc(rec.aliasName||rec.alias)}</strong><small> → ${esc(rec.canonical||'—')} · ${esc(String(rec.sourceArea||'global').toUpperCase())} · ${esc(rec.reason||'')}</small></div>`).join('')}</details>` : '';
  els.teamQuarantineList.innerHTML=(rows.length?rows.join(''):'<div class="checkItem">No quarantined aliases are associated with this selected team.</div>')+unassigned;
}
let teamSuggestionRenderToken=0;
function scheduleTeamConnectionPanel(team){
  const token=++teamSuggestionRenderToken;
  if(els.teamConnectSummary) els.teamConnectSummary.textContent='Loading fuzzy alias suggestions…';
  if(els.teamConnectList) els.teamConnectList.innerHTML='<div class="checkItem">Loading fuzzy alias suggestions…</div>';
  const run=()=>{
    if(token!==teamSuggestionRenderToken || coachNameKey(state.activeTeam)!==coachNameKey(team)) return;
    renderTeamConnectionPanel();
  };
  if(window.requestIdleCallback) window.requestIdleCallback(run,{timeout:1200}); else setTimeout(run,0);
}
function renderCachedTeamDetails(team){
  const cacheKey=teamDetailCacheKey(team), repQ=String(els.teamRepSearch?.value||'').toLowerCase().trim();
  let detail=state.teamDetailsCache?.get(cacheKey);
  if(!detail){
    const repsAll=repsForTeam(team);
    const conflicts=(trustedRosterMaps().conflicts||[]).filter(c=>(c.possibleTeams||[]).some(t=>coachNameKey(t)===coachNameKey(team)));
    const quarantines=quarantinesForTeam(team);
    detail={repsAll,conflicts,quarantines}; state.teamDetailsCache.set(cacheKey,detail);
  }
  const reps=detail.repsAll.filter(r=>!repQ || String(r.name||'').toLowerCase().includes(repQ));
  els.teamManagerTitle.textContent=`${team} Representatives (${reps.length}/${detail.repsAll.length})`;
  els.teamRepList.innerHTML=(detail.conflicts.length?`<div class="checkItem"><strong>Conflicts:</strong> ${detail.conflicts.length} unresolved identity issue(s) for this team.</div>`:'') + (reps.length ? reps.map(r=>`<label class="repMoveRow"><input type="checkbox" value="${esc(r.rosterId||r.key)}"><span>${esc(r.name)}</span><span class="badge">${esc(r.team)}</span><span class="badge">${esc(r.sourceArea||'trusted')}</span></label>`).join('') : '<div class="checkItem">No representatives match.</div>');
  renderTeamQuarantinePanel(team,detail.quarantines);
}

function renderTeamSummaryList(){
  const idx=currentTeamIndex(), counts=(idx.teamCounts||[]).slice().sort((a,b)=>a.team.localeCompare(b.team));
  const summaries=idx.teamSummaries instanceof Map ? idx.teamSummaries : new Map();
  const q=String(els.teamManagerSearch?.value||'').toLowerCase().trim();
  const shown=counts.filter(x=>!q || x.team.toLowerCase().includes(q));
  if(!state.activeTeam || !counts.some(x=>x.team===state.activeTeam)) state.activeTeam='';
  // Landing screen uses precomputed summary metadata only; representative details load lazily per selected team.
  els.teamManagerList.innerHTML=shown.length ? shown.map(x=>{ const key=coachNameKey(x.team), s=summaries.get(key)||ensureRosterIndex().teamSummaries.get(key)||{}; const conflict=Number(s.conflictCount||0), quarantine=Number(s.quarantinedAliasCount||0); return `<button class="teamCard ${x.team===state.activeTeam?'active':''}" data-team-pick="${esc(x.team)}"><span>${esc(x.team)}<small>${esc(String(s.sourceArea||'').toUpperCase())} · Original Control ${Number(s.originalControlCount||x.count).toLocaleString()} · Manual moves ${Number(s.manualMoveCount||0).toLocaleString()}</small></span><span class="badge ${conflict||quarantine?'warn':'good'}">${conflict||quarantine?'Warning':'Verified'}</span><span class="badge">${x.count} roster reps</span>${conflict?`<span class="badge warn">${conflict} conflicts</span>`:''}${quarantine?`<span class="badge warn">${quarantine} quarantined aliases</span>`:''}</button>`; }).join('') : '<div class="checkItem">No imported teams found.</div>';
  els.teamMoveSelect.innerHTML=counts.map(x=>`<option value="${esc(x.team)}" ${x.team===state.activeTeam?'selected':''}>${esc(x.team)}</option>`).join('');
}
function renderTeamsImportedModal(){
  renderTeamSummaryList();
  els.teamManagerTitle.textContent=state.activeTeam ? `${state.activeTeam} Representatives` : 'Representatives';
  els.teamRepList.innerHTML=state.activeTeam ? '<div class="checkItem">Click the team again to load representatives.</div>' : '<div class="checkItem">Select a team to lazily load representatives.</div>';
  if(els.teamQuarantineSummary) els.teamQuarantineSummary.textContent='Quarantined aliases are shown after selecting a team.';
  if(els.teamQuarantineList) els.teamQuarantineList.innerHTML='';
  if(els.teamConnectList) els.teamConnectList.innerHTML='<div class="checkItem">Fuzzy duplicate suggestions load only after selecting a team.</div>';
  if(els.teamConnectSummary) els.teamConnectSummary.textContent='Fuzzy matching is review-only and never applied automatically.';
}
async function loadTeamDetails(team){
  state.activeTeam=team; renderTeamSummaryList();
  els.teamManagerTitle.textContent=`${team} Representatives`;
  renderCachedTeamDetails(team);
  scheduleTeamConnectionPanel(team);
}
function openTeamsImported(){
  renderTeamsImportedModal();
  openModal('teamsModal');
}

function runPrepState(){
  state.runPrep=state.runPrep||{generation:0,jobs:new Map(),ready:new Map(),dateRangeCache:new Map(),lastRequired:[],lastModelId:''};
  state.runPrep.jobs=state.runPrep.jobs||new Map();
  state.runPrep.ready=state.runPrep.ready||new Map();
  state.runPrep.dateRangeCache=state.runPrep.dateRangeCache||new Map();
  state.runIndexes=state.runIndexes instanceof Map ? state.runIndexes : new Map();
  state.runPreparationJobs=state.runPreparationJobs instanceof Map ? state.runPreparationJobs : new Map();
  return state.runPrep;
}
const RUN_INDEX_SCHEMA_VERSION=2, RUN_INDEX_NORMALIZATION_VERSION=1;
function runSourceSettingsSignature(source){ const cfg=getSourceSetting(activeModelForImport(),source)||{}; return stableSerialize({skipTeamBuild:!!cfg?.columns?.skipTeamBuild,columns:cfg.columns||{},source:cfg.source||''}); }
function sourceVersionSignature(source){
  const rows=getRowsRaw(source)||[], headers=getHeaders(source)||[], v=state.versions||{}, cs=isCustomSource(source)?customSource(source):null;
  return stableSerialize({schema:RUN_INDEX_SCHEMA_VERSION,source,rowsVersion:state.sourceMeta?.[source]?.sourceVersion||state.sourceMeta?.[source]?.version||v.data||0,rowCount:rows.length,headerVersion:headers.join('\u001f'),headerCount:headers.length,settings:runSourceSettingsSignature(source),aliases:v.aliases||0,roster:v.roster||0,teams:v.teams||0,mappings:v.mappings||0,nameColumn:(typeof repColumnForSource==='function'?repColumnForSource(source):''),teamColumn:(typeof teamColumnForSource==='function'?teamColumnForSource(source):''),dateColumn:customDateColumn(source)||sourceDateHeader(source,headers)||'',normalization:RUN_INDEX_NORMALIZATION_VERSION,customUpdated:cs?.updatedAt||cs?.fileName||''});
}
function invalidateRunSourceIndex(source, reason='source changed'){
  if(!source) return;
  if(state.runIndexes instanceof Map) state.runIndexes.delete(source);
  runPrepState().ready.delete(source); runPrepState().dateRangeCache?.forEach?.((_,k)=>{ if(String(k).startsWith(source+'|')) runPrepState().dateRangeCache.delete(k); });
  state.runIndexDiagnostics=[...(state.runIndexDiagnostics||[]),{source,reason,invalidatedAt:Date.now()}].slice(-100);
}
function expressionReferencedSources(text){
  const out=new Set(), str=String(text||'');
  str.replace(/!\[([^\]]+)\]\.\[[^\]]+\]/g,(_,label)=>{ const key=allSourceKeys().find(src=>normalizeSourceLookupText(labelSource(src))===normalizeSourceLookupText(label)||normalizeSourceLookupText(src)===normalizeSourceLookupText(label)); if(key) out.add(key); return _; });
  str.replace(/!([a-z0-9_]+)\b/gi,(_,key)=>{ if(allSourceKeys().includes(key)) out.add(key); return _; });
  return [...out];
}
function metricDependencies(metric, seen=new Set()){
  const out=new Set(); if(!metric || seen.has(metric.id||metric.name)) return out; seen.add(metric.id||metric.name);
  const add=s=>{ if(s && allSourceKeys().includes(s)) out.add(s); };
  add(metric.source);
  const fields=[metric.field,metric.percentOfField,metric.withinCompareField,...(metric.rules||[]).flatMap(r=>[r.field,r.value,r.value2])];
  fields.forEach(f=>{ expressionReferencedSources(f).forEach(add); const ref=findMetricByRef(f); if(ref) metricDependencies(ref,seen).forEach(add); });
  return out;
}
function requiredRunSourcesForModel(model, runOptions={}){
  const required=new Set(), all=new Set(allSourceKeys());
  const add=s=>{ if(s && all.has(s)) required.add(s); };
  const inspectValue=v=>{ if(typeof v==='string'){ expressionReferencedSources(v).forEach(add); const m=findMetricByRef(v); if(m) metricDependencies(m).forEach(add); } };
  const inspectObj=obj=>{ if(!obj || typeof obj!=='object') return; if(Array.isArray(obj)){ obj.forEach(inspectObj); return; } Object.entries(obj).forEach(([k,v])=>{ if(/source$/i.test(k) || ['source','leftSource','rightSource','customSource','trueValueSource','qualifierSource','numeratorSource','denominatorSource'].includes(k)) add(v); inspectValue(v); if(v&&typeof v==='object') inspectObj(v); }); };
  (model?.criteria||[]).forEach(c=>{ if(c.calcType==='qaScore' || criterionUsesQA(c)) add(runOptions.qaTeamScoreMode==='sheetTeam'?activeDirectQASource():'qa'); if(isRowPullCriterion(c)) add(rowPullSourceForCriterion(c)); if(c.trueValueEnabled) add(c.trueValueSource); inspectObj(c); });
  inspectObj(model?.metrics||[]); inspectObj(model?.expressions||[]);
  return [...required].filter(Boolean);
}
function runCriterionNeedsSortedDate(c){ return !!(c && (c.requiresSortedDateRows || c.sortedDateRows || ['rollingDate','dateWindowSorted'].includes(c.aggregate))); }
function runIndexOptionsForSource(source, model){
  const criteria=(model?.criteria||[]).filter(c=>requiredRunSourcesForModel({criteria:[c]}).includes(source));
  return {sortedDateRows:criteria.some(runCriterionNeedsSortedDate), teamLookup:criteria.some(c=>c.calcType==='qaScore'||c.source==='qa'||isRowPullCriterion(c)||c.trueValueEnabled||c.populationScope==='team'||c.teamLevelLookup)};
}
function createRunSourceIndexShell(source,signature,rows,options={}){
  const headers=getHeaders(source)||[];
  return {kind:'run',schemaVersion:RUN_INDEX_SCHEMA_VERSION,source,signature,version:signature,rows,headers,byRep:new Map(),byTeam:new Map(),byTeamKey:new Map(),dateMetadata:new WeakMap(),rowMeta:new WeakMap(),dateValues:[],sortedDateRows:null,dateSortedRows:[],byRepSortedDate:new Map(),byTeamSortedDate:new Map(),byRowId:new Map(),lazyIndexes:new Map(),reps:new Map(),optionalStructures:{sortedDateRows:!!options.sortedDateRows,teamLookup:options.teamLookup!==false},perf:{rowsIndexed:0,lazyBuilds:[]}};
}
function addRunIndexedRow(idx,source,row,rowId,options={}){
  const key=row._repKey||repKeyFromAnyRow(row)||'', team=rowTeam(row), teamKey=coachNameKey(team), ms=rowDateMillisForSource(source,row);
  if(team && !row._team) row._team=team;
  if(key) pushMapArray(idx.byRep,key,row);
  if(team){ pushMapArray(idx.byTeam,team,row); if(options.teamLookup!==false) pushMapArray(idx.byTeamKey,teamKey,row); }
  idx.byRowId.set(rowId,row);
  const meta={rowId,source,repKey:key,teamKey,dateMs:ms}; idx.rowMeta.set(row,meta); idx.dateMetadata.set(row,{ms,ymd:researchDayBucket(ms)});
  if(Number.isFinite(ms)) idx.dateValues[rowId]=ms;
  if(options.sortedDateRows && Number.isFinite(ms)){ idx.dateSortedRows.push(row); if(key) pushMapArray(idx.byRepSortedDate,key,row); if(team) pushMapArray(idx.byTeamSortedDate,team,row); }
  if(key && row._rep) idx.reps.set(key,mergeRepDisplay(idx.reps.get(key),{kind:'rep',key,name:cleanName(row._rep),team}));
  idx.perf.rowsIndexed++;
}
async function buildRunSourceIndex(source,signature,options={}){
  const timings={source,totalRows:(getRowsRaw(source)||[]).length,signature,cache:'miss',persistedRestoration:'skipped',groupingMs:0,dateParsingMs:0,sortingMs:0,optionalStructures:[],totalMs:0}, totalStart=performance.now();
  const rows=getRowsRaw(source)||[], idx=createRunSourceIndexShell(source,signature,rows,options), chunk=1200;
  const groupStart=performance.now();
  for(let i=0;i<rows.length;i++){ addRunIndexedRow(idx,source,rows[i],i,options); if(i && i%chunk===0) await yieldToBrowser(); }
  timings.groupingMs=Math.round(performance.now()-groupStart); timings.dateParsingMs=timings.groupingMs;
  if(options.sortedDateRows){ const sortStart=performance.now(); idx.byRepSortedDate.forEach(list=>list.sort((a,b)=>(idx.rowMeta.get(a)?.dateMs||0)-(idx.rowMeta.get(b)?.dateMs||0))); idx.byTeamSortedDate.forEach(list=>list.sort((a,b)=>(idx.rowMeta.get(a)?.dateMs||0)-(idx.rowMeta.get(b)?.dateMs||0))); idx.dateSortedRows.sort((a,b)=>(idx.rowMeta.get(a)?.dateMs||0)-(idx.rowMeta.get(b)?.dateMs||0)); idx.sortedDateRows=idx.dateSortedRows; timings.sortingMs=Math.round(performance.now()-sortStart); timings.optionalStructures.push('sortedDateRows'); }
  timings.totalMs=Math.round(performance.now()-totalStart); console.groupCollapsed('[All Star Run Index] source preparation'); console.table([timings]); console.groupEnd(); state.runIndexDiagnostics=[...(state.runIndexDiagnostics||[]),timings].slice(-100); return idx;
}
async function ensureRunSourceIndex(source, signature=sourceVersionSignature(source), options={}){
  runPrepState(); const existing=state.runIndexes.get(source);
  if(existing?.signature===signature){
    state.perfCounters.runIndexCacheHits=(state.perfCounters.runIndexCacheHits||0)+1;
    const timings={source,totalRows:(existing.rows||[]).length,signature,cache:'hit',persistedRestoration:'skipped',groupingMs:0,dateParsingMs:0,sortingMs:0,optionalStructures:Object.keys(existing.optionalStructures||{}).filter(k=>existing.optionalStructures[k]),totalMs:0};
    console.groupCollapsed('[All Star Run Index] source preparation'); console.table([timings]); console.groupEnd();
    if(options.sortedDateRows && !existing.optionalStructures?.sortedDateRows){ await addRunOptionalSortedDateRows(existing); }
    return existing;
  }
  state.perfCounters.runIndexCacheMisses=(state.perfCounters.runIndexCacheMisses||0)+1;
  const key=`${source}|${signature}`; const active=state.runPreparationJobs.get(key); if(active) return active.promise;
  const promise=buildRunSourceIndex(source,signature,options).then(idx=>{ state.runIndexes.set(source,idx); runPrepState().ready.set(source,signature); return idx; }).finally(()=>state.runPreparationJobs.delete(key));
  state.runPreparationJobs.set(key,{source,signature,promise,startedAt:Date.now(),options}); return promise;
}
async function addRunOptionalSortedDateRows(idx){
  const t0=performance.now(); idx.dateSortedRows=[]; idx.byRepSortedDate=new Map(); idx.byTeamSortedDate=new Map(); const rows=idx.rows||[], chunk=1600;
  for(let i=0;i<rows.length;i++){ const r=rows[i], meta=idx.rowMeta.get(r)||{}, ms=meta.dateMs; if(Number.isFinite(ms)){ idx.dateSortedRows.push(r); if(meta.repKey) pushMapArray(idx.byRepSortedDate,meta.repKey,r); if(meta.teamKey) pushMapArray(idx.byTeamSortedDate,rowTeam(r),r); } if(i&&i%chunk===0) await yieldToBrowser(); }
  idx.byRepSortedDate.forEach(list=>list.sort((a,b)=>(idx.rowMeta.get(a)?.dateMs||0)-(idx.rowMeta.get(b)?.dateMs||0))); idx.byTeamSortedDate.forEach(list=>list.sort((a,b)=>(idx.rowMeta.get(a)?.dateMs||0)-(idx.rowMeta.get(b)?.dateMs||0))); idx.dateSortedRows.sort((a,b)=>(idx.rowMeta.get(a)?.dateMs||0)-(idx.rowMeta.get(b)?.dateMs||0)); idx.sortedDateRows=idx.dateSortedRows; idx.optionalStructures.sortedDateRows=true; console.info('[All Star Run Index] optional structure built',{source:idx.source,structure:'sortedDateRows',rows:rows.length,ms:Math.round(performance.now()-t0)});
}
async function prepareRunSource(source, model=null){ return ensureRunSourceIndex(source,sourceVersionSignature(source),runIndexOptionsForSource(source,model||findModel(els.runModelSelect?.value))); }
function updateRunReadiness(required=[], generation=runPrepState().generation, status='Preparing selected model…'){
  if(generation!==runPrepState().generation || !els.runReadinessTitle) return;
  const ready=required.filter(s=>state.runIndexes?.get(s)?.signature===sourceVersionSignature(s)).length, preparing=required.filter(s=>[...(state.runPreparationJobs||new Map()).values()].some(j=>j.source===s)).length, reused=ready>0;
  els.runReadinessTitle.textContent= ready===required.length ? 'Selected model ready' : status;
  els.runReadinessDetail.textContent=`Required source count: ${required.length} · Ready sources: ${ready} · Preparing sources: ${preparing}`;
  if(els.runReadinessMeta) els.runReadinessMeta.innerHTML=`<span class="badge">${ready} of ${required.length} sources ready</span><span class="badge">${reused?'Reusing prepared sources':'Preparing newly required sources'}</span><span class="badge">Global rebuild avoided</span>`;
}
async function beginSelectedModelPreparation(){
  const prep=runPrepState(), generation=++prep.generation, model=findModel(els.runModelSelect?.value), opts={qaTeamScoreMode:els.runQATeamScoreMode?.value||'assignedReps'};
  console.groupCollapsed('[All Star Run] Selected model dependencies'); console.time('[All Star Run] dependency calculation');
  const required=requiredRunSourcesForModel(model,opts); prep.lastRequired=required; prep.lastModelId=model?.id||'';
  console.timeEnd('[All Star Run] dependency calculation'); console.info('model',model?.name,'requiredSources',required,'globalRebuildAvoided',true); console.groupEnd();
  updateRunReadiness(required,generation,'Preparing selected model…');
  const limit=2; for(let i=0;i<required.length;i+=limit){ if(generation!==runPrepState().generation) return; required.slice(i,i+limit).forEach(source=>prepareRunSource(source,model).then(()=>updateRunReadiness(required,generation)).catch(err=>{ console.error('[All Star Run] Source preparation failed',source,err); updateRunReadiness(required,generation,'Preparation needs attention'); })); await yieldToBrowser(); }
}
async function ensureSelectedModelPreparedForRun(model, opts={}){
  const required=requiredRunSourcesForModel(model,opts), prep=runPrepState(), generation=prep.generation;
  updateRunReadiness(required,generation,'Finishing selected model preparation…');
  const limit=2; for(let i=0;i<required.length;i+=limit) await Promise.all(required.slice(i,i+limit).map(s=>prepareRunSource(s,model)));
  updateRunReadiness(required,generation,'Selected model ready'); return required;
}
function lightweightRunDateRange(source,col){
  const key=[source,sourceVersionSignature(source),col||''].join('|'), cache=runPrepState().dateRangeCache; if(cache.has(key)) return cache.get(key);
  let range=null; const rows=getRowsRaw(source)||[]; rows.forEach(r=>{ let v; if(source==='qa') v=col==='assigned'?r._assignedDate:r._interactionDate; else v=col?r[col]:(r._date||r.Date); range=addDateToRange(range,v); }); cache.set(key,range); return range;
}
function checklistDateColumnsForModel(model){
  const items=[]; const seen=new Set();
  (model?.criteria||[]).forEach(c=>{
    if(isRowPullCriterion(c)){
      const source=rowPullSourceForCriterion(c);
      const data=checklistLikeRowsState(source);
      const col=plainHeaderName(c.checkDateColumn) || findHeader(data.headers,checklistLikeDefaultDateHeaders(source));
      const key=source+'|'+col;
      if(col && !seen.has(key)){ seen.add(key); items.push({source,col}); }
    }
  });
  return items;
}
function rangeToDates(range){ return range&&range.min&&range.max ? [range.min,range.max] : []; }
function checklistDateRangeForColumn(source,col){
  if(!col) return null;
  const idx=state.dataIndex;
  if(dataIndexReady() && idx.dateRanges && idx.dateRanges[source] instanceof Map && idx.dateRanges[source].has(col)) return idx.dateRanges[source].get(col);
  const actual=resolveColumn(source,col)||col;
  const range=lightweightRunDateRange(source,actual);
  if(dataIndexReady() && idx.dateRanges && idx.dateRanges[source] instanceof Map) idx.dateRanges[source].set(col,range);
  return range;
}
function setDefaultRunDates(force=false){
  if(!force && els.runStartDate?.value && els.runEndDate?.value) return;
  console.time('[All Star Run] Default-date calculation');
  const qaMode=els.runQADateSelect ? els.runQADateSelect.value : 'interaction';
  const model=findModel(els.runModelSelect?.value);
  let dates=[];
  if(modelUsesQA(model)) dates=dates.concat(rangeToDates(lightweightRunDateRange('qa',qaMode)));
  checklistDateColumnsForModel(model).forEach(({source,col})=>{ dates=dates.concat(rangeToDates(checklistDateRangeForColumn(source,col))); });
  requiredRunSourcesForModel(model,{qaTeamScoreMode:els.runQATeamScoreMode?.value||'assignedReps'}).filter(isDatedRowPullSource).forEach(src=>{ const h=sourceDateHeader(src,getHeaders(src)); if(h) dates=dates.concat(rangeToDates(lightweightRunDateRange(src,h))); });
  dates=dates.filter(d=>d instanceof Date&&!isNaN(d));
  const end=dates.length?new Date(Math.max(...dates.map(d=>d.getTime()))):parseDateOnly(new Date());
  const start=new Date(end.getTime()-29*86400000);
  els.runStartDate.value=ymd(start); els.runEndDate.value=ymd(end);
  console.timeEnd('[All Star Run] Default-date calculation');
}
function pdfText(value,fallback=''){
  return String(value===undefined||value===null||value===''?fallback:value).replace(/\s+/g,' ').trim();
}
function pdfScore(row){ return fmt(Number(row?.overallScore)||0,'number'); }
function pdfDateRangeText(report){ const {start,end}=report||{}; return (start&&end)?`${ymd(start)} to ${ymd(end)}`:'All available dates'; }
function pdfFilePart(s){ return pdfText(s,'all-star').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,72)||'all-star'; }
function jsPDFCtor(){ return window.jspdf?.jsPDF || window.jsPDF || null; }
function pdfSelectedTeamNames(report){
  const runNames=(report?.runOpts?.selectedTeamNames||[]).map(canonicalCoachName).filter(Boolean);
  const fallback=(report?.teamPack?.rows||[]).map(r=>canonicalCoachName(r.entry?.name)).filter(Boolean);
  const source=runNames.length?runNames:fallback;
  return [...new Map(source.map(name=>[coachNameKey(name),name])).values()];
}
function buildWinnerReportData(report){
  const selectedTeamNames=pdfSelectedTeamNames(report);
  const selectedKeys=new Set(selectedTeamNames.map(coachNameKey));
  const rawTeamRows=report?.teamPack?.rows||[], rawRepRows=report?.repPack?.rows||[], rawTeamRepRows=report?.teamRepPack?.rows||rawRepRows;
  const teamRows=selectedKeys.size ? rawTeamRows.filter(r=>selectedKeys.has(coachNameKey(r.entry?.name))) : rawTeamRows.slice();
  const repRows=selectedKeys.size ? rawRepRows.filter(r=>selectedKeys.has(coachNameKey(r.entry?.team))) : rawRepRows.slice();
  const teamRepRows=selectedKeys.size ? rawTeamRepRows.filter(r=>selectedKeys.has(coachNameKey(r.entry?.team))) : rawTeamRepRows.slice();
  const winningTeam=firstWinningRow(teamRows,'team') || teamRows[0] || null;
  const overallWinner=firstWinningRow(repRows,'rep') || repRows[0] || null;
  const teamRowByKey=new Map(teamRows.map(r=>[coachNameKey(r.entry?.name),r]));
  const repsByTeam=new Map();
  teamRepRows.forEach(r=>{
    const team=canonicalCoachName(r.entry?.team)||pdfText(r.entry?.team,'No Team');
    const key=coachNameKey(team);
    if(!repsByTeam.has(key)) repsByTeam.set(key,[]);
    repsByTeam.get(key).push(r);
  });
  const orderedNames=[];
  teamRows.forEach(r=>orderedNames.push(canonicalCoachName(r.entry?.name)||pdfText(r.entry?.name,'No Team')));
  selectedTeamNames.forEach(name=>{ if(!orderedNames.some(x=>coachNameKey(x)===coachNameKey(name))) orderedNames.push(name); });
  const teamWinners=orderedNames.map(team=>{
    const key=coachNameKey(team), rows=repsByTeam.get(key)||[], teamRow=teamRowByKey.get(key)||null;
    // Team winners use the selected team-page scoring scope; the overall winner always uses the all-representative ranking.
    const repWinner=firstWinningRow(rows,'rep') || rows[0] || null;
    return {team,teamRow,repWinner,repCount:rows.length};
  });
  return {selectedTeamNames,teamRows,repRows,teamRepRows,winningTeam,overallWinner,teamWinners};
}
function pdfAddReportHeader(doc,title,subtitle){
  const w=doc.internal.pageSize.getWidth();
  doc.setFillColor(153,27,27); doc.rect(0,0,w,.42,'F');
  doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(15); doc.text(title,.38,.27);
  doc.setFontSize(8); doc.text(pdfText(subtitle),w-.38,.27,{align:'right',maxWidth:w*0.45});
  doc.setTextColor(17,24,39);
}
function pdfAddFooters(doc){
  const pages=doc.internal.getNumberOfPages(), w=doc.internal.pageSize.getWidth(), h=doc.internal.pageSize.getHeight();
  for(let i=1;i<=pages;i++){
    doc.setPage(i); doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(107,114,128);
    doc.text('Top performers from the current scored report.',.38,h-.16);
    doc.text(`Page ${i} of ${pages}`,w-.38,h-.16,{align:'right'});
  }
}
function pdfEllipsis(doc,value,maxWidth){
  const text=pdfText(value,'-');
  if(doc.getTextWidth(text)<=maxWidth) return text;
  let low=0,high=text.length,best='...';
  while(low<=high){
    const mid=Math.floor((low+high)/2),candidate=text.slice(0,mid).trimEnd()+'...';
    if(doc.getTextWidth(candidate)<=maxWidth){ best=candidate; low=mid+1; }
    else high=mid-1;
  }
  return best;
}
function pdfWinnerLayout(teamCount,pageW,pageH){
  const page1GridY=2.08, page2GridY=.94, bottom=.34, gap=.07;
  const page1Available=pageH-bottom-page1GridY, page2Available=pageH-bottom-page2GridY;
  const onePageCandidates=teamCount<=3?[1,2]:teamCount<=18?[2,3]:[3,4];
  let pageCount=2, columns=onePageCandidates[onePageCandidates.length-1];
  for(const c of onePageCandidates){
    const rows=Math.max(1,Math.ceil(teamCount/c));
    const need=rows*.43+Math.max(0,rows-1)*gap;
    if(need<=page1Available){ pageCount=1; columns=c; break; }
  }
  const firstCount=pageCount===1?teamCount:Math.ceil(teamCount/2), secondCount=teamCount-firstCount;
  if(pageCount===2){
    const twoPageCandidates=firstCount<=24?[2,3]:[3,4];
    columns=twoPageCandidates[twoPageCandidates.length-1];
    for(const c of twoPageCandidates){
      const rows1=Math.max(1,Math.ceil(firstCount/c)), rows2=Math.max(1,Math.ceil(secondCount/c));
      const need1=rows1*.36+Math.max(0,rows1-1)*gap;
      const need2=rows2*.36+Math.max(0,rows2-1)*gap;
      if(need1<=page1Available && need2<=page2Available){ columns=c; break; }
    }
  }
  const rows1=Math.max(1,Math.ceil(firstCount/columns)), rows2=Math.max(1,Math.ceil(secondCount/columns));
  const fit1=(page1Available-Math.max(0,rows1-1)*gap)/rows1;
  const fit2=secondCount?(page2Available-Math.max(0,rows2-1)*gap)/rows2:99;
  const cardHeight=Math.max(.30,Math.min(.57,Math.min(fit1,fit2)));
  return {pageCount,columns,firstCount,secondCount,page1GridY,page2GridY,bottom,cardHeight,gap,marginX:.38,pageW,pageH};
}
function pdfDrawSummaryBox(doc,{label,name,meta,x,y,w,h,fill,border}){
  doc.setFillColor(...fill); doc.setDrawColor(...border); doc.setLineWidth(.018); doc.roundedRect(x,y,w,h,.07,.07,'FD');
  doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(border[0],border[1],border[2]);
  doc.text(label.toUpperCase(),x+.11,y+.18);
  doc.setFontSize(16); doc.setTextColor(17,24,39);
  doc.text(pdfEllipsis(doc,name,w-.22),x+.11,y+.46);
  doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(75,85,99);
  doc.text(pdfEllipsis(doc,meta,w-.22),x+.11,y+h-.11);
}
function pdfDrawSectionBar(doc,title,x,y,w){
  doc.setFillColor(17,24,39); doc.roundedRect(x,y,w,.27,.035,.035,'F');
  doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.text(title,x+.09,y+.18);
  doc.setTextColor(17,24,39);
}
function pdfDrawTeamWinnerCard(doc,item,data,x,y,w,h){
  const winningTeamKey=coachNameKey(data.winningTeam?.entry?.name||''), overallKey=nameKey(data.overallWinner?.entry?.name||'');
  const isWinningTeam=winningTeamKey && coachNameKey(item.team)===winningTeamKey;
  const isOverall=item.repWinner && overallKey && nameKey(item.repWinner.entry?.name)===overallKey;
  const fill=isWinningTeam?[220,252,231]:isOverall?[254,249,195]:[249,250,251];
  const border=isWinningTeam?[22,101,52]:isOverall?[161,98,7]:[156,163,175];
  doc.setFillColor(...fill); doc.setDrawColor(...border); doc.setLineWidth(isWinningTeam||isOverall?.02:.01); doc.roundedRect(x,y,w,h,.045,.045,'FD');
  const compact=h<.40, teamFont=compact?6.8:8.2, repFont=compact?6.1:7.2, tagFont=compact?5.2:6;
  const rank=Number.isFinite(item.teamRow?.overallRank)?`Team #${item.teamRow.overallRank}`:'Team';
  const tag=isWinningTeam?'WINNING TEAM':isOverall?'OVERALL #1 REP':rank;
  doc.setFont('helvetica','bold'); doc.setFontSize(tagFont); doc.setTextColor(border[0],border[1],border[2]);
  doc.text(tag,x+w-.07,y+.11,{align:'right'});
  doc.setFont('helvetica','bold'); doc.setFontSize(teamFont); doc.setTextColor(17,24,39);
  doc.text(pdfEllipsis(doc,item.team,w-.18),x+.08,y+(compact?.13:.16));
  const repName=item.repWinner?pdfText(item.repWinner.entry?.name):'No eligible representative';
  const repScore=item.repWinner?`Rep ${pdfScore(item.repWinner)}`:'No score';
  const teamScore=item.teamRow?`Team ${pdfScore(item.teamRow)}`:'';
  doc.setFont('helvetica',item.repWinner?'bold':'normal'); doc.setFontSize(repFont); doc.setTextColor(55,65,81);
  const scoreWidth=Math.max(.74,doc.getTextWidth(`${repScore}  ${teamScore}`)+.08);
  doc.text(pdfEllipsis(doc,repName,w-scoreWidth-.20),x+.08,y+h-.09);
  doc.setFont('helvetica','normal'); doc.setFontSize(tagFont); doc.setTextColor(75,85,99);
  doc.text(`${repScore}${teamScore?' | '+teamScore:''}`,x+w-.07,y+h-.09,{align:'right'});
}
function pdfDrawTeamWinnerGrid(doc,items,data,startY,layout){
  const usableW=layout.pageW-(layout.marginX*2), gap=layout.gap;
  const cardW=(usableW-gap*(layout.columns-1))/layout.columns;
  items.forEach((item,index)=>{
    const col=index%layout.columns, row=Math.floor(index/layout.columns);
    const x=layout.marginX+col*(cardW+gap), y=startY+row*(layout.cardHeight+gap);
    pdfDrawTeamWinnerCard(doc,item,data,x,y,cardW,layout.cardHeight);
  });
}
function drawTopPerformerPageOne(doc,report,data,layout){
  const modelName=pdfText(report?.model?.name,'All Star Report'), pageW=layout.pageW;
  pdfAddReportHeader(doc,'All Star Top Performers',modelName);
  doc.setFont('helvetica','bold'); doc.setFontSize(15); doc.setTextColor(17,24,39); doc.text('Current Report Winners',.38,.68);
  doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(75,85,99);
  doc.text(`${pdfDateRangeText(report)} | ${data.teamWinners.length} selected team${data.teamWinners.length===1?'':'s'} | Generated ${new Date().toLocaleString()}`,.38,.84,{maxWidth:pageW-.76});
  const gap=.14, boxY=.96, boxH=.72, boxW=(pageW-.76-gap)/2;
  const overall=data.overallWinner, winTeam=data.winningTeam;
  pdfDrawSummaryBox(doc,{label:'Highest Overall Representative',name:overall?pdfText(overall.entry?.name):'No eligible representative',meta:overall?`${pdfText(overall.entry?.team,'No Team')} | Score ${pdfScore(overall)}`:'No eligible representative score',x:.38,y:boxY,w:boxW,h:boxH,fill:[255,251,235],border:[161,98,7]});
  const winningTeamRep=data.teamWinners.find(x=>coachNameKey(x.team)===coachNameKey(winTeam?.entry?.name||''))?.repWinner;
  pdfDrawSummaryBox(doc,{label:'Winning Team',name:winTeam?pdfText(winTeam.entry?.name):'No eligible team',meta:winTeam?`Team score ${pdfScore(winTeam)}${winningTeamRep?' | Top rep '+pdfText(winningTeamRep.entry?.name):''}`:'No eligible team score',x:.38+boxW+gap,y:boxY,w:boxW,h:boxH,fill:[240,253,244],border:[22,101,52]});
  pdfDrawSectionBar(doc,`Highest-ranked representative for each selected team (${data.teamWinners.length})`,.38,1.76,pageW-.76);
  pdfDrawTeamWinnerGrid(doc,data.teamWinners.slice(0,layout.firstCount),data,layout.page1GridY,layout);
}
function drawTopPerformerPageTwo(doc,report,data,layout){
  const modelName=pdfText(report?.model?.name,'All Star Report'), start=layout.firstCount, end=data.teamWinners.length;
  pdfAddReportHeader(doc,'All Star Top Performers - Continued',modelName);
  doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(75,85,99);
  const winTeam=pdfText(data.winningTeam?.entry?.name,'No eligible team'), overall=pdfText(data.overallWinner?.entry?.name,'No eligible representative');
  doc.text(pdfEllipsis(doc,`Winning team: ${winTeam} | Overall #1: ${overall} | Teams ${start+1}-${end} of ${end}`,layout.pageW-.76),.38,.65);
  pdfDrawSectionBar(doc,'Remaining selected-team winners',.38,.71,layout.pageW-.76);
  pdfDrawTeamWinnerGrid(doc,data.teamWinners.slice(start),data,layout.page2GridY,layout);
}

const PDF_OPTIONS_KEY='allStarPdfOptions.v1';
function defaultPdfOptions(){ return {title:'',subtitle:'',colorScheme:'allStarRed',customColors:{primary:'#991b1b',secondary:'#a16207',headerText:'#ffffff',lightFill:'#fef2f2'},winners:{winningCoach:true,winningRepPerTeam:true,winningRepOverall:true},breakdowns:{top50ForSelectedWinners:false,eachTeam:false,coaches:false,allReps:false},pageSize:'letter',orientation:'landscape'}; }
function mergePdfOptions(raw){ const d=defaultPdfOptions(), o=(raw&&typeof raw==='object')?raw:{}; return {...d,...o,customColors:{...d.customColors,...(o.customColors||{})},winners:{...d.winners,...(o.winners||{})},breakdowns:{...d.breakdowns,...(o.breakdowns||{})},pageSize:['letter','a4'].includes(o.pageSize)?o.pageSize:d.pageSize,orientation:['landscape','portrait'].includes(o.orientation)?o.orientation:d.orientation,colorScheme:['allStarRed','professionalBlue','executiveDark','greenPerformance','neutralGrayscale','custom'].includes(o.colorScheme)?o.colorScheme:d.colorScheme}; }
function loadPdfOptions(){ try{ state.pdfOptions=mergePdfOptions(JSON.parse(localStorage.getItem(PDF_OPTIONS_KEY)||'null')); }catch(_){ state.pdfOptions=defaultPdfOptions(); } return state.pdfOptions; }
function savePdfOptions(options){ state.pdfOptions=mergePdfOptions(options); localStorage.setItem(PDF_OPTIONS_KEY,JSON.stringify(state.pdfOptions)); return state.pdfOptions; }
function pdfHasAnyContent(o){ return !!(o?.winners?.winningCoach||o?.winners?.winningRepPerTeam||o?.winners?.winningRepOverall||o?.breakdowns?.top50ForSelectedWinners||o?.breakdowns?.eachTeam||o?.breakdowns?.coaches||o?.breakdowns?.allReps); }
function safeHexColor(v,f){ return /^#[0-9a-f]{6}$/i.test(String(v||''))?String(v):f; }
function hexToRgb(hex){ const h=safeHexColor(hex,'#000000').slice(1); return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]; }
function getPdfTheme(options){ const schemes={allStarRed:{primary:'#991b1b',secondary:'#a16207',headerText:'#ffffff',lightFill:'#fef2f2'},professionalBlue:{primary:'#1d4ed8',secondary:'#0369a1',headerText:'#ffffff',lightFill:'#eff6ff'},executiveDark:{primary:'#111827',secondary:'#475569',headerText:'#ffffff',lightFill:'#f8fafc'},greenPerformance:{primary:'#166534',secondary:'#15803d',headerText:'#ffffff',lightFill:'#f0fdf4'},neutralGrayscale:{primary:'#374151',secondary:'#6b7280',headerText:'#ffffff',lightFill:'#f9fafb'}}; const base=options?.colorScheme==='custom'?options.customColors:(schemes[options?.colorScheme]||schemes.allStarRed); return {primary:hexToRgb(safeHexColor(base.primary,'#991b1b')),secondary:hexToRgb(safeHexColor(base.secondary,'#a16207')),headerText:hexToRgb(safeHexColor(base.headerText,'#ffffff')),lightFill:hexToRgb(safeHexColor(base.lightFill,'#fef2f2')),ink:[17,24,39],muted:[75,85,99],line:[209,213,219],gold:[251,191,36],silver:[156,163,175],bronze:[180,83,9]}; }
function populatePdfOptionsModal(){ const o=mergePdfOptions(state.pdfOptions||loadPdfOptions()); const title=o.title||pdfText(state.lastRenderedReport?.model?.name,'All Star Report'); els.pdfTitleInput.value=title; els.pdfSubtitleInput.value=o.subtitle||''; els.pdfColorScheme.value=o.colorScheme; els.pdfOrientation.value=o.orientation; els.pdfPageSize.value=o.pageSize; els.pdfCustomPrimary.value=safeHexColor(o.customColors.primary,'#991b1b'); els.pdfCustomSecondary.value=safeHexColor(o.customColors.secondary,'#a16207'); els.pdfCustomHeaderText.value=safeHexColor(o.customColors.headerText,'#ffffff'); els.pdfCustomLightFill.value=safeHexColor(o.customColors.lightFill,'#fef2f2'); els.pdfWinCoach.checked=!!o.winners.winningCoach; els.pdfWinRepTeam.checked=!!o.winners.winningRepPerTeam; els.pdfWinRepOverall.checked=!!o.winners.winningRepOverall; els.pdfTop50.checked=!!o.breakdowns.top50ForSelectedWinners; els.pdfEachTeam.checked=!!o.breakdowns.eachTeam; els.pdfCoaches.checked=!!o.breakdowns.coaches; els.pdfAllReps.checked=!!o.breakdowns.allReps; els.pdfCustomColors.classList.toggle('hidden',els.pdfColorScheme.value!=='custom'); updatePdfOptionsSummary(); }
function readPdfOptionsFromModal(){ return mergePdfOptions({title:els.pdfTitleInput.value.trim(),subtitle:els.pdfSubtitleInput.value.trim(),colorScheme:els.pdfColorScheme.value,customColors:{primary:els.pdfCustomPrimary.value,secondary:els.pdfCustomSecondary.value,headerText:els.pdfCustomHeaderText.value,lightFill:els.pdfCustomLightFill.value},winners:{winningCoach:els.pdfWinCoach.checked,winningRepPerTeam:els.pdfWinRepTeam.checked,winningRepOverall:els.pdfWinRepOverall.checked},breakdowns:{top50ForSelectedWinners:els.pdfTop50.checked,eachTeam:els.pdfEachTeam.checked,coaches:els.pdfCoaches.checked,allReps:els.pdfAllReps.checked},pageSize:els.pdfPageSize.value,orientation:els.pdfOrientation.value}); }
function updatePdfOptionsSummary(){ if(!els.pdfOptionsSummary) return; const o=readPdfOptionsFromModal(), r=state.lastRenderedReport, data=r?buildWinnerReportData(r):null; const teams=data?.teamWinners?.length||0, reps=data?.repRows?.length||0, coaches=data?.teamRows?.length||0, bullets=[]; if(o.winners.winningCoach) bullets.push('Winning coach'); if(o.winners.winningRepOverall) bullets.push('Overall winning representative'); if(o.winners.winningRepPerTeam) bullets.push(`Winning representative from ${teams} team${teams===1?'':'s'}`); if(o.breakdowns.top50ForSelectedWinners) bullets.push('Top 50 supporting rankings for selected winner sections'); if(o.breakdowns.coaches) bullets.push(`Complete coach/team rankings (${coaches} rows)`); if(o.breakdowns.allReps) bullets.push(`Complete representative rankings (${reps} rows)`); if(o.breakdowns.eachTeam) bullets.push(`Team-by-team breakdowns (${teams} teams)`); bullets.push(`${(o.orientation||'landscape')[0].toUpperCase()+String(o.orientation||'landscape').slice(1)} ${String(o.pageSize||'letter').toUpperCase()} format`); const criteria=(r?.model?.criteria||[]).length, roughRows=(o.breakdowns.coaches?coaches:0)+(o.breakdowns.allReps?reps:0)+(o.breakdowns.eachTeam?reps:0)+(o.breakdowns.top50ForSelectedWinners?Math.min(50,coaches)+Math.min(50,reps)+Math.min(50*teams,reps):0), pages=Math.max(1,Math.ceil((2+teams*.18+roughRows*.055+criteria*.35))); bullets.push(`Estimated compact length: about ${pages}–${Math.max(pages+1,Math.ceil(pages*1.2))} pages`); els.pdfOptionsSummary.innerHTML='<strong>Selected PDF Content</strong><br>• '+(bullets.length?bullets.join('<br>• '):'No PDF content selected'); }
function openPdfOptionsModal(){ if(!state.pdfOptions) loadPdfOptions(); populatePdfOptionsModal(); openModal('pdfOptionsModal'); }
function validatePdfOptions(options,report){ if(!pdfHasAnyContent(options)) return 'Select at least one winner or breakdown option.'; if(!report) return 'Run a report before exporting the PDF.'; if(!Array.isArray(report?.teamPack?.rows)||!Array.isArray(report?.repPack?.rows)) return 'The current report does not contain valid team and representative ranking data.'; if(!report.teamPack.rows.length) return 'The current report does not contain valid team rows.'; if(!report.repPack.rows.length) return 'The current report does not contain valid representative rows.'; return ''; }
function pdfRank(row){ return Number.isFinite(row?.overallRank)?String(row.overallRank):'-'; }
function pdfEligible(row){ return row?.eligible?'Eligible':'Ineligible'; }
function pdfHasMeaningfulValue(v){ if(v===0||v==='0') return true; const t=String(v??'').trim(); return !!t&&!['-','—','n/a','na','none','no score','null','undefined'].includes(t.toLowerCase()); }
function pdfCritColumns(report,kind){ return (report?.model?.criteria||[]).filter(c=>criterionAppliesToKind(c,kind)).flatMap(c=>c.calcType==='displayColumn'?[{key:'d_'+c.id,label:c.name,get:r=>pdfText(valueDisplay(r,c),'—')}]:[{key:'v_'+c.id,label:c.name+' Value',get:r=>pdfText(valueDisplay(r,c),'No score')},{key:'s_'+c.id,label:c.name+' Score',get:r=>pdfText(scoreDisplay(r,c),'No score')}]); }
function buildPdfExportData(report,options){ const data=buildWinnerReportData(report); const repsByTeam=new Map(); data.teamRepRows.forEach(r=>{ const k=coachNameKey(r.entry?.team); if(!repsByTeam.has(k)) repsByTeam.set(k,[]); repsByTeam.get(k).push(r); }); data.repsByTeam=repsByTeam; return data; }
function buildPdfContentPlan(report,options){ const data=buildPdfExportData(report,options), plan=[]; if(options.winners.winningCoach&&data.winningTeam) plan.push({type:'winner-coach',title:'Winning Coach',row:data.winningTeam}); if(options.winners.winningRepOverall&&data.overallWinner) plan.push({type:'winner-overall-rep',title:'Winning Representative Overall',row:data.overallWinner}); if(options.winners.winningRepPerTeam&&data.teamWinners.length) plan.push({type:'winner-team-reps',title:'Winning Representative by Team',items:data.teamWinners}); if(options.breakdowns.top50ForSelectedWinners){ if(options.winners.winningCoach&&!options.breakdowns.coaches) plan.push({type:'coach-top50',title:'Top 50 Coaches / Teams',rows:data.teamRows.filter(r=>r.eligible&&!rowZeroBottom(r,'team')).slice(0,50)}); if(options.winners.winningRepOverall&&!options.breakdowns.allReps) plan.push({type:'rep-top50',title:'Top 50 Representatives Overall',rows:data.repRows.filter(r=>r.eligible&&!rowZeroBottom(r,'rep')).slice(0,50)}); if(options.winners.winningRepPerTeam&&!options.breakdowns.eachTeam) data.teamWinners.forEach(t=>plan.push({type:'team-top50',title:`${t.team} — Top Representatives`,team:t,rows:(data.repsByTeam.get(coachNameKey(t.team))||[]).filter(r=>r.eligible&&!rowZeroBottom(r,'rep')).slice(0,50)})); }
 if(options.breakdowns.coaches) plan.push({type:'coach-ranking',title:'Complete Coach Rankings',rows:data.teamRows}); if(options.breakdowns.allReps) plan.push({type:'rep-ranking',title:'All Representatives',rows:data.repRows}); if(options.breakdowns.eachTeam) data.teamWinners.forEach(t=>plan.push({type:'team-breakdown',title:t.team,team:t,rows:data.repsByTeam.get(coachNameKey(t.team))||[]})); return plan; }
function createPdfDocument(options){ const JsPDF=jsPDFCtor(); return new JsPDF({unit:'in',format:options.pageSize||'letter',orientation:options.orientation||'landscape',compress:true}); }
function createPdfLayout(doc){ const pageWidth=doc.internal.pageSize.getWidth(), pageHeight=doc.internal.pageSize.getHeight(); return {pageWidth,pageHeight,marginLeft:.38,marginRight:.38,marginTop:.42,marginBottom:.42,headerHeight:.62,footerHeight:.30,contentTop:1.12,contentBottom:pageHeight-.48}; }
function pdfCreateRenderContext(doc,report,options,theme){ const layout=createPdfLayout(doc); return {doc,report,options,theme,layout,cursorY:layout.contentTop,currentTitle:'',exportedAt:new Date(),warnings:[]}; }
function pdfDrawPageHeader(ctx,title,continued=false){ const {doc,theme,layout,report,options}=ctx,w=layout.pageWidth; doc.setFillColor(...theme.primary); doc.rect(0,0,w,.44,'F'); doc.setTextColor(...theme.headerText); doc.setFont('helvetica','bold'); doc.setFontSize(14); doc.text(pdfText(options.title||report?.model?.name,'All Star Report'),layout.marginLeft,.27,{maxWidth:w*.55}); doc.setFontSize(8); doc.text(pdfText(report?.model?.name,'All Star Model'),w-layout.marginRight,.18,{align:'right',maxWidth:w*.35}); doc.text(`Generated ${ctx.exportedAt.toLocaleString()}`,w-layout.marginRight,.32,{align:'right'}); doc.setTextColor(...theme.ink); doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.text(`${title}${continued?' — Continued':''}`,layout.marginLeft,.72,{maxWidth:w-layout.marginLeft-layout.marginRight}); doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(...theme.muted); const meta=[options.subtitle,pdfDateRangeText(report),`${(report?.teamPack?.rows||[]).length} teams`,`${(report?.repPack?.rows||[]).length} representatives`].filter(Boolean).join(' | '); doc.text(meta,layout.marginLeft,.90,{maxWidth:w-layout.marginLeft-layout.marginRight}); ctx.cursorY=layout.contentTop; ctx.currentTitle=title; }
function pdfStartPage(ctx,title,continued=false){ if(ctx.doc.internal.getNumberOfPages()===1 && !ctx.currentTitle) pdfDrawPageHeader(ctx,title,continued); else { ctx.doc.addPage(); pdfDrawPageHeader(ctx,title,continued); } }
function pdfEnsureSpace(ctx,requiredHeight,continuationHeader){ if(ctx.cursorY+requiredHeight<=ctx.layout.contentBottom) return false; pdfStartPage(ctx,continuationHeader||ctx.currentTitle,true); return true; }
function pdfMeasureWrappedText(doc,text,width,fontSize){ doc.setFontSize(fontSize); return Math.max(1,doc.splitTextToSize(pdfText(text,'-'),Math.max(.15,width)).length); }
function pdfDrawCompactSectionHeader(ctx,title){ pdfEnsureSpace(ctx,.42,title); const {doc,theme,layout}=ctx; doc.setFillColor(...theme.primary); doc.rect(layout.marginLeft,ctx.cursorY,layout.pageWidth-layout.marginLeft-layout.marginRight,.25,'F'); doc.setTextColor(...theme.headerText); doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.text(String(title).toUpperCase(),layout.marginLeft+.07,ctx.cursorY+.17,{maxWidth:layout.pageWidth-layout.marginLeft-layout.marginRight-.14}); ctx.cursorY+=.34; }
function pdfDrawSectionHeading(ctx,title){ pdfDrawCompactSectionHeader(ctx,title); }
function pdfDrawCompactWinner(ctx,{label,name,detail}){ if(!ctx.currentTitle) pdfStartPage(ctx,'Winner Summary'); pdfDrawCompactSectionHeader(ctx,label); const {doc,theme,layout}=ctx, x=layout.marginLeft, w=layout.pageWidth-layout.marginLeft-layout.marginRight; pdfEnsureSpace(ctx,.44,label); doc.setDrawColor(...theme.secondary); doc.setLineWidth(.02); doc.line(x,ctx.cursorY,x,ctx.cursorY+.34); doc.setTextColor(...theme.ink); doc.setFont('helvetica','bold'); doc.setFontSize(12); doc.text(pdfText(name,'No eligible winner'),x+.10,ctx.cursorY+.13,{maxWidth:w-.20}); doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(...theme.muted); doc.text(pdfText(detail,''),x+.10,ctx.cursorY+.30,{maxWidth:w-.20}); ctx.cursorY+=.48; }
function pdfTeamWinnerLineText(item){ return `${pdfText(item?.team,'No Team')}: ${pdfText(item?.repWinner?.entry?.name,'No eligible representative')}`; }
function pdfDrawWinnerLine(ctx,item,index,title){ const {doc,theme,layout}=ctx, x=layout.marginLeft, w=layout.pageWidth-layout.marginLeft-layout.marginRight, detail=`Score ${item.repWinner?pdfScore(item.repWinner):'-'} | Rank ${item.repWinner?pdfRank(item.repWinner):'-'}`; pdfEnsureSpace(ctx,.26,title); const y=ctx.cursorY; if(index%2){ doc.setFillColor(249,250,251); doc.rect(x,y,w,.24,'F'); } doc.setDrawColor(...theme.line); doc.line(x,y+.24,x+w,y+.24); doc.setFontSize(10); doc.setTextColor(...theme.ink); doc.setFont('helvetica','bold'); doc.text(`${pdfText(item.team,'No Team')}:`,x+.04,y+.16,{maxWidth:w*.35}); const teamW=doc.getTextWidth(`${pdfText(item.team,'No Team')}: `); doc.setFont('helvetica','normal'); doc.text(pdfText(item.repWinner?.entry?.name,'No eligible representative'),Math.min(x+.04+teamW,x+w*.42),y+.16,{maxWidth:w*.48}); doc.setFontSize(8); doc.setTextColor(...theme.muted); doc.text(detail,x+w-.05,y+.16,{align:'right',maxWidth:w*.22}); ctx.cursorY+=.24; }
function pdfDrawTeamWinnerList(ctx,title,items){ if(!ctx.currentTitle) pdfStartPage(ctx,'Winner Summary'); pdfDrawCompactSectionHeader(ctx,title); items.forEach((item,i)=>{ const newPage=pdfEnsureSpace(ctx,.28,title); if(newPage) pdfDrawCompactSectionHeader(ctx,title); pdfDrawWinnerLine(ctx,item,i,title); }); ctx.cursorY+=.12; }
function pdfCoreColumns(kind){ return kind==='team'?[{label:'Rank',w:.55,get:r=>pdfRank(r),align:'center'},{label:'Coach / Team',w:2.9,get:r=>r.entry?.name},{label:'Overall Score',w:.9,get:r=>pdfScore(r),align:'right'},{label:'Status',w:1.05,get:pdfEligible,align:'center'}]:[{label:'Rank',w:.55,get:r=>pdfRank(r),align:'center'},{label:'Representative',w:2.35,get:r=>r.entry?.name},{label:'Coach / Team',w:2.0,get:r=>r.entry?.team},{label:'Overall Score',w:.9,get:r=>pdfScore(r),align:'right'},{label:'Status',w:1.05,get:pdfEligible,align:'center'}]; }
function pdfFilteredCriteria(report,kind,rows){ return pdfCritColumns(report,kind).filter(c=>rows.some(r=>pdfHasMeaningfulValue(c.get(r)))); }
function pdfCriterionGroups(report,kind,rows){ const crit=pdfFilteredCriteria(report,kind,rows), size=kind==='team'?6:5, groups=[]; for(let i=0;i<crit.length;i+=size) groups.push(crit.slice(i,i+size)); return groups; }
function pdfCriteriaColumns(kind,group){ const id=kind==='team'?[{label:'Rank',w:.5,get:r=>pdfRank(r),align:'center'},{label:'Coach / Team',w:2.1,get:r=>r.entry?.name}]:[{label:'Rank',w:.5,get:r=>pdfRank(r),align:'center'},{label:'Representative',w:1.75,get:r=>r.entry?.name},{label:'Coach / Team',w:1.45,get:r=>r.entry?.team}]; return [...id,...group.map(c=>({label:c.label,w:.85,get:c.get,align:'right'}))]; }
function pdfNarrativeDetails(kind,rows){ const details=[]; rows.forEach(r=>{ const fields=[['Autofail reasons',(r.autofails||[]).join(', ')],['Minimum-failure reasons',(r.minimumFails||[]).join(', ')],['Coaching notes',r.entry?.coachingNotes||r.entry?.coaching||r.entry?.coachNotes],['Corrective notes',r.entry?.correctiveNotes||r.entry?.corrective],['Comp call notes',r.entry?.compCallNotes||r.entry?.compCalls]]; const keep=fields.filter(([,v])=>pdfHasMeaningfulValue(v)); if(keep.length) details.push({row:r,fields:keep}); }); return details; }
function fitColumns(cols,totalW){ const fixed=cols.reduce((a,c)=>a+c.w,0), scale=fixed>totalW?totalW/fixed:1; return cols.map(c=>({...c,w:Math.max(.38,c.w*scale)})); }
async function pdfDrawPaginatedTable(ctx,{title,rows,columns,kind}){ if(!ctx.currentTitle) pdfStartPage(ctx,title); pdfDrawSectionHeading(ctx,title); const {doc,theme,layout}=ctx, tableW=layout.pageWidth-layout.marginLeft-layout.marginRight; columns=fitColumns(columns,tableW); const drawHead=()=>{ pdfEnsureSpace(ctx,.34,title); let x=layout.marginLeft; doc.setFillColor(...theme.secondary); doc.rect(x,ctx.cursorY,tableW,.28,'F'); columns.forEach(c=>{ doc.setTextColor(...theme.headerText); doc.setFont('helvetica','bold'); doc.setFontSize(7.8); doc.text(doc.splitTextToSize(c.label,c.w-.06),x+.03,ctx.cursorY+.11,{maxWidth:c.w-.06}); x+=c.w; }); ctx.cursorY+=.30; };
 drawHead(); if(!rows.length){ doc.setFontSize(8); doc.setTextColor(...theme.muted); doc.text('No rows available for this section.',layout.marginLeft,ctx.cursorY+.16); ctx.cursorY+=.30; return; }
 for(let i=0;i<rows.length;i++){ const r=rows[i]; let rowH=.24; columns.forEach(c=>{ rowH=Math.max(rowH,.11*pdfMeasureWrappedText(doc,c.get(r),c.w-.06,8)+.10); }); const turned=pdfEnsureSpace(ctx,rowH+.02,title); if(turned) drawHead(); let x=layout.marginLeft; const rank=Number(r.overallRank), fill=rank===1?theme.lightFill:(i%2?[249,250,251]:[255,255,255]); doc.setFillColor(...fill); doc.rect(x,ctx.cursorY,tableW,rowH,'F'); doc.setDrawColor(...theme.line); columns.forEach(c=>{ doc.rect(x,ctx.cursorY,c.w,rowH); doc.setTextColor(...theme.ink); doc.setFont('helvetica',rank===1?'bold':'normal'); doc.setFontSize(8); const lines=doc.splitTextToSize(pdfText(c.get(r),'-'),c.w-.06); doc.text(lines,c.align==='right'?x+c.w-.04:(c.align==='center'?x+c.w/2:x+.04),ctx.cursorY+.11,{align:c.align||'left',maxWidth:c.w-.07}); x+=c.w; }); ctx.cursorY+=rowH; if(i%50===49){ updateProgress(`Paginating ${title} rows ${i+1} of ${rows.length}...`,55); await yieldToBrowser(); } }
 ctx.cursorY+=.12; }
async function pdfDrawRankingSection(ctx,title,rows,kind){ await pdfDrawPaginatedTable(ctx,{title,rows,columns:pdfCoreColumns(kind),kind}); const groups=pdfCriterionGroups(ctx.report,kind,rows); for(let i=0;i<groups.length;i++) await pdfDrawPaginatedTable(ctx,{title:`${title} — Criteria ${i+1} of ${groups.length}`,rows,columns:pdfCriteriaColumns(kind,groups[i]),kind}); const notes=pdfNarrativeDetails(kind,rows); if(notes.length) pdfDrawNotesDetails(ctx,`${title} — Notes and Details`,notes,kind); }
function pdfDrawNotesDetails(ctx,title,details,kind){ if(!ctx.currentTitle) pdfStartPage(ctx,title); pdfDrawSectionHeading(ctx,title); const {doc,theme,layout}=ctx, w=layout.pageWidth-layout.marginLeft-layout.marginRight; details.forEach((d,i)=>{ let h=.28+d.fields.reduce((a,[,v])=>a+.14*pdfMeasureWrappedText(doc,v,w-.22,8),0); const turned=pdfEnsureSpace(ctx,Math.min(h,1.4),title); if(turned) pdfDrawSectionHeading(ctx,title); doc.setTextColor(...theme.ink); doc.setFont('helvetica','bold'); doc.setFontSize(9); const name=kind==='rep'?pdfText(d.row.entry?.name,'Unnamed'):pdfText(d.row.entry?.name,'Unnamed Team'); doc.text(name,layout.marginLeft,ctx.cursorY+.10,{maxWidth:w}); ctx.cursorY+=.16; if(kind==='rep'){ doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(...theme.muted); doc.text(`Coach / Team: ${pdfText(d.row.entry?.team,'No Team')}`,layout.marginLeft,ctx.cursorY+.08,{maxWidth:w}); ctx.cursorY+=.13; } d.fields.forEach(([label,v])=>{ doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(...theme.secondary); doc.text(`${label}:`,layout.marginLeft,ctx.cursorY+.08); doc.setFont('helvetica','normal'); doc.setTextColor(...theme.ink); const lines=doc.splitTextToSize(pdfText(v,''),w-.95); doc.text(lines,layout.marginLeft+.9,ctx.cursorY+.08,{maxWidth:w-.95}); ctx.cursorY+=Math.max(.14,lines.length*.12); }); ctx.cursorY+=.08; }); }
function pdfDrawTeamHeader(ctx,section){ if(!ctx.currentTitle) pdfStartPage(ctx,section.title); pdfDrawCompactSectionHeader(ctx,section.title); const {doc,theme,layout}=ctx,w=layout.pageWidth-layout.marginLeft-layout.marginRight; doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(...theme.ink); doc.text(`Team Score: ${section.team.teamRow?pdfScore(section.team.teamRow):'-'} | Winning Representative: ${pdfText(section.team.repWinner?.entry?.name,'None')} | Representatives: ${section.rows.length}`,layout.marginLeft,ctx.cursorY+.12,{maxWidth:w}); ctx.cursorY+=.26; }
async function renderPdfSection(ctx,section){ if(section.type==='winner-coach'){ pdfDrawCompactWinner(ctx,{label:'Winning Coach',name:section.row?.entry?.name,detail:`Team Score: ${pdfScore(section.row)} | Rank: ${pdfRank(section.row)}`}); return; } if(section.type==='winner-overall-rep'){ pdfDrawCompactWinner(ctx,{label:'Winning Representative Overall',name:section.row?.entry?.name,detail:`Coach / Team: ${pdfText(section.row?.entry?.team,'No Team')} | Score: ${pdfScore(section.row)} | Rank: ${pdfRank(section.row)}`}); return; } if(section.type==='winner-team-reps'){ pdfDrawTeamWinnerList(ctx,section.title,section.items); return; } if(section.type==='team-breakdown'){ pdfDrawTeamHeader(ctx,section); return pdfDrawRankingSection(ctx,`${section.title} — Representative Rankings`,section.rows,'rep'); } if(section.type.includes('coach')) return pdfDrawRankingSection(ctx,section.title,section.rows,'team'); return pdfDrawRankingSection(ctx,section.title,section.rows,'rep'); }
function pdfAddFinalFooters(doc,ctx){ const pages=doc.internal.getNumberOfPages(), {theme,layout}=ctx; for(let i=1;i<=pages;i++){ doc.setPage(i); doc.setDrawColor(...theme.secondary); doc.line(layout.marginLeft,layout.pageHeight-.30,layout.pageWidth-layout.marginRight,layout.pageHeight-.30); doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(...theme.muted); doc.text('All Star report export generated from the current scored report.',layout.marginLeft,layout.pageHeight-.16); doc.text(`Page ${i} of ${pages}`,layout.pageWidth-layout.marginRight,layout.pageHeight-.16,{align:'right'}); } }
async function exportPDF(request={}){
  if(request instanceof Event) request={};
  const report=request.report||state.lastRenderedReport, options=mergePdfOptions(request.options||state.pdfOptions||loadPdfOptions()), validation=validatePdfOptions(options,report);
  if(validation){ if(request.silent) throw new Error(validation); alert(validation); return null; }
  const JsPDF=jsPDFCtor(); if(!JsPDF){ const msg='The PDF library did not load. Check the internet connection, refresh, and try again.'; if(request.silent) throw new Error(msg); alert(msg); return null; }
  const label=request.progressLabel?request.progressLabel+': ':'';
  try{
    showProgress(`${label}validating report and PDF settings...`,5); await yieldToBrowser(); updateProgress(`${label}building PDF content plan...`,12); const plan=buildPdfContentPlan(report,options); if(!plan.length) throw new Error('No valid PDF sections were available for the selected options.');
    await yieldToBrowser(); const doc=createPdfDocument(options), theme=getPdfTheme(options), ctx=pdfCreateRenderContext(doc,report,options,theme); updateProgress(`${label}rendering selected PDF sections...`,25);
    for(let i=0;i<plan.length;i++){ updateProgress(`${label}building section ${i+1} of ${plan.length}: ${plan[i].title}`,25+Math.floor(60*i/Math.max(1,plan.length))); await renderPdfSection(ctx,plan[i]); await yieldToBrowser(); }
    updateProgress(`${label}adding headers and page numbers...`,88); pdfAddFinalFooters(doc,ctx); updateProgress(`${label}saving PDF...`,94);
    const prefix=request.fileNameBase?`${pdfFilePart(request.fileNameBase)}-${pdfFilePart(options.title||report.model?.name)}`:pdfFilePart(options.title||report.model?.name), fileName=`${prefix}-${ymd(new Date())}.pdf`;
    doc.save(fileName); updateProgress(`${label}PDF exported`,100); return {fileName,doc};
  }catch(err){ console.error('PDF export failed',err); if(request.silent) throw err; alert(`PDF export failed: ${err?.message||err}`); return null; }
  finally{ if(!request.keepProgress) hideProgress(); }
}
