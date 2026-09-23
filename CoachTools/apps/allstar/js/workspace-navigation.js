/* Discoverable navigation layered over the existing All-Star actions.
 * No source hydration, normalization, scoring or automatic categorization occurs here.
 * Preferences contain only command ids; models, reports and imported data retain their stores.
 */
(function(root,factory){
  'use strict';
  const api=factory(root);
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.AllStarWorkspaceNavigation=api;
})(typeof window!=='undefined'?window:globalThis,function(root){
  'use strict';
  const PREF_KEY='allStarWorkspaceNavigation.v1';
  const SECTIONS=['Home','Data','Models','Research','Reports','Organizations','Messages','History','Settings'];
  const normalize=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=value=>Number(value||0).toLocaleString();
  const asArray=value=>Array.isArray(value)?value:[];
  function readPreferences(storage){
    try{
      const saved=JSON.parse(storage?.getItem(PREF_KEY)||'{}');
      return {favorites:[...new Set(asArray(saved.favorites).filter(x=>typeof x==='string'))].slice(0,40),recent:asArray(saved.recent).filter(x=>x&&typeof x.id==='string'&&Number.isFinite(x.at)).slice(0,24)};
    }catch(_){ return {favorites:[],recent:[]}; }
  }
  function searchCatalog(catalog,query,preferences={},limit=50){
    const text=normalize(query), tokens=text.split(' ').filter(Boolean), favorites=new Set(preferences.favorites||[]);
    const recent=new Map((preferences.recent||[]).map((entry,i)=>[entry.id,24-i]));
    return catalog.map((item,index)=>{
      const label=normalize(item.label), haystack=item.searchText||normalize([item.label,item.category,item.description,item.keywords].join(' '));
      if(tokens.some(token=>!haystack.includes(token))) return null;
      const score=(text&&label===text?1000:0)+(text&&label.startsWith(text)?180:0)+(favorites.has(item.id)?60:0)+(recent.get(item.id)||0);
      return {item,score,index};
    }).filter(Boolean).sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,limit).map(x=>x.item);
  }
  function sourceSummary(app,sources){
    const raw=sources.filter(s=>!s.categorized), loaded=raw.filter(s=>s.rowCount>0||s.headers?.length);
    const warningCount=asArray(app.categorized?.warnings).length;
    const identityCount=asArray(app.identityConflicts).length+asArray(app.quarantinedRepAliases).length;
    const categorizedRows=sources.filter(s=>s.categorized).reduce((sum,s)=>sum+s.rowCount,0);
    const stale=!!(app.categorizationPending||app.categorized?.stale||Number(app.categorized?.latestDataRevision||0)>Number(app.categorized?.latestCategorizedRevision||0));
    const updated=loaded.map(s=>s.updatedAt).filter(Boolean).sort().pop()||'';
    return {loaded:loaded.length,rows:loaded.reduce((sum,s)=>sum+s.rowCount,0),models:asArray(app.models).length,research:asArray(app.researchItems).length,warningCount,identityCount,categorizedRows,stale,updated};
  }
  function buildCatalog(app,sources,reportMetadata=[],chartMetadata=[]){
    const result=[], ids=new Set();
    function add(item){
      if(!item.id||ids.has(item.id)) return;
      ids.add(item.id); result.push({...item,searchText:normalize([item.label,item.category,item.description,item.keywords].join(' '))});
    }
    [
      ['home','Open Home','Home','Data status, quick start and recent work'],
      ['data','Update Data','Data','Import weekly, monthly, QA and coaching files'],
      ['models','Open Models','Models','Create, modify, duplicate and export models'],
      ['run','Run Model','Models','Choose model, dates and population before running'],
      ['model-new','Create Model','Models','Build your first performance model'],
      ['model-health','Open Model Health','Models','Check source columns and criterion settings'],
      ['research','Open Research','Research','Compare measures, trends and populations'],
      ['research-new','Start Guided Research','Research','Start with a question and build an analysis'],
      ['metrics','Open Metrics','Research','Create and manage reusable measures'],
      ['chart-new','Create Chart','Research','Choose Research data and a visualization'],
      ['board','Open Analysis Board','Research','Saved charts and dashboard cards'],
      ['reports','Open Reports','Reports','View the current report or create a new one'],
      ['report-new','Create Report','Reports','Choose model and reporting population'],
      ['report-saved','Open Saved Reports','History','Open, compare and re-export saved snapshots'],
      ['organizations','Open Organizations','Organizations','Create organizations from coaches and teams'],
      ['teams','Find Teams and Representatives','Organizations','Inspect the imported roster and identity matches'],
      ['messages','Open Messages / Qualtrics','Messages','Rules, mass messages and individual reviews'],
      ['history','Open History','History','Recently opened work and saved report snapshots'],
      ['settings','Open Settings','Settings','Mapping, storage, exports and diagnostics'],
      ['mapping','Review Column Mappings','Data','Mass Header Check and missing columns'],
      ['roster','Roster Reassignment','Organizations','Preview and apply a replacement roster'],
      ['list-tester','Open List Tester','Research','Compare a list of representatives'],
      ['pdf-settings','Report PDF Options','Settings','Style and choose PDF content'],
      ['performance','Open Performance','Settings','Calculation timings, cache reuse and startup diagnostics']
    ].forEach(([action,label,category,description])=>add({id:'action:'+action,action,label,category,description}));
    for(const model of asArray(app.models)){
      add({id:'model:'+model.id,action:'model',entityId:model.id,label:model.name||'Untitled model',category:'Models',description:`Edit model · ${asArray(model.criteria).length} criteria`,keywords:'open modify'});
      add({id:'run:'+model.id,action:'run-model',entityId:model.id,label:'Run '+(model.name||'model'),category:'Models',description:'Select dates and teams before running'});
      for(const criterion of asArray(model.criteria)) add({id:'criterion:'+model.id+':'+criterion.id,action:'criterion',entityId:model.id,criterionId:criterion.id,label:criterion.name||'Unnamed criterion',category:'Model Criteria',description:model.name,keywords:criterion.expression||''});
    }
    for(const item of asArray(app.researchItems)) add({id:'research:'+item.id,action:'research-item',entityId:item.id,label:item.title||'Untitled research',category:'Research',description:item.outputType||'Analysis',keywords:item.source||''});
    for(const metric of asArray(app.metrics)) add({id:'metric:'+metric.id,action:'metric',entityId:metric.id,label:metric.name||'Untitled metric',category:'Metrics',description:metric.notes||metric.field||'Edit saved metric'});
    for(const source of sources){
      add({id:'source:'+source.id,action:'source',entityId:source.id,label:source.label,category:'Data Sources',description:`${number(source.rowCount)} rows · inspect mappings`,keywords:'update import '+source.fileName});
      for(const column of source.headers||[]) add({id:'column:'+source.id+':'+column,action:'column',entityId:source.id,column,label:column,category:'Columns',description:source.label,keywords:source.id});
    }
    for(const org of asArray(app.orgs)) add({id:'org:'+org.id,action:'organization',entityId:org.id,label:org.name||'Organization',category:'Organizations',description:`${asArray(org.coachNames).length} coaches`});
    const teams=new Set(asArray(app.teams).map(x=>typeof x==='string'?x:x.name||x.team).filter(Boolean));
    const roster=[...asArray(app.data?.retail?.controlRoster),...asArray(app.data?.referral?.controlRoster)];
    if(!app.dataIndex?.dirty) roster.push(...asArray(app.dataIndex?.reps));
    if(app.teamIndexCache) roster.push(...asArray(app.teamIndexCache.reps));
    // Read existing roster/entity indexes only. Never enumerate statistical source rows.
    const indexed=app.rosterIndex?.byRepKey;
    if(indexed instanceof Map) indexed.forEach((rep,key)=>roster.push({...rep,_rep:rep.name||rep._rep||key,_repKey:key,_team:rep.team}));
    for(const rep of roster){
      const name=rep._rep||rep.representative||rep.displayName||rep.originalName||rep.name;
      const team=rep._team||rep.team||'';
      if(team) teams.add(team);
      if(!name) continue;
      // Keep homonymous representatives on different teams separate.
      add({id:'rep:'+normalize(name)+':'+normalize(team),action:'representative',entityId:rep._repKey||name,name,team,label:name,category:'Representatives',description:team||'No assigned team',keywords:'find '+team});
    }
    teams.forEach(team=>add({id:'team:'+team,action:'team',entityId:team,label:team,category:'Teams / Coaches',description:'Open team roster and identity details',keywords:'find coach'}));
    for(const report of reportMetadata) add({id:'report:'+report.id,action:'report',entityId:report.id,label:report.modelName||'Saved report',category:'Reports',description:[report.periodStart,report.periodEnd,report.organizationName].filter(Boolean).join(' · '),keywords:report.note||''});
    for(const chart of chartMetadata) add({id:'chart:'+chart.id,action:'chart',entityId:chart.id,label:chart.title||chart.name||'Saved chart',category:'Charts',description:chart.type||chart.chartType||'Open saved chart'});
    return result;
  }

  function createController(options={}){
    const document=options.document||root.document;
    const getState=options.getState||(()=>typeof state!=='undefined'?state:{});
    let storage=options.storage;
    if(storage===undefined){ try{ storage=root.localStorage; }catch(_){ storage=null; } }
    const prefs=readPreferences(storage), providers=new Map();
    let initialized=false, currentSection='Home', workspaceSection='Home', catalog=[], results=[], selected=0, paletteOpen=false, restoreFocus=null;
    let reports=[], reportsLoadedAt=0, reportsFlight=null, pendingRefresh=0, catalogDirty=true;
    const observers=[], cleanups=[];
    const byId=id=>document?.getElementById(id);
    function call(name,...args){ const fn=options.actions?.[name]||root[name]; if(typeof fn==='function') return fn(...args); throw new Error('This action is unavailable: '+name); }
    function persist(){ try{ storage?.setItem(PREF_KEY,JSON.stringify(prefs)); }catch(_){ announce('Navigation preferences could not be saved. You can continue using this session.'); } }
    function announce(message){ const node=byId('asWorkspaceNotice'); if(node) node.textContent=message; }
    function sourceMetadata(){
      if(options.getSources) return options.getSources();
      const app=getState(), sourceKeys=typeof allSourceKeys==='function'?allSourceKeys():[];
      return sourceKeys.map(source=>{
        const meta=app.sourceMeta?.[source]||{}, rows=typeof getRowsRaw==='function'?getRowsRaw(source):[];
        const categorized=typeof isCategorizedSource==='function'?isCategorizedSource(source):['date','nondate'].includes(source);
        return {id:source,label:typeof labelSource==='function'?labelSource(source):source,rowCount:rows?.length||Number(meta.rowCount)||0,headers:typeof getHeaders==='function'?getHeaders(source):meta.normalizedHeaders||[],fileName:meta.fileName||(typeof sourceFileName==='function'?sourceFileName(source):''),updatedAt:meta.lastImportedAt||meta.importedAt||'',categorized};
      });
    }
    function chartMetadata(){
      try{
        const value=typeof root.AllStarCharts?.savedCharts==='function'?root.AllStarCharts.savedCharts():root.AllStarCharts?.savedCharts;
        return Array.isArray(value)?value:[];
      }catch(_){ return []; }
    }
    function getCatalog(force=false){
      if(force||catalogDirty){
        catalog=buildCatalog(getState(),sourceMetadata(),reports,chartMetadata());
        providers.forEach(provider=>{
          try{ for(const item of provider()||[]) if(item?.id&&item.label) catalog.push({...item,searchText:normalize([item.label,item.category,item.description,item.keywords].join(' '))}); }
          catch(error){ console.warn('[All-Star navigation] Search provider unavailable',error); }
        });
        catalogDirty=false;
      }
      return catalog;
    }
    function record(command){
      if(typeof command==='string') command=getCatalog().find(x=>x.id===command);
      if(!command?.id||command.id==='action:home'||command.id==='action:history') return;
      prefs.recent=[{id:command.id,at:Date.now()},...prefs.recent.filter(x=>x.id!==command.id)].slice(0,24);
      persist(); scheduleRefresh();
    }
    function toggleFavorite(id){
      if(prefs.favorites.includes(id)) prefs.favorites=prefs.favorites.filter(x=>x!==id);
      else if(prefs.favorites.length<40) prefs.favorites.push(id);
      else return announce('You can keep up to 40 favorites. Remove one to add another.');
      persist(); if(paletteOpen) renderPalette(); renderPanel();
    }
    function commandButton(item,label){ return `<button type="button" data-as-command="${escape(item.id)}">${escape(label||item.label)}</button>`; }
    function cardsFor(items,empty){
      return items.length?items.map(item=>`<div class="asWorkItem"><div>${commandButton(item)}<small>${escape(item.category)}${item.description?' · '+escape(item.description):''}</small></div><button type="button" class="asFavorite" data-as-favorite="${escape(item.id)}" aria-pressed="${prefs.favorites.includes(item.id)}" aria-label="${prefs.favorites.includes(item.id)?'Remove favorite':'Favorite'}: ${escape(item.label)}">${prefs.favorites.includes(item.id)?'★':'☆'}</button></div>`).join(''):`<p class="asEmptyState">${escape(empty)}</p>`;
    }
    function setSection(section,{showPanel=true}={}){
      currentSection=section;
      byId('asWorkspaceNav')?.querySelectorAll('[data-as-section]').forEach(node=>{
        const active=node.dataset.asSection===section;
        if(active) node.setAttribute('aria-current','page'); else node.removeAttribute('aria-current');
      });
      if(showPanel){
        workspaceSection=section;
        const panel=byId('asWorkspacePanel'); if(panel) panel.hidden=section==='Reports';
        const work=byId('workArea'); if(work) work.hidden=section!=='Reports';
        renderPanel();
      }
    }
    function homeHtml(){
      const app=getState(), sources=sourceMetadata(), summary=sourceSummary(app,sources), all=getCatalog();
      const recent=prefs.recent.map(x=>all.find(y=>y.id===x.id)).filter(Boolean).slice(0,6);
      const favorites=prefs.favorites.map(x=>all.find(y=>y.id===x)).filter(Boolean);
      const updated=summary.updated?new Date(summary.updated):null;
      const stat=(label,value,detail)=>`<div class="asStat"><span>${label}</span><strong>${value}</strong><small>${escape(detail)}</small></div>`;
      return `<div class="asPageHeading"><div><p class="asEyebrow">ALL-STAR WORKSPACE</p><h1>Start with your data. Find your next action.</h1><p>Update sources, run a model, or explore a question in Research.</p></div><button type="button" data-as-command="action:data" class="asPrimary">Update Data</button></div>
        <div class="asStats">${stat('Loaded sources',number(summary.loaded),number(summary.rows)+' imported rows')}${stat('Models',number(summary.models),summary.models?'Saved and ready to configure':'Create your first model')}${stat('Research',number(summary.research),'Saved analyses')}${stat('Categorization',summary.stale?'Needs update':summary.categorizedRows?'Ready':'Not run',number(summary.categorizedRows)+' categorized rows')}</div>
        <section class="asCard"><h2>Quick start</h2><div class="asQuickActions">${[['action:data','1. Update Data'],['action:run','2. Run Model'],['action:research-new','Start Research'],['action:report-new','Create Report'],['action:messages','Open Messages']].map(([id,label])=>commandButton({id,label})).join('')}</div><p class="asMuted">New here? Load your files first. If models use categorized data, open Data and press Categorize Data after the upload.</p></section>
        <div class="asColumns"><section class="asCard"><h2>Recent work</h2>${cardsFor(recent,'The models, Research items, charts and reports you open appear here.')}<button type="button" data-as-command="action:history" class="asTextButton">View history</button></section><section class="asCard"><h2>Favorites</h2>${cardsFor(favorites,'Use the star beside an item in Search or Recent work to keep it here.')}<button type="button" data-as-open-palette class="asTextButton">Search everything</button></section></div>
        <div class="asColumns"><section class="asCard"><h2>Data health</h2><ul class="asHealthList"><li><span>Data</span><strong>${summary.loaded?'Loaded':'Choose files to begin'}</strong></li><li><span>Models</span><strong>${summary.models?'Check readiness when selecting a model':'No models yet'}</strong></li><li><span>Categorization</span><strong>${summary.stale?'Update required':summary.categorizedRows?'Current':'Not yet created'}</strong></li><li><span>Mapping warnings</span><strong>${number(summary.warningCount)}</strong></li><li><span>Identity warnings</span><strong>${number(summary.identityCount)}</strong></li></ul><p class="asMuted">Model-specific blocking issues are checked in Run → View Details.</p><div class="asQuickActions"><button type="button" data-as-command="action:mapping">Review mappings</button><button type="button" data-as-command="action:teams">Review identities</button></div></section><section class="asCard"><h2>Loaded sources</h2><p class="asMuted">${updated&&!isNaN(updated)?'Last imported '+escape(updated.toLocaleString()):'Import time will appear after a new upload.'}</p><div class="asSourceList">${sources.filter(x=>!x.categorized&&(x.rowCount||x.headers?.length)).map(source=>`<div class="asSourceRow">${commandButton({id:'source:'+source.id,label:source.label})}<span>${number(source.rowCount)} rows</span><small>${escape(source.fileName||'Connected data')}</small></div>`).join('')||'<p class="asEmptyState">No sources loaded. Choose Update Data to connect your coaching files.</p>'}</div></section></div>`;
    }
    function historyHtml(){
      const all=getCatalog(), recent=prefs.recent.map(entry=>{ const item=all.find(x=>x.id===entry.id); return item?{...item,description:new Date(entry.at).toLocaleString()}:null; }).filter(Boolean);
      const saved=all.filter(x=>x.category==='Reports');
      return `<div class="asPageHeading"><div><h1>History</h1><p>Continue recent work or inspect an automatically saved report snapshot.</p></div><button type="button" data-as-command="action:report-saved">Compare saved reports</button></div><div class="asColumns"><section class="asCard"><h2>Recently opened</h2>${cardsFor(recent,'Your recent actions will appear here.')}</section><section class="asCard"><h2>Saved reports</h2>${cardsFor(saved,'No report snapshots are available yet. Run a model to create your first report.')}${commandButton({id:'action:report-new',label:'Create Report'})}</section></div>`;
    }
    function settingsHtml(){
      const all=getCatalog();
      return `<div class="asPageHeading"><div><h1>Settings and tools</h1><p>Find mapping, storage, reporting and diagnostic controls in their existing workspaces.</p></div></div><div class="asColumns"><section class="asCard"><h2>Data and identity</h2>${cardsFor(all.filter(x=>['action:data','action:mapping','action:roster','action:teams'].includes(x.id)),'')}</section><section class="asCard"><h2>Reporting and diagnostics</h2>${cardsFor(all.filter(x=>['action:pdf-settings','action:model-health','action:metrics','action:performance'].includes(x.id)),'')}<p class="asMuted">Open Data for cache backup, persistence, troubleshooting and package exports. Your existing presets remain in Run.</p></section></div>`;
    }
    function renderPanel(){
      const host=byId('asWorkspacePanel'); if(!host||host.hidden) return;
      host.innerHTML=workspaceSection==='History'?historyHtml():workspaceSection==='Settings'?settingsHtml():homeHtml();
    }
    function renderReportEmpty(){
      const work=byId('workArea'); if(!work||!work.querySelector('.empty')||work.querySelector('.reportHeader')) return;
      const empty=work.querySelector('.empty'); if(empty.querySelector('[data-as-report-empty]')) return;
      empty.innerHTML='<section data-as-report-empty class="asReportEmpty"><h1>Your reports</h1><p>Run a model to compare performance, inspect calculations and export your report.</p><div class="asQuickActions"><button type="button" class="asPrimary" data-as-command="action:report-new">Create Report</button><button type="button" data-as-command="action:report-saved">Open saved reports</button></div></section>';
    }
    function refresh(){ catalogDirty=true; if(!initialized) return; renderPanel(); if(paletteOpen) renderPalette(); }
    function scheduleRefresh(){ if(pendingRefresh) root.clearTimeout(pendingRefresh); pendingRefresh=root.setTimeout(()=>{ pendingRefresh=0; refresh(); },120); }
    async function loadReportMetadata(force=false){
      if(reportsFlight) return reportsFlight;
      if(!force&&Date.now()-reportsLoadedAt<5000) return reports;
      const list=options.actions?.listSavedReports||root.listSavedReports;
      if(typeof list!=='function') return [];
      reportsFlight=Promise.resolve().then(()=>list()).then(values=>{
        // Discard report row snapshots; global search needs metadata only.
        reports=asArray(values).map(({id,modelName,periodStart,periodEnd,organizationName,note,createdAt})=>({id,modelName,periodStart,periodEnd,organizationName,note,createdAt}));
        reportsLoadedAt=Date.now(); catalogDirty=true;
        if(initialized){ renderPanel(); if(paletteOpen) renderPalette(); }
        return reports;
      }).catch(error=>{ console.warn('[All-Star navigation] Saved reports unavailable',error); return []; }).finally(()=>{ reportsFlight=null; });
      return reportsFlight;
    }
    function selectOption(index){
      selected=Math.max(0,Math.min(results.length-1,index));
      byId('asCommandResults')?.querySelectorAll('[role="option"]').forEach((node,i)=>node.setAttribute('aria-selected',String(i===selected)));
      const input=byId('asCommandInput');
      if(results.length){ input?.setAttribute('aria-activedescendant','asCommandOption'+selected); byId('asCommandOption'+selected)?.scrollIntoView?.({block:'nearest'}); }
      else input?.removeAttribute('aria-activedescendant');
      const star=byId('asCommandFavorite');
      if(star){ star.disabled=!results.length; star.textContent=results[selected]&&prefs.favorites.includes(results[selected].id)?'★ Remove favorite':'☆ Add favorite'; }
    }
    function renderPalette(){
      const list=byId('asCommandResults'); if(!list) return;
      const previous=results[selected]?.id;
      results=searchCatalog(getCatalog(),byId('asCommandInput')?.value||'',prefs);
      list.innerHTML=results.map((item,i)=>`<div role="option" id="asCommandOption${i}" data-as-option="${i}" aria-selected="false"><span><strong>${prefs.favorites.includes(item.id)?'★ ':''}${escape(item.label)}</strong><small>${escape(item.description||'')}</small></span><span class="asCommandCategory">${escape(item.category||'Action')}</span></div>`).join('')||'<div class="asEmptyState">No matches. Try a model, source, column, representative or action name.</div>';
      byId('asCommandCount').textContent=results.length===50?'Showing the first 50 matches. Type more to narrow your search.':results.length+' matches';
      const index=results.findIndex(item=>item.id===previous); selectOption(index<0?0:index);
    }
    function openPalette(){
      if(!initialized) init();
      if(paletteOpen){ byId('asCommandInput')?.focus(); return; }
      restoreFocus=document.activeElement; paletteOpen=true; catalogDirty=true; results=[]; selected=0;
      byId('asCommandPalette').hidden=false; byId('asCommandInput').value=''; renderPalette(); byId('asCommandInput').focus(); loadReportMetadata();
    }
    function closePalette(){
      if(!paletteOpen) return;
      paletteOpen=false; byId('asCommandPalette').hidden=true;
      if(restoreFocus?.isConnected) restoreFocus.focus?.();
    }
    function triggerButton(id){ const button=byId(id); if(!button) throw new Error('The requested tool is unavailable.'); button.click(); }
    function closeVisibleModals(){
      // Use the original close path so editor draft capture and Research cancellation
      // still run. Keeping old fixed modals open can obscure the chosen destination.
      const close=options.actions?.closeModal||root.closeModal;
      if(typeof close!=='function') return true;
      for(const modal of [...document.querySelectorAll('.modalBackdrop.open')].reverse()){
        if(!modal.id) continue;
        if(close(modal.id)===false) return false;
      }
      return true;
    }
    async function execute(command){
      if(typeof command==='string') command=getCatalog(true).find(x=>x.id===command);
      if(!command) return;
      closePalette();
      try{
        if(!closeVisibleModals()) return;
        const app=getState();
        if(typeof command.run==='function') await command.run();
        else switch(command.action){
          case 'home': setSection('Home'); break;
          case 'data': call('openModal','importModal'); break;
          case 'models': call('renderModelList'); call('openModal','modelsModal'); break;
          case 'model-new': call('openEditModel',null); break;
          case 'model': case 'criterion':
            call('openEditModel',command.entityId);
            if(command.criterionId){ const node=[...byId('criteriaList')?.querySelectorAll('[data-criterion-id],[data-crit]')||[]].find(x=>x.dataset.criterionId===command.criterionId||x.dataset.crit===command.criterionId); node?.scrollIntoView?.({block:'center'}); }
            break;
          case 'run': case 'report-new': triggerButton('runBtn'); break;
          case 'run-model':
            triggerButton('runBtn');
            if(byId('runModelSelect')){ byId('runModelSelect').value=command.entityId; byId('runModelSelect').dispatchEvent(new root.Event('change',{bubbles:true})); }
            break;
          case 'model-health':
            if(app.editModel) call('openModal','editModelModal');
            else if(app.models?.length) call('openEditModel',app.models[0].id);
            else { call('openEditModel',null); break; }
            call('runModelColumnCheck'); break;
          case 'research': await call('openResearchWorkspace'); break;
          case 'research-new': case 'chart-new': call('openResearchItemEditor',null); break;
          case 'research-item': call('openResearchItemEditor',command.entityId); break;
          case 'metrics': await call('openMetricsPage'); break;
          case 'metric': call('openMetricEditor',command.entityId); break;
          case 'board': if(root.AllStarCharts?.openBoard) await root.AllStarCharts.openBoard(); else await call('openResearchWorkspace'); break;
          case 'chart': if(root.AllStarCharts?.openSaved) await root.AllStarCharts.openSaved(command.entityId); else await call('openResearchWorkspace'); break;
          case 'reports': setSection('Reports'); renderReportEmpty(); break;
          case 'report-saved': await call('openRecentRuns'); break;
          case 'report': await call('openSavedReport',command.entityId); setSection('Reports'); break;
          case 'organizations': call('openOrgBuilder'); break;
          case 'organization': call('openOrgBuilder'); app.activeOrgId=command.entityId; call('renderOrgBuilder'); break;
          case 'teams': call('openTeamsImported'); break;
          case 'team':
            if(byId('teamRepSearch')) byId('teamRepSearch').value='';
            if(byId('teamManagerSearch')) byId('teamManagerSearch').value='';
            call('openTeamsImported'); await call('loadTeamDetails',command.entityId); break;
          case 'representative':
            if(byId('teamRepSearch')) byId('teamRepSearch').value=command.name;
            if(byId('teamManagerSearch')) byId('teamManagerSearch').value='';
            call('openTeamsImported');
            if(command.team) await call('loadTeamDetails',command.team);
            else announce('This representative has no assigned team. Review the imported roster and identity mappings.');
            break;
          case 'messages': call('openQualtricsEmailWorkspace'); break;
          case 'history': setSection('History'); await loadReportMetadata(true); break;
          case 'settings': setSection('Settings'); break;
          case 'mapping': call('openMassHeaderCheck'); break;
          case 'source': case 'column': {
            const source=sourceMetadata().find(x=>x.id===command.entityId);
            if(source&&(source.rowCount||source.headers?.length)) call('openTroubleshoot',command.entityId);
            else call('openModal','importModal');
            break;
          }
          case 'roster': call('openRosterReassignment'); break;
          case 'list-tester': call('openListTester'); break;
          case 'pdf-settings': call('openPdfOptionsModal'); break;
          case 'performance': showPerformance(); break;
          default: throw new Error('This item is no longer available.');
        }
        record(command);
      }catch(error){ announce(error?.message||'The requested action could not be opened.'); console.warn('[All-Star navigation]',error); }
    }
    function showPerformance(){
      const app=getState(), engine=root.AllStarAnalysis;
      const data={startup:app.startup?.diagnostics||{},researchCache:app.researchCacheStats||{},recentResearch:asArray(app.researchPerformanceRuns).slice(-10),runIndexes:asArray(app.runIndexDiagnostics).slice(-10)};
      if(typeof engine?.diagnostics==='function') data.analysis=engine.diagnostics();
      const modal=byId('asPerformanceDialog'); byId('asPerformanceData').textContent=JSON.stringify(data,(key,value)=>value instanceof Map?{entries:value.size}:value,2); modal.hidden=false; byId('asPerformanceClose').focus();
    }
    function onKeydown(event){
      if((event.ctrlKey||event.metaKey)&&String(event.key).toLowerCase()==='k'){ event.preventDefault(); paletteOpen?closePalette():openPalette(); return; }
      if(!paletteOpen) return;
      if(event.key==='Escape'){ event.preventDefault(); closePalette(); return; }
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){ event.preventDefault(); selectOption((selected+(event.key==='ArrowDown'?1:-1)+results.length)%Math.max(1,results.length)); return; }
      if(event.key==='Enter'&&event.target===byId('asCommandInput')){ event.preventDefault(); if(results[selected]) execute(results[selected]); return; }
      if(event.key==='Tab'){
        const nodes=[byId('asCommandInput'),byId('asCommandFavorite'),byId('asCommandClose')].filter(x=>x&&!x.disabled);
        const index=nodes.indexOf(document.activeElement);
        event.preventDefault();
        const next=index<0?0:(index+(event.shiftKey?-1:1)+nodes.length)%nodes.length;
        nodes[next]?.focus();
      }
    }
    function onClick(event){
      const target=event.target.closest?.('[data-as-command],[data-as-favorite],[data-as-section],[data-as-open-palette],[data-as-option]');
      if(!target) return;
      if(target.hasAttribute('data-as-favorite')) return toggleFavorite(target.dataset.asFavorite);
      if(target.hasAttribute('data-as-open-palette')) return openPalette();
      if(target.hasAttribute('data-as-option')) return execute(results[Number(target.dataset.asOption)]);
      if(target.hasAttribute('data-as-section')){
        const section=target.dataset.asSection, action={Home:'home',Data:'data',Models:'models',Research:'research',Reports:'reports',Organizations:'organizations',Messages:'messages',History:'history',Settings:'settings'}[section];
        return execute('action:'+action);
      }
      return execute(target.dataset.asCommand);
    }
    function bind(target,name,handler){ target?.addEventListener(name,handler); cleanups.push(()=>target?.removeEventListener(name,handler)); }
    function observeLegacyActions(){
      if(!root.MutationObserver) return;
      const sections={importModal:'Data',troubleshootModal:'Data',modelsModal:'Models',editModelModal:'Models',massHeaderModal:'Data',runModal:'Reports',researchModal:'Research',researchEditorModal:'Research',metricsModal:'Research',metricEditorModal:'Research',orgBuilderModal:'Organizations',teamsModal:'Organizations',qualtricsEmailModal:'Messages',recentRunsModal:'History',pdfOptionsModal:'Reports'};
      Object.entries(sections).forEach(([id,section])=>{
        const node=byId(id); if(!node) return;
        const observer=new root.MutationObserver(()=>{
          if(!node.classList.contains('open')){
            const open=[...document.querySelectorAll('.modalBackdrop.open')].filter(modal=>sections[modal.id]).pop();
            setSection(open?sections[open.id]:workspaceSection,{showPanel:false}); scheduleRefresh(); return;
          }
          setSection(section,{showPanel:false}); catalogDirty=true;
          const app=getState();
          if(id==='modelsModal'&&!app.models?.length&&byId('modelList')) byId('modelList').innerHTML='<p class="asEmptyState">Create your first model to combine criteria, scoring, display fields and source data.</p><button type="button" data-as-command="action:model-new">Create Model</button>';
          if(id==='editModelModal'&&app.editOriginalId) record('model:'+app.editOriginalId);
          else if(id==='researchEditorModal'&&byId('researchEditId')?.value) record('research:'+byId('researchEditId').value);
          else if(id==='metricEditorModal'&&byId('metricEditId')?.value) record('metric:'+byId('metricEditId').value);
        });
        observer.observe(node,{attributes:true,attributeFilter:['class']}); observers.push(observer);
      });
      const work=byId('workArea');
      if(work){ const observer=new root.MutationObserver(()=>{ if(work.querySelector('.reportHeader')){ setSection('Reports'); loadReportMetadata(true); } }); observer.observe(work,{childList:true}); observers.push(observer); }
      const status=byId('topStatus');
      if(status){ const observer=new root.MutationObserver(scheduleRefresh); observer.observe(status,{childList:true,subtree:true,characterData:true}); observers.push(observer); }
    }
    function init(){
      if(initialized||!document?.body) return api;
      initialized=true;
      const toolbar=document.querySelector('.toolbar');
      const shell=document.createElement('header'); shell.id='asWorkspaceHeader'; shell.className='asWorkspaceHeader';
      shell.innerHTML=`<div class="asBrandRow"><div class="asBrand"><span class="asBrandMark" aria-hidden="true">A★</span><span>All-Star<small>Coaching insights</small></span></div><button type="button" data-as-open-palette class="asSearchButton" aria-keyshortcuts="Control+K Meta+K">Search tools and data <kbd>Ctrl / ⌘ K</kbd></button></div><nav id="asWorkspaceNav" class="asWorkspaceNav" aria-label="Primary">${SECTIONS.map(section=>`<button type="button" data-as-section="${section}" ${section==='Home'?'aria-current="page"':''}>${section==='Messages'?'Messages / Qualtrics':section}</button>`).join('')}</nav><div id="asWorkspaceNotice" role="status" aria-live="polite" class="asWorkspaceNotice"></div>`;
      document.body.insertBefore(shell,document.body.firstChild);
      if(toolbar){
        const tools=document.createElement('details'); tools.id='asLegacyTools'; tools.className='asLegacyTools';
        const summary=document.createElement('summary'); summary.textContent='All tools · original shortcuts'; tools.appendChild(summary);
        toolbar.parentNode.insertBefore(tools,toolbar); tools.appendChild(toolbar);
        const status=byId('topStatus'); if(status) shell.appendChild(status);
      }
      const panel=document.createElement('main'); panel.id='asWorkspacePanel'; panel.className='asWorkspacePanel';
      const work=byId('workArea'); if(work) work.parentNode.insertBefore(panel,work); else document.body.appendChild(panel);
      const palette=document.createElement('div'); palette.id='asCommandPalette'; palette.className='asCommandBackdrop'; palette.hidden=true;
      palette.innerHTML='<section role="dialog" aria-modal="true" aria-labelledby="asCommandTitle" class="asCommandDialog"><div class="asCommandHeading"><h2 id="asCommandTitle">Search All-Star</h2><button type="button" id="asCommandClose" aria-label="Close search">Close</button></div><label for="asCommandInput" class="asMuted">Find an action, model, criterion, source, column, team or representative</label><input id="asCommandInput" type="search" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="asCommandResults" placeholder="Try: Run Appointment Rate or Catherine Mock"><div id="asCommandResults" role="listbox" aria-label="Search results"></div><div class="asCommandFooter"><span id="asCommandCount" role="status" aria-live="polite"></span><button type="button" id="asCommandFavorite">☆ Add favorite</button></div><p class="asMuted">↑ ↓ choose · Enter open · Esc close</p></section>';
      document.body.appendChild(palette);
      const perf=document.createElement('div'); perf.id='asPerformanceDialog'; perf.className='asCommandBackdrop'; perf.hidden=true;
      perf.innerHTML='<section role="dialog" aria-modal="true" aria-labelledby="asPerformanceTitle" class="asCommandDialog"><div class="asCommandHeading"><h2 id="asPerformanceTitle">Performance diagnostics</h2><button type="button" id="asPerformanceClose">Close</button></div><p class="asMuted">Recorded timings and cache counters. Opening this panel does not run calculations.</p><pre id="asPerformanceData"></pre></section>';
      document.body.appendChild(perf);
      bind(document,'click',onClick); bind(document,'keydown',onKeydown);
      bind(byId('asCommandInput'),'input',()=>{selected=0;results=[];renderPalette();});
      bind(byId('asCommandClose'),'click',closePalette);
      bind(byId('asCommandFavorite'),'click',()=>{if(results[selected])toggleFavorite(results[selected].id);});
      bind(palette,'click',event=>{if(event.target===palette)closePalette();});
      const closePerformance=()=>{perf.hidden=true;byId('asWorkspaceNav')?.querySelector('[aria-current]')?.focus();};
      bind(byId('asPerformanceClose'),'click',closePerformance);
      bind(perf,'click',event=>{if(event.target===perf)closePerformance();});
      bind(perf,'keydown',event=>{if(event.key==='Escape'){event.preventDefault();closePerformance();}if(event.key==='Tab'){event.preventDefault();byId('asPerformanceClose').focus();}});
      bind(root,'coachtools:data-updated',scheduleRefresh); bind(root,'allstar:workspace-updated',scheduleRefresh);
      bind(root,'storage',event=>{if(event.key===PREF_KEY){ const next=readPreferences(storage); prefs.favorites=next.favorites;prefs.recent=next.recent;refresh(); }});
      observeLegacyActions(); setSection('Home'); loadReportMetadata();
      return api;
    }
    const api={init,refresh,record,openPalette,closePalette,execute,toggleFavorite,getCatalog,loadReportMetadata,registerProvider:(name,provider)=>{providers.set(name,provider);catalogDirty=true;},destroy:()=>{observers.forEach(x=>x.disconnect());cleanups.forEach(x=>x());if(pendingRefresh)root.clearTimeout(pendingRefresh);},getPreferences:()=>JSON.parse(JSON.stringify(prefs))};
    return api;
  }
  const instance=createController();
  return Object.assign(instance,{createController,buildCatalog,searchCatalog,sourceSummary,readPreferences});
});
