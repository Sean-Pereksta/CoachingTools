/* Additive sentence-based Dated Stats Research. Existing editors remain intact. */
(function(root){
  'use strict';
  const Q=root.AllStarSentenceQuery,E=root.AllStarDatedStats;
  if(!Q||!E||typeof state==='undefined'||root.AllStarSentenceWorkspace)return;
  const SOURCE_NAMES={documented_coaching:'Documented Coaching',checklist:'Checklist',qa:'Call monitors / QA'};
  const uid=()=> 'sq_'+Math.random().toString(36).slice(2)+Date.now().toString(36);
  const copy=Q.copy,html=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const metrics=()=>state.metrics.filter(m=>m.dataCategory==='datedStats'&&m.output!=='summary');
  const label=x=>SOURCE_NAMES[x]||state.metrics.find(m=>m.id===x)?.name||x;
  const catalog=()=>Object.fromEntries(Object.keys(SOURCE_NAMES).map(s=>[s,getHeaders(s).filter(h=>!h.startsWith('_'))]));
  const group=()=>({id:uid(),kind:'group',mode:'all',children:[]});
  const field=source=>({id:uid(),kind:'field',field:catalog()[source]?.find(h=>/description/i.test(h))||catalog()[source]?.[0]||'',op:'contains',value:''});
  const event=()=>({id:uid(),kind:'event',source:'documented_coaching',op:'gte',value:1,where:group()});
  const num=x=>x==null?'—':Number(x).toLocaleString(undefined,{maximumFractionDigits:2});
  function readSources(statSource,required=Object.keys(SOURCE_NAMES)){
    const out={};
    for(const source of required){
      const rows=getRowsRaw(source),headers=getHeaders(source);if(!rows.length&&!headers.length)continue;
      const cfg=getSourceSetting(activeModelForImport(),source)?.columns||{};
      const dateField=cfg.date||cfg.interactionDate||findHeader(headers,['Coaching Date','Date','Incident Date','Interaction Start Time','Created Date','Completed Date']);
      const idField=findHeader(headers,['Coaching ID','Session ID','Evaluation ID','Event ID','Record ID','ID']);
      const byRep=new Map();let invalidRows=0;
      rows.forEach((r,index)=>{
        const name=r._rep||r[cfg.rep]||r['Associate Name']||r['Associate name']||r['Agent Name']||'';
        const resolved=r._repKey?{id:r._repKey}:datedStatsIdentity(name,statSource);
        const raw=r[dateField]??r._date,ms=E.day(raw),parsed=Number.isFinite(ms)?ms:E.day(parseDateOnly(raw));
        if(!resolved.id||!Number.isFinite(parsed)){invalidRows++;return;}
        const date=E.iso(parsed),fields=Object.fromEntries(headers.map(h=>[h,r[h]]));
        // A real source event ID wins. Without one, only exact duplicate records
        // are collapsed; similar sessions are never guessed to be identical.
        const identity=r[idField]!==undefined&&String(r[idField]).trim()!==''?String(r[idField]):JSON.stringify([date,Object.keys(fields).sort().map(h=>[h,fields[h]])]);
        if(!byRep.has(resolved.id))byRep.set(resolved.id,[]);
        byRep.get(resolved.id).push({id:source+'|'+resolved.id+'|'+identity,date,row:index+1,fields});
      });
      out[source]={byRep,invalidRows};
    }
    return out;
  }
  Q.installResearch(E,{catalog,sources:readSources,metric:id=>state.metrics.find(m=>m.id===id),label});
  const oldNormalize=normalizeResearchItem,oldOpen=openDatedStatsResearchEditor,oldRender=renderDatedStatsResult,oldResearchOpen=openResearchItemEditor;
  normalizeResearchItem=function(raw){
    const result=oldNormalize(raw),saved=state.researchItems?.find(i=>i.id===raw?.id);
    const sentence=raw?.datedStats?.sentenceQuery||saved?.datedStats?.sentenceQuery;
    if(sentence)result.datedStats={...(result.datedStats||{}),sentenceQuery:copy(sentence)};
    return result;
  };
  function evidence(result){
    const data=result.sentenceEvidence;if(!data)return '';
    const reason=v=>v.kind==='group'?v.children.map(reason).filter(Boolean).join(' · '):v.reason;
    const leaves=v=>v.kind==='group'?v.children.flatMap(leaves):[v];
    return `<section class="sq-evidence"><h3>Why these people?</h3><p>Sentence-condition checks: <strong>${data.counts.included} matched</strong> · ${data.counts.excluded} did not match · ${data.counts.unknown} unknown. These checks precede existing scope rules and metric-data exclusions. The chart uses the final eligible group.</p><p>Showing ${data.examples.length} of ${data.totalChecks} person/window checks. Missing coaching coverage is not zero sessions.</p>${Object.values(data.invalidRows||{}).some(n=>n)?'<p class="sq-warning">Some event rows have invalid dates or unresolved identities. Zero and exact counts cannot be confirmed for those sources.</p>':''}<div class="sq-scroll"><table><thead><tr><th>Representative</th><th>Qualifying window</th><th>Condition result</th><th>Evidence</th></tr></thead><tbody>${data.examples.map(x=>`<tr><td>${html(x.rep)}</td><td>${html(x.window.start)} → ${html(x.window.end)}</td><td>${x.verdict.value===true?'Matched':x.verdict.value===false?'Did not match':'Unknown'}</td><td><details><summary>${html(reason(x.verdict)||'No additional conditions')}</summary>${leaves(x.verdict).map(v=>v.kind==='stat'?`<p>${html(v.metric)}: ${num(v.result)} ${html(v.unit||'')}</p>`:`<p>${html(label(v.source))}: ${v.observed} distinct matching session(s). ${v.covered?'Coverage reviewed.':'Coverage incomplete or not reviewed.'}</p>${[...(v.evidence||[]).map(r=>({...r,match:true})),...(v.nonmatches||[]).map(r=>({...r,match:false}))].map(r=>`<details><summary>${r.match?'Matching':'Non-matching'} loaded row ${r.row} · ${html(r.date)}</summary><dl>${Object.entries(r.fields).map(([k,val])=>`<dt>${html(k)}</dt><dd>${html(val??'Missing')}</dd>`).join('')}</dl></details>`).join('')}`).join('')}</details></td></tr>`).join('')}</tbody></table></div></section>`;
  }
  renderDatedStatsResult=function(item,result){
    const question=item?.datedStats?.sentenceQuery;if(!question)return oldRender(item,result);
    if(question.view==='table')return `<section><h3>${html(item.title)}</h3><p>${html(result.description)}</p><p>${result.data.length} calculated points. Showing up to 250 below; the saved result retains all points.</p><div class="sq-scroll"><table><thead><tr><th>Group</th><th>Period</th><th>Value</th><th>Eligible representatives</th><th>Missing / excluded</th></tr></thead><tbody>${result.data.slice(0,250).map(p=>`<tr><td>${html(p.line)}</td><td>${html(p.label)}</td><td>${num(p.value)} ${html(p.unit||'')}</td><td>${p.eligibleRepresentatives??'—'}</td><td>${p.missingRepresentatives??'—'}</td></tr>`).join('')}</tbody></table></div></section>`+evidence(result);
    return oldRender(item,result)+evidence(result);
  };
  function markIds(n){n.id=n.id||uid();if(n.children)n.children.forEach(markIds);if(n.where)markIds(n.where);}
  function walk(n,id){if(n.id===id)return n;for(const c of [...(n.children||[]),...(n.where?[n.where]:[])]){const hit=walk(c,id);if(hit)return hit;}return null;}
  function remove(n,id){if(n.children)n.children=n.children.filter(c=>c.id!==id);for(const c of [...(n.children||[]),...(n.where?[n.where]:[])])remove(c,id);}
  function input(title,key,value='',type='text'){return `<label>${html(title)}<input data-sq-value="${key}" type="${type}" ${type==='number'?'step="any"':''} value="${html(value)}"></label>`;}
  function select(title,key,options,value){return `<label>${html(title)}<select data-sq-value="${key}">${options.map(o=>{const [v,l]=Array.isArray(o)?o:[o,o];return `<option value="${html(v)}" ${String(v)===String(value)?'selected':''}>${html(l)}</option>`;}).join('')}</select></label>`;}
  function values(host){return Object.fromEntries([...host.querySelectorAll('[data-sq-value]')].map(n=>[n.dataset.sqValue,n.type==='checkbox'?n.checked:n.value]));}
  function starterMetric(){
    const d=document.createElement('dialog');d.className='sq-dialog';
    d.innerHTML='<h2>Choose your first statistic</h2><p>This creates a reusable stat without changing existing Models or Research. Import and categorize its source before calculating a preview.</p><form class="sq-form">'+select('Source','source',[['weeklyRetail','Weekly Retail'],['weeklyReferral','Weekly Referral']],'weeklyRetail')+select('Statistic','statistic',[], '')+select('Combining people','aggregation',[['equal_rep','Each representative counts equally'],['combined_rate','Each opportunity counts equally']],'equal_rep')+'<div><button type="submit">Create stat and build question</button><button type="button" data-close>Cancel</button></div></form><p role="status"></p>';
    const refresh=()=>{const source=d.querySelector('[data-sq-value="source"]').value;d.querySelector('[data-sq-value="statistic"]').innerHTML=E.standardMetrics(source).map(m=>`<option value="${html(m.id)}">${html(m.name)}</option>`).join('');};
    d.querySelector('[data-sq-value="source"]').onchange=refresh;refresh();
    d.querySelector('[data-close]').onclick=()=>d.close();d.addEventListener('close',()=>d.remove());
    d.querySelector('form').onsubmit=async e=>{e.preventDefault();const previous=state.metrics;try{const v=values(d),def=E.standardMetrics(v.source).find(m=>m.id===v.statistic);if(!def)throw new Error('Choose a statistic.');const m=E.normalizeMetric({id:uid(),name:def.name,source:v.source,statistic:def.id,aggregation:v.aggregation});state.metrics=[...previous,m];if(!await saveMetrics())throw new Error('The metric could not be saved.');renderMetricList();d.close();open();}catch(error){state.metrics=previous;d.querySelector('[role="status"]').textContent=error.message;}};
    document.body.appendChild(d);d.showModal();
  }
  function open(itemId){
    const saved=state.researchItems.find(i=>i.id===itemId),ms=metrics();
    if(!ms.length){starterMetric();return;}
    const draftKey='allstar.sentence.draft.v1.'+(itemId||'new');let remembered=null;
    try{remembered=JSON.parse(localStorage.getItem(draftKey)||'null');}catch(_){}
    let item=copy(saved||{id:uid(),title:'Weekly performance question',source:ms[0].source,outputType:'line',cardSize:'full',valueMode:'datedStats',groupField:'Date',secondaryGroupField:'Coach',columns:[{field:'@'+ms[0].name,mode:'datedStats'}],datedStats:{version:1,metricId:ms[0].id,mode:'fixed',groupBy:'representative',eventConditions:[],statConditions:[],coverage:{},buckets:[0,1,2,3,4]}});
    if(!item.datedStats.sentenceQuery)item.datedStats.sentenceQuery={version:1,view:'line',root:group()};
    markIds(item.datedStats.sentenceQuery.root);
    const m=state.metrics.find(x=>x.id===item.datedStats.metricId),pack=state.categorized.stats?.sources?.[m?.source];
    if(!saved&&pack?.observations?.length){const periods=[...new Map(pack.observations.map(o=>[o.period.key,o.period])).values()].filter(p=>p.end<new Date().toISOString().slice(0,10)).sort((a,b)=>a.start.localeCompare(b.start)).slice(-6);if(periods.length)Object.assign(item.datedStats,{startDate:periods[0].start,endDate:periods.at(-1).end,anchorStart:periods[0].start,anchorEnd:periods.at(-1).end});}
    const previousFocus=document.activeElement,dialog=document.createElement('dialog');dialog.className='sq-dialog';
    dialog.innerHTML=`<header><div><small>ALL-STAR · SENTENCE RESEARCH</small><h2>Build your question</h2></div><button type="button" data-sq-close aria-label="Close sentence builder">Close</button></header><p>Click a phrase to change it. Use <strong>+</strong> beside a value to add modifiers. Existing Models, Metrics and Research remain unchanged.</p>${remembered?'<button type="button" data-sq-restore>Restore your unsaved draft</button>':''}<div data-sq-sentence></div><section data-sq-edit hidden aria-label="Edit selected sentence phrase"></section><div class="sq-actions"><button type="button" data-sq-preview>Update preview</button><label><input type="checkbox" data-sq-auto> Auto-refresh preview</label><button type="button" data-sq-save>Save question and result</button><button type="button" data-sq-advanced>Open saved version in existing editor</button></div><p data-sq-status role="status" aria-live="polite">Ready to preview. Uses loaded data, never invented sample values.</p><section class="sq-preview" data-sq-preview-result><h3>Preview</h3><p>Your chart or table will appear here, followed by sample people and the source rows explaining their results.</p></section>`;
    document.body.appendChild(dialog);dialog.showModal();
    const sentence=dialog.querySelector('[data-sq-sentence]'),editor=dialog.querySelector('[data-sq-edit]'),status=dialog.querySelector('[data-sq-status]'),out=dialog.querySelector('[data-sq-preview-result]');
    let revision=0,result=null,resultKey='',timer=null,running=0,saving=false;
    // View state never enters the question definition or its calculation signature.
    let sectionOpen={show:true,people:false,when:false};
    try{sectionOpen={...sectionOpen,...JSON.parse(localStorage.getItem('allstar.sentence.view.v1')||'{}')};}catch(_){}
    const metric=()=>state.metrics.find(x=>x.id===item.datedStats.metricId);
    const s=()=>item.datedStats,q=()=>s().sentenceQuery;
    const token=(key,title)=>`<button type="button" class="sq-token" data-sq-edit="${html(key)}">${html(title)} <span aria-hidden="true">▾</span></button>`;
    const plus=(id,source='')=>`<button type="button" class="sq-plus" data-sq-add="${html(id)}" data-sq-source="${html(source)}" aria-label="Add ${source?'same-row modifier':'condition'}">+</button>`;
    function tree(n,rowSource='',parentId=''){
      if(n.kind==='group')return `<div class="sq-group ${rowSource?'sq-same-row':''}"><p class="sq-muted">${rowSource?html(label(rowSource))+' — Same source row':n===q().root?'People included in this question':'Separate requirements for the same person'}</p><div>${token(n.id,n.mode==='all'?'All of these':n.mode==='any'?'Any of these':'Not this condition')}${n.mode==='not'&&n.children.length?'':plus(n.id,rowSource)}${n!==q().root?`<button type="button" class="sq-remove" data-sq-remove="${html(n.id)}" aria-label="Remove condition group">×</button>`:''}</div>${n.children.map(c=>tree(c,rowSource,n.id)).join('')||'<span class="sq-muted">No extra conditions yet.</span>'}</div>`;
      if(n.kind==='event')return `<div class="sq-clause">who have ${token(n.id,`${Q.countLabels[n.op]} ${n.value} matching ${label(n.source)} sessions`)}${plus(n.where.id,n.source)}<button type="button" class="sq-remove" data-sq-remove="${html(n.id)}" aria-label="Remove event requirement">×</button><p class="sq-muted">${n.startDate?html(n.startDate+' → '+n.endDate):'During the qualifying window'} · modifiers below must match the SAME ROW before sessions are counted.</p>${tree(n.where,n.source)}</div>`;
      return `<div class="sq-clause">${token(n.id,Q.describe(n,label))}${plus(parentId||q().root.id,rowSource)}<button type="button" class="sq-remove" data-sq-remove="${html(n.id)}" aria-label="Remove modifier">×</button></div>`;
    }
    function draw(){
      sentence.querySelectorAll('[data-sq-section]').forEach(n=>sectionOpen[n.dataset.sqSection]=n.open);
      const people=s().selectedRepIds?.length?s().selectedRepIds.length+' selected representatives':s().coachNames?.length?'representatives under '+s().coachNames.length+' selected coaches':s().managerNames?.length?'representatives under selected managers':s().orgIds?.length?'representatives in selected organizations':'all loaded representatives';
      const dates=(s().startDate||'choose start')+' → '+(s().endDate||'choose end');
      const part=(key,title,summary,body)=>`<details class="sq-question-section" data-sq-section="${key}" ${sectionOpen[key]?'open':''}><summary><strong>${title}</strong><span class="sq-muted">${html(summary)}</span></summary>${body}</details>`;
      sentence.innerHTML=`<button type="button" data-sq-all>Show all question settings</button>${part('show','Show',(q().view==='table'?'Table':'Line graph')+' · '+(metric()?.name||'Choose a statistic'),`<div class="sq-sentence">Show ${token('view',q().view==='table'?'a table':'a line graph')} of ${token('metric',metric()?.name||'choose a statistic')}.<div class="sq-muted">People included in this question ${plus(q().root.id)}</div></div><p class="sq-muted">${html(metric()?.formulaLabel||metric()?.field||metric()?.name||'')} · ${html(metric()?.aggregation||'')}</p>`)}${part('people','For',people+' · '+s().groupBy,`<div class="sq-subline">For ${token('people',people)}, ${token('group','broken down by '+(s().groupBy==='all'?'one combined group':s().groupBy))}.</div><p class="sq-muted">${s().groupBy==='manager'||s().groupBy==='organization'?'Manager/organization selection may use current saved membership; assigned coach comes from historical observations.':''}</p>`)}${part('when','When',dates+' · '+q().root.children.length+' population requirements',`<div class="sq-subline">Measure during ${token('dates',dates)}. ${token('membership',s().mode==='changing'?'Check who qualifies each reporting period':'Follow the same qualifying people')}. Qualifying window: ${token('anchor',(s().anchorStart||'choose start')+' → '+(s().anchorEnd||'choose end'))}.</div>${tree(q().root)}${token('coverage','Review event coverage')}<p class="sq-muted">Actual reporting periods from the reviewed source calendar.</p>`)}${token('name',item.title)} ${token('standard','Create a standard stat')}`;
      sentence.querySelectorAll('[data-sq-section]').forEach(n=>n.addEventListener('toggle',()=>{sectionOpen[n.dataset.sqSection]=n.open;try{localStorage.setItem('allstar.sentence.view.v1',JSON.stringify(sectionOpen));}catch(_){}}));
      sentence.querySelector('[data-sq-all]').onclick=()=>sentence.querySelectorAll('[data-sq-section]').forEach(n=>n.open=true);
    }
    function changed(){revision++;result=null;clearTimeout(timer);draw();editor.hidden=true;status.textContent='Question changed. Previous preview is out of date.';out.classList.add('sq-stale');try{localStorage.setItem(draftKey,JSON.stringify(item));}catch(_){status.textContent+=' Draft could not be stored.';}if(dialog.querySelector('[data-sq-auto]').checked)timer=setTimeout(()=>preview().catch(showError),700);}
    function showError(e){if(dialog.isConnected)status.textContent=e.message||String(e);}
    function form(title,body,apply){
      editor.hidden=false;editor.innerHTML=`<h3>${html(title)}</h3><form class="sq-form">${body}<div><button type="submit">Apply to sentence</button><button type="button" data-sq-dismiss>Cancel</button></div></form>`;
      editor.querySelector('form').onsubmit=async e=>{e.preventDefault();try{await apply(values(editor));changed();}catch(error){showError(error);}};
      editor.querySelector('[data-sq-dismiss]').onclick=()=>{editor.hidden=true;};editor.querySelector('input,select,button')?.focus();
    }
    function add(parentId,source){
      sentence.querySelector('[data-sq-section="when"]').open=true;
      const parent=walk(q().root,parentId);if(!parent)return;
      const choices=source?[['field','A condition on another field in THIS SAME ROW'],['all','A same-row ALL group'],['any','A same-row ANY group']]:[['event','A separate event / coaching requirement'],['stat','A numerical statistic requirement'],['all','An ALL condition group'],['any','An ANY condition group']];
      form(source?'Add a same-row modifier':'Add to the question',select('What would you like to add?','kind',choices,choices[0][0]),v=>{
        const n=['all','any'].includes(v.kind)?{...group(),mode:v.kind}:v.kind==='field'?field(source):v.kind==='event'?event():{id:uid(),kind:'stat',metricId:metric().id,operator:'gte',threshold:0,mode:'aggregate'};
        parent.children.push(n);
        if(n.kind!=='group')setTimeout(()=>edit(n.id),0);
      });
    }
    function edit(key){
      if(key==='view')return form('Choose the result',select('Show','view',[['line','Line graph — reporting dates'],['table','Table — group and reporting date']],q().view),v=>q().view=v.view);
      if(key==='metric')return form('Choose a saved statistic',select('Statistic','metricId',metrics().map(m=>[m.id,m.name+' · '+m.source]),s().metricId),v=>{s().metricId=v.metricId;item.source=metric().source;item.columns=[{field:'@'+metric().name,mode:'datedStats'}];});
      if(key==='name')return form('Name this question',input('Title','title',item.title),v=>{if(!v.title.trim())throw new Error('Enter a title.');item.title=v.title;});
      if(key==='group')return form('What does each line or table group represent?',select('One result per','groupBy',[['all','All included representatives combined'],['representative','Representative'],['coach','Assigned coach'],['manager','Manager'],['organization','Organization']],s().groupBy),v=>s().groupBy=v.groupBy);
      if(key==='membership')return form('Who qualifies over time?',select('Membership','mode',[['fixed','Follow the same qualifying people'],['changing','Check who qualifies each reporting period']],s().mode),v=>s().mode=v.mode);
      if(key==='dates'||key==='anchor'){
        const a=key==='dates'?'startDate':'anchorStart',b=key==='dates'?'endDate':'anchorEnd';
        return form(key==='dates'?'When is performance measured?':'When do people qualify?',input('From','start',s()[a]||'','date')+input('Through','end',s()[b]||'','date')+'<p>Only complete reporting periods are measured. Event dates and performance dates may differ.</p>',v=>{if(!Number.isFinite(E.day(v.start))||!Number.isFinite(E.day(v.end))||v.start>v.end)throw new Error('Choose valid dates in order.');s()[a]=v.start;s()[b]=v.end;});
      }
      if(key==='people'){
        const observations=state.categorized.stats?.sources?.[metric().source]?.observations||[],directory=root.CoachToolsStatsDirectory?.grouped()||[];
        const sections=[['selectedRepIds','Representatives',[...new Map(observations.map(o=>[o.repId,o.rep])).entries()]],['coachNames','Coaches',[...new Set(observations.map(o=>o.coach).filter(Boolean))].sort().map(x=>[x,x])],['managerNames','Managers',directory.map(g=>[g.name,g.name])],['orgIds','Organizations',(state.orgs||[]).map(o=>[o.id,o.name])]];
        form('Select people; blank selections include everyone',sections.map(([key,title,entries])=>`<fieldset><legend>${title}</legend><input type="search" data-sq-search placeholder="Search ${title.toLowerCase()}"><div class="sq-picker">${entries.map(([value,title])=>`<label><input type="checkbox" data-sq-multi="${key}" value="${html(value)}" ${(s()[key]||[]).includes(value)?'checked':''}>${html(title)}</label>`).join('')}</div></fieldset>`).join('')+'<p>Selections within a section are combined. Different sections narrow each other. Managers use the saved manager-to-coach directory.</p>',()=>{for(const [key] of sections)s()[key]=[...editor.querySelectorAll(`[data-sq-multi="${key}"]:checked`)].map(x=>x.value);});
        editor.querySelectorAll('[data-sq-search]').forEach(input=>input.oninput=()=>input.nextElementSibling.querySelectorAll('label').forEach(l=>l.hidden=!l.textContent.toLowerCase().includes(input.value.toLowerCase())));return;
      }
      if(key==='coverage')return form('Confirm completeness only when you know the source is complete',Object.entries(SOURCE_NAMES).map(([source,title])=>{const c=s().coverage?.[source]||{};return `<fieldset><legend>${title}</legend>${input('Coverage from',source+'_start',c.start||'','date')}${input('Coverage through',source+'_end',c.end||'','date')}<label><input type="checkbox" data-sq-value="${source}_complete" ${c.complete?'checked':''}> All selected representatives and events are covered for these dates</label></fieldset>`;}).join('')+'<p>Exact and zero-session counts require complete coverage. Invalid dates or unresolved identities prevent completeness from being assumed.</p>',v=>{s().coverage=s().coverage||{};for(const source of Object.keys(SOURCE_NAMES)){if(v[source+'_complete']&&(!Number.isFinite(E.day(v[source+'_start']))||!Number.isFinite(E.day(v[source+'_end']))||v[source+'_start']>v[source+'_end']))throw new Error('Choose valid coverage dates.');s().coverage[source]={start:v[source+'_start'],end:v[source+'_end'],complete:v[source+'_complete']};}});
      if(key==='standard'){
        const source=metric().source;
        return form('Create a reusable standard statistic',select('Statistic','statistic',E.standardMetrics(source).map(m=>[m.id,m.name]),E.standardMetrics(source)[0]?.id)+select('Combining people','aggregation',[['equal_rep','Each representative counts equally'],['combined_rate','Each opportunity counts equally']], 'equal_rep'),async v=>{const def=E.standardMetrics(source).find(m=>m.id===v.statistic);const m=E.normalizeMetric({id:uid(),name:def.name,source,statistic:def.id,aggregation:v.aggregation});const previous=state.metrics;state.metrics=[...previous,m];try{if(!await saveMetrics())throw new Error('The new metric could not be saved.');}catch(e){state.metrics=previous;throw e;}s().metricId=m.id;item.columns=[{field:'@'+m.name,mode:'datedStats'}];renderMetricList();});
      }
      const n=walk(q().root,key);if(!n)return;
      if(n.kind==='group')return form('How should these conditions combine?',select('Match','mode',[['all','All of these conditions'],['any','At least one condition'],...(n.children.length===1?[['not','Not this condition']]:[])],n.mode),v=>n.mode=v.mode);
      if(n.kind==='event')return form('A separate event requirement',select('Event source','source',Object.entries(SOURCE_NAMES),n.source)+select('Distinct matching sessions','op',[['gte','At least'],['gt','More than'],['eq','Exactly'],['lte','At most'],['lt','Fewer than'],['neq','Not exactly']],n.op)+input('Number of sessions','value',n.value,'number')+`<details><summary>Use a separate event window</summary>${input('From','startDate',n.startDate||'','date')}${input('Through','endDate',n.endDate||'','date')}</details>`,v=>{if(n.source!==v.source&&n.where.children.length)throw new Error('Remove the existing same-row modifiers before changing their source.');Object.assign(n,v);});
      if(n.kind==='field'){
        const findSource=(p,source)=>p===n?source:p.children?.map(c=>findSource(c,source)).find(Boolean)||p.where&&findSource(p.where,p.source);
        const source=findSource(q().root,'');
        return form('This modifier applies to the SAME physical source row',select('Source field','field',catalog()[source]||[],n.field)+select('Comparison','op',Q.OPS.map(op=>[op,Q.labels[op]]),n.op)+input('Value (YYYY-MM-DD for dates; empty for blank tests)','value',n.value),v=>Object.assign(n,v));
      }
      if(n.kind==='stat')return form('A numerical condition',select('Saved statistic','metricId',metrics().filter(m=>m.source===metric().source).map(m=>[m.id,m.name]),n.metricId)+select('Comparison','operator',[['gte','At least'],['gt','Above'],['lte','At most'],['lt','Below'],['eq','Equals']],n.operator)+input('Threshold','threshold',n.threshold,'number')+`<details><summary>Trend, qualifying periods, and separate dates</summary>${select('Apply to','mode',[['aggregate','Selected-period result'],['qualifying_periods','Each reporting period'],['trend','Trend summary']],n.mode||'aggregate')}${select('Trend summary','summary',[['change','Change'],['average','Average'],['latest','Latest'],['slope','Slope']],n.summary||'change')}${input('Required qualifying periods','requiredPeriods',n.requiredPeriods||1,'number')}${input('Minimum valid periods','minPeriods',n.minPeriods||1,'number')}${input('From','startDate',n.startDate||'','date')}${input('Through','endDate',n.endDate||'','date')}</details>`,v=>Object.assign(n,v));
    }
    function checked(){
      if(!metric())throw new Error('Choose an available metric.');Q.validate(q().root,catalog());
      if(!s().startDate||!s().endDate)throw new Error('Choose the performance reporting dates.');
      item.source=metric().source;item.outputType=q().view;return normalizeResearchItem(copy(item));
    }
    function signature(){return JSON.stringify([item,state.metrics,state.sourceMeta,state.orgs,root.CoachToolsStatsDirectory?.snapshot().revision]);}
    async function preview(){
      const next=checked(),key=signature(),current=++running,version=revision;status.textContent='Calculating with your loaded data…';
      const calculated=await evaluateDatedStatsResearch(next,{token:{get cancelled(){return current!==running||version!==revision||!dialog.isConnected;}}});
      if(current!==running||version!==revision||!dialog.isConnected||key!==signature()){if(dialog.isConnected)status.textContent='Data or settings changed. Update the preview again.';return false;}
      result=calculated;resultKey=key;out.innerHTML=renderDatedStatsResult(next,result);out.classList.remove('sq-stale');bindDatedStatsCharts(out);status.textContent=`${result.data.length} calculated points. Evidence examples below use real loaded rows.`;return true;
    }
    sentence.onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.sqEdit)edit(b.dataset.sqEdit);else if(b.dataset.sqAdd)add(b.dataset.sqAdd,b.dataset.sqSource);else if(b.dataset.sqRemove){remove(q().root,b.dataset.sqRemove);changed();}};
    dialog.querySelector('[data-sq-preview]').onclick=()=>preview().catch(showError);
    dialog.querySelector('[data-sq-auto]').onchange=e=>{if(e.target.checked)preview().catch(showError);};
    dialog.querySelector('[data-sq-save]').onclick=async()=>{
      if(saving)return;saving=true;const controls=[...dialog.querySelectorAll('button,input,select')].map(n=>[n,n.disabled]);controls.forEach(([n])=>n.disabled=true);
      try{
        if(!result||resultKey!==signature())if(!await preview())return;
        const next=checked(),previous=state.researchItems;state.researchItems=[...previous.filter(i=>i.id!==next.id),next];
        try{const saved=await saveResearchItems();if(saved===false)throw new Error('Could not save the Research definition.');}catch(e){state.researchItems=previous;throw e;}
        if(!await researchSaveRenderedResult(next,result))throw new Error('Question saved, but its calculated result could not be stored. Retry Save.');
        try{localStorage.removeItem(draftKey);}catch(_){}status.textContent='Question and calculated result saved.';await renderResearchCanvasAsync({reason:'Sentence research saved'});
      }catch(e){showError(e);}finally{saving=false;if(dialog.isConnected)controls.forEach(([n,was])=>n.disabled=was);}
    };
    dialog.querySelector('[data-sq-advanced]').onclick=()=>{
      const existing=state.researchItems.find(i=>i.id===item.id);if(!existing){status.textContent='Save the question first. The existing editor opens the saved version; your unsaved draft stays here.';return;}
      const id=existing.id;dialog.close();oldOpen(id);const modal=[...document.querySelectorAll('.ds-dialog')].at(-1);if(modal){const p=document.createElement('p');p.className='sq-warning';p.textContent='Preserved sentence conditions remain active: '+Q.describe(existing.datedStats.sentenceQuery.root,label);modal.prepend(p);}
    };
    dialog.querySelector('[data-sq-restore]')?.addEventListener('click',()=>{if(remembered?.datedStats?.sentenceQuery?.version!==1){status.textContent='This draft version is not supported.';return;}item=copy(remembered);markIds(q().root);changed();});
    dialog.querySelector('[data-sq-close]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{running++;clearTimeout(timer);dialog.remove();previousFocus?.focus();});draw();
  }
  openDatedStatsResearchEditor=function(id){if(state.researchItems.find(i=>i.id===id)?.datedStats?.sentenceQuery)return open(id);return oldOpen(id);};
  openResearchItemEditor=function(id){if(state.researchItems.find(i=>i.id===id)?.datedStats?.sentenceQuery)return open(id);return oldResearchOpen(id);};
  const button=document.createElement('button');button.type='button';button.id='allstarSentenceBuilder';button.className='toolbarBtn';button.textContent='Build a question +';button.onclick=()=>open();
  document.querySelector('.toolbar')?.insertBefore(button,document.getElementById('researchBtn'));
  const style=document.createElement('style');style.textContent=`.sq-dialog{width:min(1120px,94vw);max-height:92vh;border:1px solid #d8dce3;border-radius:18px;padding:26px;color:#202631;background:#f7f8fb;box-shadow:0 20px 70px #15203040;font:15px/1.55 system-ui,sans-serif}.sq-dialog::backdrop{background:#11182788}.sq-dialog header{display:flex;justify-content:space-between;align-items:center}.sq-dialog h2{margin:4px 0;font-size:26px}.sq-dialog small{letter-spacing:.1em;color:#9c2030}.sq-dialog button{cursor:pointer}.sq-dialog button:focus-visible,.sq-dialog input:focus-visible,.sq-dialog select:focus-visible{outline:3px solid #2868b5;outline-offset:3px}.sq-sentence{font-size:21px;line-height:2.4;background:#fff;border:1px solid #e3e5eb;padding:22px;border-radius:14px}.sq-token{display:inline-block;border:1px solid #d5dbea;border-radius:9px;background:#edf1f9;color:#223657;padding:6px 11px;font:inherit;line-height:1.4}.sq-token{max-width:100%;white-space:normal;overflow-wrap:anywhere}.sq-token span{font-size:12px}.sq-plus{margin:0 5px;border:1px dashed #b92035;border-radius:50%;background:#fff4f5;color:#ad1730;font-size:21px;line-height:1;width:30px;height:30px}.sq-group{border-left:3px solid #c6cfdf;margin:14px 0 12px 8px;padding:10px 14px;background:#fff;border-radius:0 10px 10px 0}.sq-same-row{border-left-color:#a12b40;background:#fff8f8}.sq-clause{padding:10px 0}.sq-muted{color:#596474;font-size:13px}.sq-subline{margin:15px 0;line-height:2.2}.sq-remove{background:transparent;border:0;font-size:22px;color:#7b3846;margin-left:8px}.sq-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:15px}.sq-form label{display:flex;flex-direction:column;gap:5px}.sq-form input,.sq-form select{padding:9px;border:1px solid #cbd2de;border-radius:7px;background:#fff;font:inherit;min-width:0}.sq-form input[type=checkbox]{width:auto}.sq-form fieldset,.sq-form details{border:1px solid #d8dce3;border-radius:10px;padding:14px}.sq-form div:last-child,.sq-form p{grid-column:1/-1}.sq-dialog [data-sq-edit][aria-label]{padding:18px;background:#eaf0f8;border-radius:12px;margin:18px 0}.sq-actions{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin:22px 0}.sq-actions button{padding:10px 16px;border-radius:8px;border:1px solid #cbd2de}.sq-actions [data-sq-save]{background:#a62237;color:white}.sq-preview{padding:20px;border:1px solid #d8dce3;border-radius:14px;background:#fff}.sq-stale{opacity:.6}.sq-scroll{overflow:auto;max-height:520px}.sq-evidence{margin-top:22px}.sq-dialog table,.sq-evidence table{width:100%;border-collapse:collapse;font-size:13px}.sq-dialog td,.sq-dialog th,.sq-evidence td,.sq-evidence th{padding:10px;text-align:left;border-bottom:1px solid #e3e7ed;vertical-align:top}.sq-dialog th,.sq-evidence th{position:sticky;top:0;background:#f0f3f8}.sq-evidence dl{display:grid;grid-template-columns:minmax(100px,1fr) 2fr;gap:5px;max-width:650px}.sq-evidence dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.sq-warning{padding:12px;border-left:4px solid #b37b14;background:#fff6de}.sq-picker{max-height:190px;overflow:auto}.sq-picker label{display:block;padding:4px}.sq-picker [hidden]{display:none}@media(max-width:650px){.sq-dialog{padding:14px}.sq-sentence{font-size:17px}.sq-form{grid-template-columns:1fr}.sq-group{margin-left:2px;padding-left:9px}.sq-actions{align-items:stretch;flex-direction:column}}`;
  document.head.appendChild(style);root.AllStarSentenceWorkspace={open,readSources,catalog};
})(window);
