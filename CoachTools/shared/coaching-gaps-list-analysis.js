(function installCoachingGapsListTags(root) {
  'use strict';

  if ((document.querySelector('meta[name="coachtools-id"]')?.content || '') !== 'coaching-gaps') return;

  const KEY = 'coachtools.coaching-gaps.list-analysis-tags.v1';
  const SOURCE_LABEL = { coaching:'Documented coaching', checklist:'Checklist items', both:'Coaching + checklist' };
  const required = ['runListPushAnalysis','paintListPushResults','normalizeListPushChecklistRow','coachingsForRepDateWindow','checklistCorrectivesForRepDateWindow'];
  let installed = false;

  const clean = v => String(v == null ? '' : v).trim().replace(/\s+/g,' ');
  const tagKey = v => clean(v).toLowerCase();
  const unique = arr => {
    const out=[], seen=new Set();
    for (const raw of Array.isArray(arr) ? arr : []) {
      const value=clean(raw), key=tagKey(value);
      if (!value || seen.has(key)) continue;
      seen.add(key); out.push(value);
    }
    return out;
  };
  const esc = v => clean(v).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  function loadState(){
    const fallback={ source:'both', coaching:[], checklist:[], corrective:[] };
    try{
      const raw=JSON.parse(localStorage.getItem(KEY)||'null');
      if (!raw || typeof raw!=='object') return fallback;
      return {
        source:['coaching','checklist','both'].includes(raw.source) ? raw.source : 'both',
        coaching:unique(raw.coaching), checklist:unique(raw.checklist), corrective:unique(raw.corrective)
      };
    }catch(_){ return fallback; }
  }
  let state=loadState();
  function save(){ try{ localStorage.setItem(KEY, JSON.stringify(state)); }catch(_){} }
  function includesSource(kind){ return state.source==='both' || state.source===kind; }

  function normalizeKey(key){ return String(key||'').toLowerCase().replace(/[^a-z0-9]/g,''); }
  function pick(row, names){
    const map=new Map(Object.keys(row||{}).map(k=>[normalizeKey(k),k]));
    for(const name of names){ const real=map.get(normalizeKey(name)); if(real!==undefined) return row[real]; }
  }
  function parseDate(value){
    if(value instanceof Date && !isNaN(value)) return new Date(value.getTime());
    if(typeof root.parseDate==='function'){
      const d=root.parseDate(value); if(d instanceof Date && !isNaN(d)) return d;
    }
    const d=new Date(value); return isNaN(d)?null:d;
  }
  function personKey(value){
    if(typeof root.personKey==='function') return root.personKey(value);
    return tagKey(value).replace(/[^a-z0-9]+/g,' ').trim();
  }
  function weekKey(date){ return typeof root.isoWeekKey==='function' ? root.isoWeekKey(date) : ''; }
  function correctiveType(row){
    const raw=Object.values(row||{}).map(clean).join(' | ');
    if(/\bfinal\b/i.test(raw)) return 'Final';
    if(/\bwritten\b/i.test(raw)) return 'Written';
    if(/\bverbal\b/i.test(raw)) return 'Verbal';
    return clean(pick(row,['corrective type','corrective action','corrective','discipline level']));
  }
  function normalizeGeneralChecklist(row){
    if(!row || typeof row!=='object') return null;
    if(row._listPushNormalizedChecklist) return row;
    const rep=clean(row.rep || pick(row,['associate name','associate','representative name','representative','rep name','rep','agent name','agent','csr name','csr','ssr name','ssr','employee name','employee','name','title']));
    const date=parseDate(row.date || pick(row,['incident date','date','day','created on','created date','created','date served','served date']));
    const incident=clean(row.incident || pick(row,['incident','incident type','incident category','checklist item','item','type','category'])) || 'Unspecified checklist item';
    if(!rep || !date) return null;
    return {
      ...row, rep, repKey:personKey(rep), date, wk:weekKey(date), incident,
      desc:clean(row.desc || pick(row,['description','details','notes','note','summary','comments','comment'])),
      coach:clean(row.coach || pick(row,['job coach','coach','coach name','manager','supervisor','team lead','leader','team','sheet','csr team/coach'])),
      correctiveType:correctiveType(row), _listPushNormalizedChecklist:true
    };
  }

  function matches(values, tags){
    if(!tags.length) return true;
    const wanted=new Set(tags.map(tagKey));
    return (Array.isArray(values)?values:[values]).some(v=>wanted.has(tagKey(v)));
  }
  function coachingPasses(row){ return matches(row?.types||[], state.coaching); }
  function checklistPasses(row){ return matches(row?.incident||'',state.checklist) && matches(row?.correctiveType||'',state.corrective); }

  function addStyles(){
    if(document.getElementById('cg-list-tag-style')) return;
    const style=document.createElement('style'); style.id='cg-list-tag-style';
    style.textContent=`
      .cgListTagPanel{margin-top:10px;padding:11px;border:1px solid #dfe7f1;border-radius:14px;background:#f8fbff;display:grid;gap:10px}
      .cgListTagHead{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.cgListTagTitle{font-size:12px;font-weight:1000}
      .cgListSource{display:inline-flex;gap:3px;padding:3px;border:1px solid #dbe3ee;border-radius:10px;background:#edf2f7}
      .cgListSource button{border:0;background:transparent;color:#475569;padding:7px 10px;border-radius:8px;font-size:12px;font-weight:900;cursor:pointer}
      .cgListSource button.active{background:#fff;color:var(--accent);box-shadow:0 1px 6px rgba(15,23,42,.08)}
      .cgListTagGroups{display:grid;grid-template-columns:repeat(3,minmax(205px,1fr));gap:8px}.cgListTagGroup{border:1px solid #e2e8f0;border-radius:11px;background:#fff;padding:9px}.cgListTagGroup.off{opacity:.45}
      .cgListTagGroup h5{margin:0 0 6px;color:var(--muted);font-size:10px;font-weight:950;letter-spacing:.05em;text-transform:uppercase}
      .cgListTagPick{display:flex;gap:6px}.cgListTagPick select{min-width:0;flex:1;height:34px;padding:5px 8px;border-radius:9px}.cgListTagPick button{height:34px;border:1px solid #dbe3ee;border-radius:9px;background:#fff;padding:0 10px;font-weight:900;cursor:pointer}
      .cgListTagChips{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px;min-height:24px}.cgListTagChip{border:1px solid rgba(37,99,235,.25);border-radius:999px;background:rgba(37,99,235,.08);color:#1e3a8a;padding:5px 8px;font-size:11px;font-weight:900;cursor:pointer}.cgListTagChip.check{border-color:rgba(245,158,11,.3);background:rgba(245,158,11,.1);color:#92400e}.cgListTagChip.corr{border-color:rgba(220,38,38,.24);background:rgba(220,38,38,.08);color:#991b1b}.cgListTagEmpty{font-size:10.5px;color:var(--muted);font-weight:800}
      .cgListTagFoot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;color:var(--muted);font-size:10.5px;font-weight:800}.cgListTagFoot button{margin-left:auto;border:1px solid #dbe3ee;border-radius:999px;background:#fff;padding:6px 9px;font-size:11px;font-weight:900;cursor:pointer}
      @media(max-width:900px){.cgListTagGroups{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function sourceOptions(select){
    return Array.from(select?.options||[]).map(o=>({value:clean(o.value),label:clean(o.textContent)})).filter(o=>o.value);
  }
  function fillPicker(id, sourceId, placeholder){
    const picker=document.getElementById(id), source=document.getElementById(sourceId); if(!picker||!source) return;
    const current=picker.value, opts=sourceOptions(source);
    picker.innerHTML=`<option value="">${esc(placeholder)}</option>`+opts.map(o=>`<option value="${esc(o.value)}">${esc(o.label||o.value)}</option>`).join('');
    if(opts.some(o=>o.value===current)) picker.value=current;
  }
  function refreshPickers(){
    fillPicker('cgListCoachingPick','listPushCoachingTypeSel','Choose coaching type…');
    fillPicker('cgListChecklistPick','listPushIncidentSel','Choose checklist item…');
    fillPicker('cgListCorrectivePick','listPushCorrectiveTypeSel','Choose corrective type…');
  }
  function arrFor(kind){ return state[kind] || []; }
  function pickerFor(kind){ return document.getElementById(kind==='coaching'?'cgListCoachingPick':kind==='checklist'?'cgListChecklistPick':'cgListCorrectivePick'); }
  function changeTag(kind, removeValue){
    if(removeValue){ const k=tagKey(removeValue); state[kind]=arrFor(kind).filter(v=>tagKey(v)!==k); }
    else{
      const picker=pickerFor(kind), value=clean(picker?.value); if(!value) return;
      if(!arrFor(kind).some(v=>tagKey(v)===tagKey(value))) state[kind].push(value);
      picker.value='';
    }
    save(); paint(); rerun();
  }
  function renderChips(kind,id,empty,cls){
    const el=document.getElementById(id), tags=arrFor(kind); if(!el) return;
    el.innerHTML=tags.length ? tags.map(t=>`<button type="button" class="cgListTagChip ${cls||''}" data-cg-remove="${kind}" data-value="${esc(t)}">${esc(t)} ×</button>`).join('') : `<span class="cgListTagEmpty">${esc(empty)}</span>`;
    el.querySelectorAll('[data-cg-remove]').forEach(btn=>btn.addEventListener('click',()=>changeTag(kind,btn.getAttribute('data-value')||'')));
  }
  function paint(){
    document.querySelectorAll('[data-cg-source]').forEach(b=>b.classList.toggle('active',b.dataset.cgSource===state.source));
    document.getElementById('cgListCoachingGroup')?.classList.toggle('off',!includesSource('coaching'));
    document.getElementById('cgListChecklistGroup')?.classList.toggle('off',!includesSource('checklist'));
    document.getElementById('cgListCorrectiveGroup')?.classList.toggle('off',!includesSource('checklist'));
    renderChips('coaching','cgListCoachingChips','All coaching types','');
    renderChips('checklist','cgListChecklistChips','All checklist items','check');
    renderChips('corrective','cgListCorrectiveChips','Any corrective status','corr');
  }
  function rerun(){
    if(!document.getElementById('listAnalysisPushPanel')?.classList.contains('active')) return;
    try{ root.runListPushAnalysis(); }catch(_){}
  }

  function buildPanel(){
    const panelRoot=document.getElementById('listAnalysisPushPanel');
    const coaching=document.getElementById('listPushCoachingTypeSel'), corrective=document.getElementById('listPushCorrectiveTypeSel'), incident=document.getElementById('listPushIncidentSel');
    if(!panelRoot||!coaching||!corrective||!incident) return false;
    if(document.getElementById('cgListTagPanel')) return true;
    [coaching,corrective,incident].forEach(s=>{ const label=s.closest('label.topControl'); if(label) label.style.display='none'; });
    const panel=document.createElement('div'); panel.id='cgListTagPanel'; panel.className='cgListTagPanel';
    panel.innerHTML=`
      <div class="cgListTagHead"><div class="cgListTagTitle">Count items from</div><div class="cgListSource">
        <button type="button" data-cg-source="coaching">Documented coaching</button><button type="button" data-cg-source="checklist">Checklist items</button><button type="button" data-cg-source="both">Both</button>
      </div></div>
      <div class="cgListTagGroups">
        <div class="cgListTagGroup" id="cgListCoachingGroup"><h5>Coaching type tags</h5><div class="cgListTagPick"><select id="cgListCoachingPick"></select><button type="button" data-cg-add="coaching">+ Add</button></div><div class="cgListTagChips" id="cgListCoachingChips"></div></div>
        <div class="cgListTagGroup" id="cgListChecklistGroup"><h5>Checklist item tags</h5><div class="cgListTagPick"><select id="cgListChecklistPick"></select><button type="button" data-cg-add="checklist">+ Add</button></div><div class="cgListTagChips" id="cgListChecklistChips"></div></div>
        <div class="cgListTagGroup" id="cgListCorrectiveGroup"><h5>Corrective tags (optional)</h5><div class="cgListTagPick"><select id="cgListCorrectivePick"></select><button type="button" data-cg-add="corrective">+ Add</button></div><div class="cgListTagChips" id="cgListCorrectiveChips"></div></div>
      </div>
      <div class="cgListTagFoot"><span>Tags in the same group match any selected tag. Checklist and corrective tags combine when both are used.</span><button type="button" id="cgListTagClear">Clear all tags</button></div>`;
    (coaching.closest('.row')||panelRoot.firstElementChild)?.insertAdjacentElement('afterend',panel);
    panel.querySelectorAll('[data-cg-source]').forEach(b=>b.addEventListener('click',()=>{ state.source=b.dataset.cgSource||'both'; save(); paint(); rerun(); }));
    panel.querySelectorAll('[data-cg-add]').forEach(b=>b.addEventListener('click',()=>changeTag(b.dataset.cgAdd||'')));
    panel.querySelectorAll('select').forEach(s=>s.addEventListener('keydown',e=>{ if(e.key!=='Enter') return; e.preventDefault(); const kind=s.id.includes('Coaching')?'coaching':s.id.includes('Checklist')?'checklist':'corrective'; changeTag(kind); }));
    document.getElementById('cgListTagClear')?.addEventListener('click',()=>{ state.coaching=[];state.checklist=[];state.corrective=[];save();paint();rerun(); });
    refreshPickers(); paint(); return true;
  }

  function replaceListText(){
    const card=document.getElementById('listAnalysisCard'); if(!card) return;
    const walker=document.createTreeWalker(card,NodeFilter.SHOW_TEXT), nodes=[]; while(walker.nextNode()) nodes.push(walker.currentNode);
    for(const node of nodes){
      const before=node.nodeValue||'';
      const after=before.replace(/Checklist corrective file/g,'Checklist file').replace(/checklist correctives/gi,'checklist items').replace(/Corrective count buckets/gi,'Checklist item count buckets').replace(/# Correctives/g,'# Checklist Items').replace(/Coachings \/ Correctives/g,'Coaching / Checklist').replace(/With corrective/gi,'With checklist item').replace(/No Corrective/gi,'No Checklist Item').replace(/Correctives/g,'Checklist Items').replace(/correctives/g,'checklist items');
      if(after!==before) node.nodeValue=after;
    }
    const sub=document.getElementById('listAnalysisSub');
    if(sub && document.getElementById('listAnalysisPushPanel')?.classList.contains('active')) sub.textContent='Time Range Push groups pasted names by selected documented-coaching and checklist-item tags, then averages the selected performance measures.';
    const note=document.querySelector('#listAnalysisPushPanel .listMetricBox .modalSub');
    if(note) note.textContent=`Paste names, choose a date range, then add or remove tags for the activity you want counted. Current count source: ${SOURCE_LABEL[state.source]||SOURCE_LABEL.both}. Category view groups people by item counts; coach view compares coaches to the pasted-list baseline.`;
  }
  function updateHint(){
    const hint=document.getElementById('listAnalysisHint'); if(!hint) return;
    let text=clean(hint.textContent).replace(/ • Coaching type: all/gi,'').replace(/ • Corrective type: all/gi,'').replace(/ • Incident: all/gi,'');
    const tags=(label,arr,none)=>`${label}: ${arr.length?arr.join(', '):none}`;
    hint.textContent=`${text} • Source: ${SOURCE_LABEL[state.source]||SOURCE_LABEL.both} • ${tags('Coaching tags',state.coaching,'all')} • ${tags('Checklist tags',state.checklist,'all')} • ${tags('Corrective tags',state.corrective,'any')}`;
    replaceListText();
  }
  function tuneSummary(){
    const cards=Array.from(document.querySelectorAll('#listPushSummaryCards .listPushSummaryCard'));
    const pair=cards.find(c=>/Coaching\s*\/\s*Checklist|Coachings\s*\/\s*Checklist/i.test(c.querySelector('.k')?.textContent||''));
    if(!pair) return;
    const nums=clean(pair.querySelector('.v')?.textContent).split('/').map(v=>Number(v.replace(/[^0-9.-]/g,''))||0);
    const k=pair.querySelector('.k'),v=pair.querySelector('.v'); if(k) k.textContent='Items counted'; if(!v) return;
    if(state.source==='coaching') v.textContent=`${nums[0].toLocaleString()} coaching`;
    else if(state.source==='checklist') v.textContent=`${nums[1].toLocaleString()} checklist`;
    else v.textContent=`${(nums[0]+nums[1]).toLocaleString()} total (${nums[0].toLocaleString()} + ${nums[1].toLocaleString()})`;
  }

  function patch(){
    const normalizer=root.normalizeListPushChecklistRow;
    root.normalizeListPushChecklistRow=function(row){ return row?._listPushNormalizedChecklist ? row : (normalizer.apply(this,arguments) || normalizeGeneralChecklist(row)); };

    const coaches=root.coachingsForRepDateWindow;
    root.coachingsForRepDateWindow=function(rep,start,end){ if(!includesSource('coaching')) return []; return coaches.call(this,rep,start,end,'').filter(coachingPasses); };

    const checks=root.checklistCorrectivesForRepDateWindow;
    root.checklistCorrectivesForRepDateWindow=function(rep,start,end){ if(!includesSource('checklist')) return []; return checks.call(this,rep,start,end,'','').filter(checklistPasses); };

    ['renderListPushCoachingTypeOptions','renderListPushCorrectiveTypeOptions','renderListPushIncidentOptions'].forEach(name=>{
      if(typeof root[name]!=='function') return; const original=root[name];
      root[name]=function(){ const result=original.apply(this,arguments); refreshPickers(); paint(); return result; };
    });

    const paintResults=root.paintListPushResults;
    root.paintListPushResults=function(){ const result=paintResults.apply(this,arguments); replaceListText(); tuneSummary(); return result; };

    const run=root.runListPushAnalysis;
    root.runListPushAnalysis=function(){
      ['listPushCoachingTypeSel','listPushCorrectiveTypeSel','listPushIncidentSel'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
      const result=run.apply(this,arguments); replaceListText(); tuneSummary(); updateHint(); return result;
    };
  }

  function install(){
    if(installed) return true;
    if(!required.every(name=>typeof root[name]==='function') || !document.getElementById('listAnalysisPushPanel')) return false;
    addStyles(); if(!buildPanel()) return false; patch(); refreshPickers(); paint(); replaceListText(); installed=true; return true;
  }
  let tries=0;
  function tryInstall(){ if(install()) return; if(++tries<100) root.setTimeout(tryInstall,100); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',tryInstall,{once:true}); else tryInstall();
})(window);
