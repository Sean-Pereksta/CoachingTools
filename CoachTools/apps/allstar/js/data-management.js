/* Permanent, exact coach identity edits. Work is staged and committed once. */
'use strict';
const COACH_IDENTITY_FIELDS=new Set(['team','coach','teamname','coachname','fullteamname','coachassigned','assignedcoach','qacoach','jobcoach','teamlead','leader','supervisor','employeeimmediatesupervisorname','qateam','sourcecoach']);
const COACH_IDENTITY_LIST_FIELDS=new Set(['coachNames','includeTeams','excludeTeams','selectedTeams']);
const coachNameManagerUi={root:null,preview:null,token:null,revision:'',catalog:null};
function exactCoachNameKey(value){return String(value??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase();}
function coachIdentityField(key){return COACH_IDENTITY_FIELDS.has(String(key).replace(/[^a-z0-9]/gi,'').toLowerCase());}
function coachRenameRevision(){return [state.versions?.data||0,state.versions?.mappings||0,state.importCache?.revision||0].join(':');}
function coachRenameHeaders(source){
  const headers=new Set();
  for(const model of state.models||[]){const cfg=model.sourceSettings?.[source];for(const key of ['team','coach','qaTeam','coachField','teamField'])if(cfg?.columns?.[key])headers.add(cfg.columns[key]);}
  const custom=(state.customSources||[]).find(c=>c.sourceKey===source);
  for(const cfg of [custom?.columns,state.data?.[source]?.config])for(const key of ['team','coach','coachField','teamField'])if(cfg?.[key])headers.add(cfg[key]);
  return headers;
}
function coachRenamePeriod(row,fallback=''){
  for(const key of ['_monthlyPeriod','periodLabel','reportLabel','reportDate','Week','Week Start','Week Ending','Date','_week','_date','_interactionDate','_assignedDate']){
    const v=row?.[key];if(v instanceof Date&&!Number.isNaN(v.getTime()))return v.toISOString().slice(0,10);if(typeof v==='string'&&v.trim())return v.trim();
  }
  return fallback||'Undated';
}
function coachRenameRoots(sources){
  const scope=sources?.length&&!sources.some(s=>['packaged','package','json','all','custom'].includes(s))?new Set(sources):null,roots=[];
  const add=(path,source,count=true)=>{if(!scope||scope.has(source)||scope.has(path[1])||((path[1]==='retail'||path[1]==='referral')&&[...scope].some(s=>s.startsWith(path[1]+'_'))))roots.push({path,source,count});};
  for(const key of Object.keys(state.data||{}))add(['data',key],key);
  for(let i=0;i<(state.customSources||[]).length;i++)add(['customSources',i],state.customSources[i].sourceKey);
  if(!scope){add(['categorized'],'categorized',false);if(state.categorizedFragments)add(['categorizedFragments'],'categorized',false);}
  for(const key of Object.keys(state.books||{})){
    if(!scope||scope.has(key)||[...scope].some(s=>s.startsWith(key+'_'))||key==='packaged')roots.push({path:['books',key],source:key,count:false});
  }
  return roots;
}
function coachPathGet(root,path){return path.reduce((v,k)=>v?.[k],root);}
function coachPathReplace(root,path,value){if(!path.length)return value;const [key,...tail]=path,copy=Array.isArray(root)?root.slice():{...root};copy[key]=coachPathReplace(root?.[key],tail,value);return copy;}
function coachRenameAbort(token){if(token?.cancelled){const e=new Error('Coach name change cancelled. No reporting data was changed.');e.name='AbortError';throw e;}}
async function buildCoachRenamePlan(from,to,options={}){
  const oldName=String(from??'').trim(),newName=String(to??'').trim(),oldKey=exactCoachNameKey(oldName),newKey=exactCoachNameKey(newName);
  if(!options.catalog&&(!oldKey||!newKey))throw new Error('Choose an existing coach and enter a replacement name.');
  if(!options.catalog&&oldName===newName)throw new Error('Enter a different coach name.');
  const plan={from:oldName,to:newName,revision:coachRenameRevision(),records:0,periods:new Set(),coaches:new Set(),datasets:new Set(),replacements:[],processed:0};
  const names=new Map(),seenRows=new WeakSet(),seenCounted=new WeakSet(),memo=new WeakMap();
  let lastYield=Date.now();
  const tick=async()=>{if(++plan.processed%1200===0||Date.now()-lastYield>12){coachRenameAbort(options.token);options.onProgress?.(plan.processed);await new Promise(resolve=>setTimeout(resolve,0));lastYield=Date.now();}};
  const replacement=value=>exactCoachNameKey(value)===oldKey?newName:value;
  const list=values=>[...new Map(values.map(v=>{const name=replacement(v);return [exactCoachNameKey(name),name];})).values()];
  async function walk(value,ctx,key=''){
    if(!value||typeof value!=='object'||value instanceof Date||value instanceof Map||value instanceof Set)return value;
    if(memo.has(value))return memo.get(value);
    await tick();
    if(Array.isArray(value)){
      if(COACH_IDENTITY_LIST_FIELDS.has(key))return options.catalog?value:list(value);
      if(key==='monthlySelection')return options.catalog?value:value.map(pair=>Array.isArray(pair)?[pair[0],replacement(pair[1])]:pair);
      const isAoa=/aoa/i.test(key)||ctx.aoa;
      if(isAoa&&value.some(Array.isArray)){
        let columns=[];let next=value;
        for(let i=0;i<value.length;i++){
          const row=value[i];if(!Array.isArray(row))continue;
          if(i<30){const found=row.flatMap((h,j)=>coachIdentityField(h)||ctx.headers.has(h)||(/(?:appt|kpi) summary|team totals/i.test(ctx.sheetName||'')&&/^(?:name|user)$/i.test(String(h).trim()))?[j]:[]);if(found.length){columns=found;continue;}}
          let changed;
          for(const col of columns){const v=row[col];if(typeof v==='string'&&exactCoachNameKey(v)===oldKey&&!options.catalog){changed=changed||row.slice();changed[col]=newName;}}
          if(changed){if(next===value)next=value.slice();next[i]=changed;}
          await tick();
        }
        memo.set(value,next);return next;
      }
      let next=value;memo.set(value,value);
      for(let i=0;i<value.length;i++){
        const v=await walk(value[i],{...ctx,row:typeof value[i]==='object'&&!Array.isArray(value[i]),count:ctx.count&&['rows','sv2','wiper','itac'].includes(key)},key);
        if(v!==value[i]){if(next===value)next=value.slice();next[i]=v;}
      }
      memo.set(value,next);return next;
    }
    let next=value,identityMatched=false;
    const write=(k,v)=>{if(v===value[k])return;if(next===value)next={...value};next[k]=v;};
    const originalIdentity=value._team||value.coach||value.Coach||value.team||value.Team||'';
    for(const [field,v] of Object.entries(value)){
      if(field.startsWith('_coachRename')||['rowsByTeamKey','rowsByCoachAliasKey','diagnostics','canonical'].includes(field))continue;
      const identity=coachIdentityField(field)||ctx.headers.has(field)||(ctx.teamTotals&&field===ctx.identityHeader);
      if(identity&&typeof v==='string'&&v.trim()){
        if(ctx.row&&!seenRows.has(value)){names.set(exactCoachNameKey(v),v.trim());}
        if(exactCoachNameKey(v)===oldKey&&(options.catalog||v!==newName)){identityMatched=true;if(!options.catalog)write(field,newName);}
      }else if(field==='repId'&&typeof v==='string'&&!options.catalog&&(/^(op|wiper)\|/.test(v)||v.split('|').length===4)){
        const parts=v.split('|');if(parts[1]===(window.CoachToolsMonthly?.key(oldName)||oldKey)){parts[1]=window.CoachToolsMonthly?.key(newName)||newKey;write(field,parts.join('|'));}
      }else if(['_teamKey','teamKey','_qaTeamKey','_coachKey','coachKey'].includes(field)&&typeof v==='string'){
        const associated=field==='_qaTeamKey'?value._qaTeam:originalIdentity;
        if(!options.catalog&&exactCoachNameKey(associated)===oldKey&&(v===(typeof coachNameKey==='function'?coachNameKey(oldName):oldKey)||exactCoachNameKey(v)===oldKey))write(field,typeof coachNameKey==='function'?coachNameKey(newName):newKey);
      }else if(v&&typeof v==='object'){
        let child={...ctx,row:false};
        if(field==='monthlyBundle')child.count=false;
        if(field==='monthlyHistory')child.history=true;
        if(ctx.history&&!ctx.period)child.period=field;
        if(field==='teamTotals'){child.teamTotals=true;child.identityHeader=typeof teamTotalsIdentityHeader==='function'?teamTotalsIdentityHeader(v.headers||[]):'';}
        if(field==='aoaBySheet')child.aoa=true;else if(ctx.aoa)child.sheetName=field;
        if(field==='rows'&&ctx.history)child.count=true;
        if(field==='coachAreas'&&!options.catalog){const copy={...v};for(const k of Object.keys(copy))if(k===(window.CoachToolsMonthly?.key(oldName)||oldKey)){const target=window.CoachToolsMonthly?.key(newName)||newKey;if(!(target in copy))copy[target]=copy[k];if(k!==target)delete copy[k];}write(field,copy);}
        else write(field,await walk(v,child,field));
      }
    }
    if(ctx.row)seenRows.add(value);
    if(identityMatched&&ctx.row&&ctx.count&&!seenCounted.has(value)){seenCounted.add(value);plan.records++;plan.periods.add(coachRenamePeriod(value,ctx.period));plan.datasets.add(ctx.source);}
    // Mark both existing populations, so later corrected uploads can be distinguished
    // from the independent contributions that were intentionally combined.
    if(!options.catalog&&value.coach&&value.row&&(value.segments||value.accepted)&&[oldKey,newKey].includes(exactCoachNameKey(value.coach)))write('_coachRenameIdentity',value._coachRenameIdentity||value.coach);
    if(identityMatched&&!options.catalog){
      // Keep original contribution identity when two coach populations are joined.
      // It is provenance, never a display alias; public coach columns are changed.

      if(ctx.teamTotals&&ctx.row)write('_coachRenameOrigin',value._coachRenameOrigin||originalIdentity);
      if(next._teamKey!==undefined)write('_teamKey',typeof coachNameKey==='function'?coachNameKey(newName):newKey);
    }
    memo.set(value,next);return next;
  }
  for(const root of coachRenameRoots(options.sources)){
    coachRenameAbort(options.token);
    if(root.path[0]==='books'&&!options.catalog&&!options.sources?.length&&typeof ensureSheetLoaded==='function')for(const sheet of state.books[root.path[1]]?.sheetNames||[]){coachRenameAbort(options.token);await ensureSheetLoaded(root.path[1],sheet);}
    const value=coachPathGet(state,root.path),headers=coachRenameHeaders(root.source);
    if(root.source==='retail'||root.source==='referral')for(const suffix of ['sv2','wiper','itac','team_totals'])for(const h of coachRenameHeaders(root.source+'_'+suffix))headers.add(h);
    const next=await walk(value,{source:root.source,count:root.count,headers,row:false},root.path.at(-1));
    if(next!==value)plan.replacements.push({path:root.path,before:value,after:next});
  }
  plan.coaches=[...names.values()].sort((a,b)=>a.localeCompare(b));plan.targetExists=names.has(newKey)&&newKey!==oldKey;plan.periods=[...plan.periods].sort();plan.datasets=[...plan.datasets];
  plan.unavailableMergedRates=[];
  if(plan.targetExists&&!options.catalog&&typeof mergedCoachTeamTotalsRows==='function')for(const item of plan.replacements){if(item.path[0]!=='data'||!['retail','referral'].includes(item.path[1]))continue;const ds=item.after?.teamTotals;if(!ds?.rows)continue;for(const row of mergedCoachTeamTotalsRows(ds.rows,ds.headers||[]))for(const field of row._coachMergeUnavailable||[])plan.unavailableMergedRates.push(item.path[1]+': '+field);}
  if(!options.catalog&&!names.has(oldKey))throw new Error('That coach is no longer present. Refresh the coach list and try again.');
  return plan;
}
function coachRenameReferences(value,from,to){
  if(!value||typeof value!=='object')return value;
  if(Array.isArray(value))return value.map(v=>coachRenameReferences(v,from,to));
  let next=value;const replace=v=>exactCoachNameKey(v)===exactCoachNameKey(from)?to:v;
  for(const [key,v] of Object.entries(value)){
    if(key==='renderedResult')continue;
    let result=v;
    if(COACH_IDENTITY_LIST_FIELDS.has(key)&&Array.isArray(v))result=[...new Set(v.map(replace))];
    else if((coachIdentityField(key)||key==='activeTeam')&&typeof v==='string')result=replace(v);
    else if(key==='value'&&coachIdentityField(value.column||value.field)&&typeof v==='string'&&['equals','eq','is','not_equals','neq',''].includes(value.operator||value.op||''))result=replace(v);
    else if(v&&typeof v==='object')result=coachRenameReferences(v,from,to);
    if(result!==v){if(next===value)next={...value};next[key]=result;}
  }
  return next;
}
function coachRenameMarkDirty(plan){
  const changedSources=new Set();
  for(const {path} of plan.replacements){
    if(path[0]==='books')markBookCacheDirty(path[1],'Coach renamed');
    if(path[0]==='data'){
      if(path[1]==='retail'||path[1]==='referral')for(const suffix of ['sv2','wiper','itac','team_totals'])changedSources.add(path[1]+'_'+suffix);else changedSources.add(path[1]);
      if(path[1]==='retail')markRetailPersistenceDirty('Coach renamed');else if(path[1]==='referral')markReferralPersistenceDirty('Coach renamed');else markImportCacheDirty('source',path[1],'Coach renamed');
    }
    if(path[0]==='customSources'){changedSources.add(state.customSources[path[1]].sourceKey);markImportCacheDirty('source',state.customSources[path[1]].sourceKey,'Coach renamed');markImportCacheDirty('misc','customSources','Coach renamed');}
    if(path[0]==='categorized'||path[0]==='categorizedFragments'){changedSources.add('nondate');changedSources.add('date');markImportCacheDirty('misc','categorized','Coach renamed');}
  }
  for(const source of changedSources){const previous=state.sourceMeta?.[source]||{};state.sourceMeta={...state.sourceMeta,[source]:{...previous,sourceVersion:Number(previous.sourceVersion||previous.version||0)+1,version:Number(previous.version||0)+1}};}
  if(changedSources.size)markImportCacheDirty('misc','sourceMeta','Coach name index revision');
}
function applyCoachRenamePlan(plan){
  for(const replacement of plan.replacements)state[replacement.path[0]]=coachPathReplace(state[replacement.path[0]],replacement.path.slice(1),replacement.after);
  for(const area of ['retail','referral'])if(plan.replacements.some(r=>r.path[0]==='data'&&r.path[1]===area)&&state.data[area]?.monthlyBundle&&typeof monthlyAreaData==='function')state.data[area]=monthlyAreaData(state.data[area].monthlyBundle,area,state.data[area],state.data[area].monthlySelection||null);
  coachRenameMarkDirty(plan);
}
function normalizeRememberedCoachName(name){
  let result=String(name??''),seen=new Set();
  const map=new Map((state.coachNameCorrections||[]).map(r=>[exactCoachNameKey(r.from),r.to]));
  while(map.has(exactCoachNameKey(result))&&!seen.has(exactCoachNameKey(result))){seen.add(exactCoachNameKey(result));result=map.get(exactCoachNameKey(result));}
  return result;
}
async function applyRememberedCoachCorrections(options={}){
  if(!(state.coachNameCorrections||[]).length)return 0;
  let count=0;
  for(const rule of state.coachNameCorrections){const to=normalizeRememberedCoachName(rule.from);if(to===rule.from)continue;
    try{const plan=await buildCoachRenamePlan(rule.from,to,options);applyCoachRenamePlan(plan);count+=plan.records;}catch(error){if(!/no longer present/.test(error.message))throw error;}
  }
  return count;
}
async function renameCoachPermanently(from,to,options={}){
  if(state.activeImportJob||state.coachRenameActive||state.reportingDataClearing||state.centralSyncStageActive||state.importCacheLoading||state.startup?.running)throw new Error('Wait for the current data operation to finish.');
  const token=options.token||{};state.coachRenameActive=token;
  const controls=[...document.querySelectorAll('#importModal input, #importModal button')].filter(node=>!node.hasAttribute('data-coach-cancel')&&!node.dataset.close),disabled=controls.map(node=>[node,node.disabled]);controls.forEach(node=>node.disabled=true);
  let stage,extras,committed=false;
  try{
    if(state.importCacheSavePromise)await state.importCacheSavePromise;
    if(state.importCacheSaveTimer){clearTimeout(state.importCacheSaveTimer);state.importCacheSaveTimer=null;}
    if(typeof importCacheHasDirty==='function'&&importCacheHasDirty()&&!await saveImportedDataToIndexedDB('Before coach rename',{silent:true,dirtyOnly:true,noCompaction:true,noRender:true,deferIndexes:true,noRetry:true,coachRename:true}))throw new Error('Existing changes could not be saved. Try again.');
    const plan=await buildCoachRenamePlan(from,to,{token,onProgress:options.onProgress});
    if(plan.targetExists&&!options.confirmMerge)throw new Error('The target coach already exists. Confirm combining their reporting records.');
    coachRenameAbort(token);
    if(plan.revision!==coachRenameRevision())throw new Error('Reporting data changed while preparing the rename. Preview the change again.');
    stage=beginAllStarCentralStage();extras={customSources:state.customSources,coachNameCorrections:state.coachNameCorrections,orgs:state.orgs,researchItems:state.researchItems,activeTeam:state.activeTeam,coachRenameReferences:state.coachRenameReferences,repAliases:state.repAliases,quarantinedRepAliases:state.quarantinedRepAliases};
    applyCoachRenamePlan(plan);
    state.orgs=coachRenameReferences(state.orgs,plan.from,plan.to);state.researchItems=coachRenameReferences(state.researchItems,plan.from,plan.to);state.models=coachRenameReferences(state.models,plan.from,plan.to);
    state.repAliases=new Map([...(state.repAliases||new Map())].map(([key,value])=>[key,coachRenameReferences(value,plan.from,plan.to)]));state.quarantinedRepAliases=coachRenameReferences(state.quarantinedRepAliases,plan.from,plan.to);markImportCacheDirty('misc','aliases','Coach renamed');
    state.selectedTeams=new Set([...state.selectedTeams||[]].map(n=>exactCoachNameKey(n)===exactCoachNameKey(plan.from)?plan.to:n));
    if(exactCoachNameKey(state.activeTeam)===exactCoachNameKey(plan.from))state.activeTeam=plan.to;
    state.coachNameCorrections=(state.coachNameCorrections||[]).filter(r=>exactCoachNameKey(r.from)!==exactCoachNameKey(plan.to)).map(r=>({...r,to:exactCoachNameKey(r.to)===exactCoachNameKey(plan.from)?plan.to:r.to}));
    if(options.remember){state.coachNameCorrections=state.coachNameCorrections.filter(r=>exactCoachNameKey(r.from)!==exactCoachNameKey(plan.from));state.coachNameCorrections.push({from:plan.from,to:plan.to});}
    markImportCacheDirty('misc','coachNameCorrections','Coach renamed');
    // The reference snapshot shares the reporting transaction, allowing recovery
    // even if localStorage settings cannot be updated after the commit.
    const runSettings={...coachRenameReferences(JSON.parse(localStorage.getItem(RUN_SETTINGS_KEY)||'{}'),plan.from,plan.to),selectedTeams:[...state.selectedTeams]};
    const runPresets=typeof loadRunPresets==='function'?coachRenameReferences(loadRunPresets(),plan.from,plan.to):[];
    state.coachRenameReferences={id:id(),runSettings,runPresets,models:state.models,orgs:state.orgs,researchItems:state.researchItems,selectedTeams:[...state.selectedTeams],activeTeam:state.activeTeam,pendingSavedReports:[...(state.coachRenameReferences?.pendingSavedReports||[]),{id:id(),from:plan.from,to:plan.to,merge:plan.targetExists}]};
    markImportCacheDirty('misc','coachRenameReferences','Coach renamed');
    markDataIndexDirty('Coach team name changed',{identityChanged:true});
    for(const area of ['retail','referral'])if(state.data[area]?.teamTotals)markTeamTotalsRowsChanged(state.data[area].teamTotals={...state.data[area].teamTotals});
    coachRenameAbort(token);options.onSaving?.();
    const saved=await saveImportedDataToIndexedDB('Permanent coach rename',{silent:true,dirtyOnly:true,noCompaction:true,noRender:true,deferIndexes:true,noRetry:true,coachRename:true});
    if(!saved)throw new Error(state.importCache.lastError||'The name change could not be saved.');
    committed=true;
    try{localStorage.setItem(ORG_BUILDER_KEY,JSON.stringify(state.orgs));localStorage.setItem(MODEL_KEY,JSON.stringify(state.models));persistResearchItemsToLocalStorage();localStorage.setItem(RUN_SETTINGS_KEY,JSON.stringify(runSettings));if(typeof ALLSTAR_PRESET_KEY!=='undefined')localStorage.setItem(ALLSTAR_PRESET_KEY,JSON.stringify(runPresets));localStorage.setItem('allStarCoachRenameApplied.v1',state.coachRenameReferences.id);}catch(error){console.warn('Coach rename saved; settings will recover from the reporting transaction.',error);}
    state.teams=[...new Set((state.teams||[]).map(n=>exactCoachNameKey(n)===exactCoachNameKey(plan.from)?plan.to:n))];
    state.repTeams=new Map([...(state.repTeams||new Map())].map(([key,n])=>[key,exactCoachNameKey(n)===exactCoachNameKey(plan.from)?plan.to:n]));
    if(typeof renameCoachSavedReports==='function'){
      try{
        const pending=[...(state.coachRenameReferences.pendingSavedReports||[])];
        for(const entry of pending){const changed=await renameCoachSavedReports(entry.from,entry.to,{merge:entry.merge});if(changed===false)throw new Error('Saved report updates are pending.');state.coachRenameReferences={...state.coachRenameReferences,pendingSavedReports:state.coachRenameReferences.pendingSavedReports.filter(r=>r.id!==entry.id)};}
        markImportCacheDirty('misc','coachRenameReferences','Coach saved reports updated');
        if(!await saveImportedDataToIndexedDB('Coach saved report journal',{silent:true,dirtyOnly:true,noCompaction:true,noRender:true,deferIndexes:true,noRetry:true,coachRename:true}))throw new Error('Saved report journal will be checked on reload.');
      }catch(error){plan.savedReportsPending=true;console.warn('Coach rename saved; historical report update will retry on reload.',error);}
    }
    state.qualtricsCoreBuildToken=id();state.qualtricsCoreConnectedSignature='';state.qualtricsCorePendingSignature='';
    coachNameManagerUi.catalog=null;
    if(typeof invalidateAllStarRenderedData==='function')try{await invalidateAllStarRenderedData('Coach renamed');}catch(error){console.warn('Coach rename committed; derived report refresh needs retry.',error);}
    window.AllStarWorkspaceNavigation?.renameCoach?.(plan.from,plan.to);
    for(const refresh of [typeof renderTeamSelect==='function'&&renderTeamSelect,typeof renderCategorizedSummary==='function'&&renderCategorizedSummary,typeof setStatus==='function'&&setStatus])if(refresh)try{refresh();}catch(error){console.warn('Coach rename display refresh',error);}
    return plan;
  }catch(error){if(!committed){stage?.rollback();if(extras)Object.assign(state,extras);}throw error;}
  finally{state.coachRenameActive=null;disabled.forEach(([node,value])=>node.disabled=value);}
}
async function refreshCoachNameManager(){
  const root=coachNameManagerUi.root;if(!root)return;
  const status=root.querySelector('[data-coach-status]');
  status.textContent='Loading coach names…';
  try{
    if(!coachNameManagerUi.catalog||coachNameManagerUi.revision!==coachRenameRevision()){coachNameManagerUi.catalog=await buildCoachRenamePlan('','',{catalog:true});coachNameManagerUi.revision=coachRenameRevision();}
    const list=root.querySelector('datalist');list.replaceChildren();
    for(const name of coachNameManagerUi.catalog.coaches){const option=document.createElement('option');option.value=name;list.append(option);}
    status.textContent=coachNameManagerUi.catalog.coaches.length+' coaches available. Preview an exact name change before applying it.';
    const rules=root.querySelector('[data-coach-rules]');rules.replaceChildren();
    for(const rule of state.coachNameCorrections||[]){const line=document.createElement('div');line.textContent=rule.from+' → '+rule.to+' ';const remove=document.createElement('button');remove.type='button';remove.className='smallBtn';remove.textContent='Forget correction';remove.onclick=async()=>{if(state.coachRenameActive||state.activeImportJob||state.reportingDataClearing){status.textContent='Wait for the current data operation to finish.';return;}const previous=state.coachNameCorrections;state.coachNameCorrections=previous.filter(r=>r!==rule);markImportCacheDirty('misc','coachNameCorrections','Forget coach correction');if(!await saveImportedDataToIndexedDB('Forget coach correction',{silent:true,dirtyOnly:true,noRender:true,deferIndexes:true,noRetry:true})){state.coachNameCorrections=previous;status.textContent='The correction could not be removed. Try again.';}else refreshCoachNameManager();};line.append(remove);rules.append(line);}
  }catch(error){status.textContent=error.message;}
}
function mountCoachNameManager(container){
  const root=typeof container==='string'?document.getElementById(container):container;if(!root||root.dataset.coachNamesMounted)return;
  root.dataset.coachNamesMounted='true';coachNameManagerUi.root=root;
  root.innerHTML='<details><summary><strong>Manage Coach Names — Rename Coach</strong></summary><p class="hint">Permanently update coach identity fields across stored and historical reporting data. Other names and free text stay intact.</p><div class="grid2"><label class="field">Existing Coach<input data-coach-from type="search" list="allstarCoachRenameNames" placeholder="Search existing coaches" autocomplete="off"></label><label class="field">Change Name To<input data-coach-to type="text" list="allstarCoachRenameNames" placeholder="Corrected or existing coach name" autocomplete="off"></label></div><datalist id="allstarCoachRenameNames"></datalist><label class="checkItem"><input type="checkbox" data-coach-remember>Remember this correction for future uploads</label><div class="row"><button type="button" class="dark" data-coach-preview>Preview Changes</button><button type="button" class="green" data-coach-apply disabled>Apply Name Change</button><button type="button" class="gray" data-coach-cancel hidden>Cancel</button></div><p data-coach-status role="status" aria-live="polite">Expand to load coach names.</p><div data-coach-rules></div></details>';
  const status=root.querySelector('[data-coach-status]'),from=root.querySelector('[data-coach-from]'),to=root.querySelector('[data-coach-to]'),preview=root.querySelector('[data-coach-preview]'),apply=root.querySelector('[data-coach-apply]'),cancel=root.querySelector('[data-coach-cancel]');
  root.querySelector('details').addEventListener('toggle',event=>{if(event.target.open)refreshCoachNameManager();});
  for(const input of [from,to])input.addEventListener('input',()=>{coachNameManagerUi.preview=null;apply.disabled=true;});
  const busy=value=>{from.disabled=to.disabled=preview.disabled=value;cancel.hidden=!value;if(value)apply.disabled=true;};
  cancel.onclick=()=>{if(coachNameManagerUi.token)coachNameManagerUi.token.cancelled=true;};
  preview.onclick=async()=>{const token={};coachNameManagerUi.token=token;busy(true);status.textContent='Checking stored and historical reporting records…';try{const plan=await buildCoachRenamePlan(from.value,to.value,{token});coachNameManagerUi.preview=plan;status.textContent=`${plan.records.toLocaleString()} reporting records across ${plan.periods.length} reporting periods will change.${plan.targetExists?' The target coach already exists. Their records will be grouped under the same coach without adding or deleting source records.':''} Workbook copies, roster identities, and saved coach selections will also be updated.${plan.unavailableMergedRates.length?' These legacy rates do not include counts needed to combine them and will show as unavailable: '+plan.unavailableMergedRates.join(', ')+'.':''}`;apply.disabled=false;}catch(error){status.textContent=error.message;}finally{busy(false);coachNameManagerUi.token=null;}};
  apply.onclick=async()=>{const plan=coachNameManagerUi.preview;if(!plan)return;if(plan.revision!==coachRenameRevision()){status.textContent='Reporting data changed. Preview the name change again.';apply.disabled=true;return;}if(!confirm(`Permanently rename ${plan.from} to ${plan.to} in ${plan.records.toLocaleString()} reporting records?${plan.targetExists?' This will combine both coaches under '+plan.to+'. Existing source records are retained.':''}${plan.unavailableMergedRates.length?' Rates without denominators will be unavailable: '+plan.unavailableMergedRates.join(', ')+'.':''}`))return;const token={};coachNameManagerUi.token=token;busy(true);try{const result=await renameCoachPermanently(plan.from,plan.to,{token,confirmMerge:plan.targetExists,remember:root.querySelector('[data-coach-remember]').checked,onProgress:n=>{status.textContent=`Preparing name change… ${n.toLocaleString()} items checked`;},onSaving:()=>{cancel.hidden=true;status.textContent='Saving the permanent name change…';}});status.textContent=`Saved: ${result.records.toLocaleString()} reporting records now use ${result.to}.${result.savedReportsPending?' Historical report updates are pending and will retry on reload.':''}`;from.value=result.to;coachNameManagerUi.preview=null;}catch(error){status.textContent=error.message;}finally{busy(false);apply.disabled=true;coachNameManagerUi.token=null;}};
}
