/* Representative List Tester, coaching checks, details, CSV, and PDF output.
 * Behavior-preserving extraction from the definitive All-Star application.
 */
'use strict';

function listTesterCompactName(value){ return fullNameIdentityKey(value).replace(/[^a-z0-9]/g,''); }
function listTesterNameTokens(value){ return fullNameIdentityKey(value).split(/\s+/).filter(Boolean); }
function listTesterLevenshtein(a,b){
  a=String(a||''); b=String(b||''); if(a===b) return 0; if(!a.length) return b.length; if(!b.length) return a.length;
  let prev=Array.from({length:b.length+1},(_,i)=>i), cur=new Array(b.length+1);
  for(let i=1;i<=a.length;i++){ cur[0]=i; for(let j=1;j<=b.length;j++) cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1)); [prev,cur]=[cur,prev]; }
  return prev[b.length];
}
function listTesterCandidateScore(query,entry){
  const qKey=fullNameIdentityKey(query), eKey=entry.key; if(!qKey||!eKey) return 0; if(qKey===eKey) return 1;
  const qLegacy=legacyFirstLastNameKey(query), eLegacy=legacyFirstLastNameKey(entry.name); if(qLegacy&&qLegacy===eLegacy&&qLegacy.includes(' ')) return .975;
  const qCompact=listTesterCompactName(query), eCompact=entry.compact; if(qCompact&&qCompact===eCompact) return .965;
  const qTokens=listTesterNameTokens(query), eTokens=entry.tokens, qSet=new Set(qTokens), eSet=new Set(eTokens), inter=[...qSet].filter(x=>eSet.has(x)).length, union=new Set([...qSet,...eSet]).size;
  const tokenScore=union?inter/union:0, maxLen=Math.max(qCompact.length,eCompact.length)||1, levScore=1-(listTesterLevenshtein(qCompact,eCompact)/maxLen);
  const sameLast=qTokens.length&&eTokens.length&&qTokens[qTokens.length-1]===eTokens[eTokens.length-1], sameFirstInitial=qTokens[0]?.[0]&&qTokens[0][0]===eTokens[0]?.[0];
  let score=Math.max(levScore,tokenScore*.96); if(sameLast&&sameFirstInitial) score=Math.max(score,.82+(.12*tokenScore));
  return Math.max(0,Math.min(1,score));
}
function buildListTesterIndex(){
  const byKey=new Map(), aliasToCanonical=new Map();
  const add=(name,coach,source='Imported data')=>{
    const display=cleanName(name), key=fullNameIdentityKey(display); if(!key) return;
    let entry=byKey.get(key); if(!entry){ entry={key,name:display||titleCase(key),teams:new Map(),sources:new Set(),compact:listTesterCompactName(display||key),tokens:listTesterNameTokens(display||key)}; byKey.set(key,entry); }
    if(display && (!entry.name || display.length>entry.name.length)) entry.name=display;
    const team=canonicalCoachName(coach); if(team) entry.teams.set(coachNameKey(team),team);
    if(source) entry.sources.add(source);
  };
  const teamIndex=currentTeamIndex();
  (teamIndex.reps||[]).forEach(r=>add(r.name,r.team,'Associate index'));
  controlRosterRows().forEach(r=>add(r._rep||r.displayName||r.representative,rowTeam(r)||r._team,'Control roster'));
  (state.repTeams||new Map()).forEach((coach,key)=>{ const existing=byKey.get(key); add(existing?.name||titleCase(key),coach,'Representative-to-coach map'); });
  (state.repAliases||new Map()).forEach(rec=>{ const alias=rec?.aliasName||rec?.alias||'', canonical=rec?.canonical||''; const aliasKey=fullNameIdentityKey(alias), canonicalKey=fullNameIdentityKey(canonical); if(aliasKey&&canonicalKey) aliasToCanonical.set(aliasKey,canonicalKey); });
  const entries=[...byKey.values()].map(entry=>({...entry,coaches:[...entry.teams.values()].sort((a,b)=>a.localeCompare(b)),sources:[...entry.sources].sort()})).sort((a,b)=>a.name.localeCompare(b.name));
  return {entries,byKey:new Map(entries.map(x=>[x.key,x])),aliasToCanonical};
}
function matchListTesterName(input,index){
  const inputKey=fullNameIdentityKey(input); if(!inputKey) return {input,status:'unmatched',accepted:false,score:0,matchType:'No name'};
  let entry=index.byKey.get(inputKey), matchType='Exact name';
  if(!entry){ const canonicalKey=index.aliasToCanonical.get(inputKey); if(canonicalKey){ entry=index.byKey.get(canonicalKey); matchType='Saved alias'; } }
  if(entry) return {input,entry,status:entry.coaches.length>1?'conflict':'matched',accepted:true,score:1,matchType};
  const ranked=index.entries.map(candidate=>({candidate,score:listTesterCandidateScore(input,candidate)})).sort((a,b)=>b.score-a.score), best=ranked[0], second=ranked[1];
  if(best && best.score>=.88 && (!second || best.score-second.score>=.04)) return {input,entry:best.candidate,status:best.candidate.coaches.length>1?'conflict':'matched',accepted:true,score:best.score,matchType:'Close name match'};
  if(best && best.score>=.76) return {input,entry:best.candidate,status:'possible',accepted:false,score:best.score,matchType:'Possible match'};
  return {input,status:'unmatched',accepted:false,score:best?.score||0,entry:best?.score>=.58?best.candidate:null,matchType:'No confident match'};
}
function listTesterCoachCounts(results){
  const counts=new Map();
  (results||[]).filter(r=>r.accepted).forEach(r=>(r.entry?.coaches||[]).forEach(coach=>{
    if(!coach||coachNameKey(coach)===coachNameKey(NA_TEAM)) return;
    const key=coachNameKey(coach), rec=counts.get(key)||{coach,count:0,coachingCount:0,withCoachings:0,withoutCoachings:0};
    const coachingCount=Math.max(0,Number(r.itemCount)||0);
    rec.count++;
    rec.coachingCount+=coachingCount;
    if(coachingCount>0) rec.withCoachings++; else rec.withoutCoachings++;
    counts.set(key,rec);
  }));
  return [...counts.values()].map(rec=>({...rec,averageCoachings:rec.count?rec.coachingCount/rec.count:0})).sort((a,b)=>a.coach.localeCompare(b.coach));
}
function listTesterCheckEnabled(){ return !!els.listTesterCheckEnabled?.checked; }
function listTesterCheckSourceChoices(){
  const preferred=['checklist','documented_coaching','comp_calls'], seen=new Set(), out=[];
  [...preferred,...allSourceKeys()].forEach(source=>{
    if(!source || seen.has(source) || TEAM_TOTAL_SOURCE_KEYS.includes(source)) return;
    const headers=getHeaders(source)||[], rows=getRowsRaw(source)||[];
    if(!headers.length && !rows.length && !preferred.includes(source)) return;
    seen.add(source); out.push({source,label:labelSource(source)||source,rows:rows.length});
  });
  return out;
}
function listTesterHeaderOptionLabel(source,header){ return `${labelSource(source)||source}.${plainHeaderName(header)}`; }
function listTesterPresetCandidates(preset){
  if(preset==='corrective_incident') return ['Corrective Incident','Corrective incident','Incident','Incident Description','Corrective','Corrective Description','Corrective Column','Result','Status'];
  return ['Checklist Description','Checklist description','Checklist.description','Description','Checklist','Item Description','Question Description'];
}
function listTesterLikelyDateHeaders(source,headers){
  const preferred=[sourceDateHeader(source,headers),...checklistLikeDefaultDateHeaders(source),'Interaction Start Time','Assigned Date','Date','Created Date','Completed Date'].filter(Boolean);
  const ordered=[]; preferred.forEach(h=>{ const actual=findHeader(headers,[h]); if(actual&&!ordered.includes(actual)) ordered.push(actual); });
  headers.filter(h=>headerLooksLikeDateColumn(h)).forEach(h=>{ if(!ordered.includes(h)) ordered.push(h); });
  headers.forEach(h=>{ if(!ordered.includes(h)) ordered.push(h); });
  return ordered;
}
function populateListTesterCheckSources(options={}){
  if(!els.listTesterCheckSource) return;
  const keep=options.keepSource ?? true, previous=keep?els.listTesterCheckSource.value:'';
  const choices=listTesterCheckSourceChoices();
  els.listTesterCheckSource.innerHTML=choices.map(x=>`<option value="${esc(x.source)}">${esc(x.label)} (${x.rows.toLocaleString()} rows)</option>`).join('')||'<option value="checklist">Checklist (0 rows)</option>';
  if(previous && choices.some(x=>x.source===previous)) els.listTesterCheckSource.value=previous;
  else if(choices.some(x=>x.source==='checklist')) els.listTesterCheckSource.value='checklist';
  populateListTesterCheckHeaders(options);
}
function populateListTesterCheckHeaders(options={}){
  const source=els.listTesterCheckSource?.value||'checklist', headers=getHeaders(source)||[], preset=els.listTesterCheckPreset?.value||'checklist_description';
  const oldHeader=options.keepHeader!==false?els.listTesterCheckHeader?.value:'', oldDate=options.keepDate!==false?els.listTesterCheckDateHeader?.value:'';
  if(els.listTesterCheckHeader){
    els.listTesterCheckHeader.innerHTML=headers.map(h=>`<option value="${esc(h)}">${esc(listTesterHeaderOptionLabel(source,h))}</option>`).join('')||'<option value="">No headers imported</option>';
    const preferred=preset==='manual'?'':findHeader(headers,listTesterPresetCandidates(preset));
    if(oldHeader&&headers.includes(oldHeader)) els.listTesterCheckHeader.value=oldHeader; else if(preferred) els.listTesterCheckHeader.value=preferred;
  }
  if(els.listTesterCheckDateHeader){
    const ordered=listTesterLikelyDateHeaders(source,headers);
    els.listTesterCheckDateHeader.innerHTML='<option value="">No date filter</option>'+ordered.map(h=>`<option value="${esc(h)}">${esc(listTesterHeaderOptionLabel(source,h))}</option>`).join('');
    const defaultDate=sourceDateHeader(source,headers)||findHeader(headers,checklistLikeDefaultDateHeaders(source));
    if(oldDate&&headers.includes(oldDate)) els.listTesterCheckDateHeader.value=oldDate; else if(defaultDate) els.listTesterCheckDateHeader.value=defaultDate;
  }
  updateListTesterCheckMeta();
}
function applyListTesterCheckPreset(){
  const preset=els.listTesterCheckPreset?.value||'manual';
  if(preset!=='manual' && els.listTesterCheckSource){
    const hasChecklist=[...els.listTesterCheckSource.options].some(o=>o.value==='checklist');
    if(hasChecklist) els.listTesterCheckSource.value='checklist';
  }
  populateListTesterCheckHeaders({keepHeader:false,keepDate:true});
}
function updateListTesterCheckMeta(){
  if(els.listTesterCheckPanel) els.listTesterCheckPanel.classList.toggle('hidden',!listTesterCheckEnabled());
  if(!els.listTesterCheckMeta) return;
  const source=els.listTesterCheckSource?.value||'', header=els.listTesterCheckHeader?.value||'', dateHeader=els.listTesterCheckDateHeader?.value||'', rows=(getRowsRaw(source)||[]).length, phrases=parseMultiPhraseValueInput(els.listTesterCheckContains?.value||'');
  els.listTesterCheckMeta.innerHTML=`<strong>${esc(source?labelSource(source)||source:'No source')}</strong> · ${rows.toLocaleString()} stored rows · Search <strong>${esc(header||'no header')}</strong> · ${phrases.length.toLocaleString()} phrase${phrases.length===1?'':'s'} · Date: <strong>${esc(dateHeader||'not filtered')}</strong>`;
}
function listTesterCheckConfig(){
  const source=els.listTesterCheckSource?.value||'', header=els.listTesterCheckHeader?.value||'', dateHeader=els.listTesterCheckDateHeader?.value||'', startDate=els.listTesterCheckStartDate?.value||'', endDate=els.listTesterCheckEndDate?.value||'', phrases=parseMultiPhraseValueInput(els.listTesterCheckContains?.value||'');
  return {enabled:listTesterCheckEnabled(),preset:els.listTesterCheckPreset?.value||'manual',source,header,dateHeader,startDate,endDate,phrases};
}
function listTesterResultIdentityKeys(result){
  const names=[result?.entry?.name,result?.input].filter(Boolean), out=new Set();
  names.forEach(name=>{ const full=fullNameIdentityKey(name), legacy=legacyFirstLastNameKey(name), compact=listTesterCompactName(name); if(full) out.add('f:'+full); if(legacy) out.add('l:'+legacy); if(compact) out.add('c:'+compact); });
  return out;
}
function listTesterRowIdentityKeys(row,source){
  const names=[researchRowRepName(row,source),row?._rep,row?.Representative,row?.['Agent Name'],row?.['Associate Name'],row?.['Associate name'],row?.Name].filter(Boolean), out=new Set();
  names.forEach(name=>{ const full=fullNameIdentityKey(name), legacy=legacyFirstLastNameKey(name), compact=listTesterCompactName(name); if(full) out.add('f:'+full); if(legacy) out.add('l:'+legacy); if(compact) out.add('c:'+compact); });
  return out;
}
function listTesterCellText(value){
  if(value===null||value===undefined) return '';
  if(value instanceof Date && !isNaN(value)) return value.toLocaleString();
  if(typeof value==='object'){ try{return JSON.stringify(value,null,2);}catch(_){ return String(value); } }
  return String(value);
}
function listTesterMatchSnapshot(row,config,header,rowIndex){
  const headers=(getHeaders(config.source)||[]).length?(getHeaders(config.source)||[]):Object.keys(row||{}).filter(h=>!String(h).startsWith('_'));
  const cells=headers.map(h=>({header:h,value:listTesterCellText(row?.[h])})).filter(cell=>cell.value.trim()!=='');
  const dateRaw=(config.dateHeader?row?.[config.dateHeader]:'')||row?._date||'';
  const dateObj=parseDate(dateRaw), dateValue=dateObj&&!isNaN(dateObj)?dateObj.getTime():0;
  return {source:config.source,sourceLabel:labelSource(config.source)||config.source,rowIndex:Number(rowIndex)||0,rowId:row?._rowId||'',representative:researchRowRepName(row,config.source)||row?._rep||'',dateHeader:config.dateHeader||'',dateRaw:listTesterCellText(dateRaw),dateValue,matchHeader:header,matchValue:listTesterCellText(row?.[header]),cells};
}
function sortListTesterMatches(matches){ return (matches||[]).slice().sort((a,b)=>(Number(b.dateValue)||0)-(Number(a.dateValue)||0)||Number(b.rowIndex||0)-Number(a.rowIndex||0)); }
async function applyListTesterCheck(results,config){
  results.forEach(r=>{ r.itemCount=null; r.itemStatus=''; r.itemSource=''; r.itemHeader=''; r.itemPhrases=[]; r.itemMatches=[]; });
  if(!config.enabled){ state.listTesterCheckConfig=null; return; }
  if(!config.source || !(getRowsRaw(config.source)||[]).length) throw new Error('The selected Check Item source has no stored rows.');
  const headers=getHeaders(config.source)||[];
  const header=resolveColumn(config.source,config.header);
  if(!header || !headers.includes(header)) throw new Error('Choose a valid header to search for the Check Item.');
  if(!config.phrases.length) throw new Error('Enter at least one Contains phrase. Use "phrase one", "phrase two" for multiple phrases.');
  if((config.startDate||config.endDate) && !config.dateHeader) throw new Error('Choose the date column used for the selected date range.');
  const start=config.startDate?parseDateOnly(config.startDate):null, end=config.endDate?parseDateOnly(config.endDate):null;
  if(start&&end&&start>end) throw new Error('The Check Item start date must be on or before the end date.');
  updateProgress('Filtering stored Check Item rows...',36,{force:true}); await yieldToBrowser();
  const rows=(getRowsRaw(config.source)||[]).map((row,sourceIndex)=>({row,sourceIndex})).filter(rec=>(!start&&!end)||inRange((config.dateHeader?rec.row?.[config.dateHeader]:'')||rec.row?._date,start,end));
  const keyToResult=new Map(), entryKeyToResult=new Map();
  results.forEach((r,i)=>{ if(!r.accepted) return; listTesterResultIdentityKeys(r).forEach(k=>{ if(!keyToResult.has(k)) keyToResult.set(k,i); }); if(r.entry?.key) entryKeyToResult.set(r.entry.key,i); r.itemCount=0; r.itemStatus='none'; r.itemSource=config.source; r.itemHeader=header; r.itemPhrases=config.phrases.slice(); r.itemMatches=[]; });
  const rowNameCache=new Map(); let lastYield=performance.now();
  for(let i=0;i<rows.length;i++){
    const rowRecord=rows[i], row=rowRecord.row, rawText=String(row?.[header]??'');
    if(textMatchesAnyPhrase(rawText,config.phrases)){
      let resultIndex=-1;
      for(const key of listTesterRowIdentityKeys(row,config.source)){ if(keyToResult.has(key)){ resultIndex=keyToResult.get(key); break; } }
      if(resultIndex<0){
        const rowName=researchRowRepName(row,config.source), cacheKey=fullNameIdentityKey(rowName);
        if(cacheKey){
          if(rowNameCache.has(cacheKey)) resultIndex=rowNameCache.get(cacheKey);
          else{
            const matched=state.listTesterIndex?matchListTesterName(rowName,state.listTesterIndex):null;
            resultIndex=matched?.accepted&&matched.entry?.key&&entryKeyToResult.has(matched.entry.key)?entryKeyToResult.get(matched.entry.key):-1;
            rowNameCache.set(cacheKey,resultIndex);
          }
        }
      }
      if(resultIndex>=0){
        const result=results[resultIndex];
        result.itemCount++;
        result.itemMatches.push(listTesterMatchSnapshot(row,config,header,rowRecord.sourceIndex+1));
      }
    }
    if(performance.now()-lastYield>10 || i===rows.length-1){
      updateProgress(`Scanning stored items... ${(i+1).toLocaleString()} / ${rows.length.toLocaleString()}`,40+54*((i+1)/Math.max(1,rows.length)));
      await yieldToBrowser(); lastYield=performance.now();
    }
  }
  results.forEach(r=>{ if(r.accepted){ r.itemMatches=sortListTesterMatches(r.itemMatches); r.itemCount=r.itemMatches.length; r.itemStatus=r.itemCount>0?'found':'none'; } });
  state.listTesterCheckConfig={...config,header,rowCount:rows.length};
}
function renderListTesterResults(){
  const results=state.listTesterResults||[], coaches=listTesterCoachCounts(results), matched=results.filter(r=>r.accepted).length, possible=results.filter(r=>r.status==='possible').length, unmatched=results.filter(r=>r.status==='unmatched').length, conflicts=results.filter(r=>r.status==='conflict').length, checkActive=!!state.listTesterCheckConfig?.enabled||results.some(r=>r.itemCount!==null&&r.itemCount!==undefined), withItems=results.filter(r=>r.accepted&&Number(r.itemCount)>0).length, withoutItems=results.filter(r=>r.accepted&&Number(r.itemCount)===0).length;
  if(els.listTesterSummary) els.listTesterSummary.innerHTML=results.length?`<span class="badge">${results.length.toLocaleString()} pasted</span><span class="badge good">${matched.toLocaleString()} matched</span><span class="badge">${coaches.length.toLocaleString()} unique coaches</span>${checkActive?`<span class="badge good">${withItems.toLocaleString()} with items</span><span class="badge bad">${withoutItems.toLocaleString()} with none</span>`:''}${possible?`<span class="badge warn">${possible.toLocaleString()} possible</span>`:''}${unmatched?`<span class="badge bad">${unmatched.toLocaleString()} unmatched</span>`:''}${conflicts?`<span class="badge warn">${conflicts.toLocaleString()} coach conflicts</span>`:''}`:'<span class="badge">Paste names and press Test List.</span>';
  if(els.listTesterUniqueCoaches) els.listTesterUniqueCoaches.innerHTML=coaches.length?coaches.map(x=>`<span class="listTesterCoachChip">${esc(x.coach)} <small>${x.count}</small></span>`).join(''):'<span class="hint">No confirmed coaches pulled yet.</span>';
  if(!els.listTesterResults) return;
  if(!results.length){ els.listTesterResults.innerHTML='<div class="researchEmpty">No list has been tested yet.</div>'; return; }
  const rows=results.map((r,i)=>{
    const statusLabel=r.status==='matched'?'Matched':r.status==='conflict'?'Coach conflict':r.status==='possible'?'Possible match':'Not matched', statusClass=(r.status==='matched'?'good':r.status==='unmatched'?'bad':'warn'), coaches=(r.entry?.coaches||[]).join(' / ')||'—', matchedName=r.entry?.name||'—', confidence=r.score?`${Math.round(r.score*100)}%`:'—';
    const itemCount=Number(r.itemCount||0), itemStatus=r.itemCount===null||r.itemCount===undefined?'—':(itemCount>0?'Found':'None'), rowClass=r.accepted&&r.itemCount!==null&&r.itemCount!==undefined?(itemCount>0?'listTesterItemGood':'listTesterItemBad'):'';
    const inputCell=`<button class="listTesterNameLink" type="button" data-list-tester-detail="${i}">${esc(r.input)}</button>`;
    const matchCell=`<button class="listTesterNameLink" type="button" data-list-tester-detail="${i}">${esc(matchedName)}</button>`;
    return `<tr class="${rowClass}"><td class="right">${i+1}</td><td>${inputCell}</td><td>${matchCell}</td><td>${esc(coaches)}</td>${checkActive?`<td class="right"><span class="listTesterItemCount">${r.itemCount===null||r.itemCount===undefined?'—':itemCount.toLocaleString()}</span></td><td><span class="listTesterStatus ${itemCount>0?'good':r.accepted?'bad':'warn'}">${esc(itemStatus)}</span></td>`:''}<td><span class="listTesterStatus ${statusClass}">${esc(statusLabel)}</span><br><small>${esc(r.matchType||'')}</small></td><td class="right">${confidence}</td></tr>`;
  }).join('');
  els.listTesterResults.innerHTML=`<table><thead><tr><th>#</th><th>Pasted Name</th><th>Matched Associate</th><th>Team / Coach</th>${checkActive?'<th>Items</th><th>Check</th>':''}<th>Name Match</th><th>Confidence</th></tr></thead><tbody>${rows}</tbody></table>`;
  els.listTesterResults.querySelectorAll('[data-list-tester-detail]').forEach(button=>button.onclick=()=>openListTesterDetail(Number(button.dataset.listTesterDetail)));
}
async function runListTester(){
  const names=parseListTesterNames(els.listTesterInput?.value||'',!!els.listTesterCommaSeparated?.checked);
  if(!names.length){ state.listTesterResults=[]; renderListTesterResults(); return alert('Paste at least one representative name.'); }
  showProgress('Building representative and coach lookup...',3);
  try{
    await yieldToBrowser();
    const index=buildListTesterIndex(); if(!index.entries.length){ state.listTesterResults=[]; renderListTesterResults(); return alert('No associate-to-coach data is currently available. Import associate data or a Control roster first.'); }
    state.listTesterIndex=index; state.listTesterResults=[];
    let lastYield=performance.now();
    for(let i=0;i<names.length;i++){
      state.listTesterResults.push(matchListTesterName(names[i],index));
      if(performance.now()-lastYield>10 || i===names.length-1){ updateProgress(`Matching names... ${(i+1).toLocaleString()} / ${names.length.toLocaleString()}`,8+25*((i+1)/Math.max(1,names.length))); await yieldToBrowser(); lastYield=performance.now(); }
    }
    await applyListTesterCheck(state.listTesterResults,listTesterCheckConfig());
    updateProgress('Rendering List Tester results...',98,{force:true}); await yieldToBrowser();
    renderListTesterResults(); updateProgress('List Tester complete',100,{force:true}); await yieldToBrowser();
  }catch(err){ console.error(err); alert(err?.message||'List Tester failed. Check the console for details.'); }
  finally{ hideProgress(); }
}
function clearListTester(){ if(els.listTesterInput) els.listTesterInput.value=''; if(els.listTesterCommaSeparated) els.listTesterCommaSeparated.checked=false; state.listTesterResults=[]; state.listTesterIndex=null; state.listTesterCheckConfig=null; closeModal('listTesterDetailModal'); renderListTesterResults(); }
async function copyListTesterCoaches(){
  const coaches=listTesterCoachCounts(state.listTesterResults||[]).map(x=>x.coach); if(!coaches.length) return alert('No confirmed coaches are available to copy.');
  const value=coaches.join('\n');
  try{ await navigator.clipboard.writeText(value); alert(`Copied ${coaches.length} unique coach${coaches.length===1?'':'es'}.`); }
  catch(_){ const ta=document.createElement('textarea'); ta.value=value; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); alert(`Copied ${coaches.length} unique coach${coaches.length===1?'':'es'}.`); }
}
function listTesterFormatDate(match){
  if(match?.dateValue){ const d=new Date(Number(match.dateValue)); if(!isNaN(d)) return d.toLocaleString(); }
  return match?.dateRaw||'No date available';
}
function listTesterDetailRecordHtml(match,index,{pdf=false}={}){
  const cells=(match?.cells||[]).map(cell=>`<tr><th>${esc(cell.header)}</th><td><div class="listTesterCellValue">${esc(cell.value)}</div></td></tr>`).join('')||'<tr><td>No non-empty cells were available for this record.</td></tr>';
  if(pdf) return `<div class="listTesterPdfMatch"><h3>${index+1}. ${esc(listTesterFormatDate(match))}</h3><p><strong>Source:</strong> ${esc(match?.sourceLabel||match?.source||'')}</p><p><strong>Matched cell:</strong> ${esc(match?.matchHeader||'')} — ${esc(match?.matchValue||'')}</p><table><tbody>${cells}</tbody></table></div>`;
  return `<article class="listTesterDetailRecord"><div class="listTesterDetailRecordHead"><div><div class="listTesterDetailRecordTitle">Record ${index+1}</div><small>${esc(match?.sourceLabel||match?.source||'')} · Source row ${Number(match?.rowIndex||0).toLocaleString()}</small></div><span class="badge">${esc(listTesterFormatDate(match))}</span></div><div class="listTesterDetailMatchCell"><strong>Matched cell · ${esc(match?.matchHeader||'')}</strong><div class="listTesterDetailMatchValue">${esc(match?.matchValue||'')}</div></div><div class="listTesterCellTableWrap"><table class="listTesterCellTable"><tbody>${cells}</tbody></table></div></article>`;
}
function openListTesterDetail(index){
  const result=(state.listTesterResults||[])[index]; if(!result) return;
  const matches=sortListTesterMatches(result.itemMatches||[]), coaches=(result.entry?.coaches||[]).join(' / ')||'—';
  if(els.listTesterDetailTitle) els.listTesterDetailTitle.textContent=`${result.entry?.name||result.input} — Matched Record Details`;
  if(els.listTesterDetailSummary) els.listTesterDetailSummary.innerHTML=`<span class="badge"><strong>Pasted:</strong>&nbsp;${esc(result.input)}</span><span class="badge"><strong>Matched:</strong>&nbsp;${esc(result.entry?.name||'—')}</span><span class="badge"><strong>Coach:</strong>&nbsp;${esc(coaches)}</span><span class="badge ${matches.length?'good':'bad'}"><strong>Records:</strong>&nbsp;${matches.length.toLocaleString()}</span>`;
  if(els.listTesterDetailBody) els.listTesterDetailBody.innerHTML=matches.length?matches.map((match,i)=>listTesterDetailRecordHtml(match,i)).join(''):`<div class="researchEmpty">No stored Check Item records were pulled for this representative. The name match came from ${esc((result.entry?.sources||[]).join(', ')||'the representative index')}.</div>`;
  openModal('listTesterDetailModal');
  if(els.listTesterDetailModal?.querySelector('.modalBody')) els.listTesterDetailModal.querySelector('.modalBody').scrollTop=0;
}
function listTesterPdfHtml(){
  const results=state.listTesterResults||[], config=state.listTesterCheckConfig||{}, coaches=listTesterCoachCounts(results), checkActive=!!config.enabled||results.some(r=>r.itemCount!==null&&r.itemCount!==undefined);
  const matched=results.filter(r=>r.accepted).length, withCoachings=results.filter(r=>r.accepted&&Number(r.itemCount)>0).length, totalCoachings=results.filter(r=>r.accepted).reduce((sum,r)=>sum+Math.max(0,Number(r.itemCount)||0),0), averageCoachings=matched?totalCoachings/matched:0;
  const summaryRows=results.map((r,i)=>{ const coachingCount=Math.max(0,Number(r.itemCount)||0), rowClass=checkActive&&r.accepted?(coachingCount>0?'listTesterPdfCoachingGood':'listTesterPdfCoachingBad'):''; return `<tr class="${rowClass}"><td>${i+1}</td><td>${esc(r.input)}</td><td>${esc(r.entry?.name||'—')}</td><td>${esc((r.entry?.coaches||[]).join(' / ')||'—')}</td>${checkActive?`<td>${coachingCount.toLocaleString()}</td>`:''}<td>${esc(r.status||'')}</td><td>${r.score?Math.round(r.score*100)+'%':'—'}</td></tr>`; }).join('');
  const coachRows=coaches.map(x=>{ const rowClass=checkActive?(x.coachingCount>0?'listTesterPdfCoachingGood':'listTesterPdfCoachingBad'):''; return `<tr class="${rowClass}"><td>${esc(x.coach)}</td><td>${x.count.toLocaleString()}</td>${checkActive?`<td>${x.coachingCount.toLocaleString()}</td><td>${x.averageCoachings.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td>`:''}</tr>`; }).join('');
  const people=results.filter(r=>r.accepted).map(r=>{ const matches=sortListTesterMatches(r.itemMatches||[]); return `<section class="listTesterPdfSection listTesterPdfPerson"><div class="listTesterPdfPersonTitle">${esc(r.entry?.name||r.input)} · ${esc((r.entry?.coaches||[]).join(' / ')||'No coach')}</div>${matches.length?matches.map((match,i)=>listTesterDetailRecordHtml(match,i,{pdf:true})).join(''):'<p>No stored coaching records were pulled for this representative.</p>'}</section>`; }).join('');
  return `<div class="listTesterPdfRoot"><header class="listTesterPdfHeader"><div><h1>Representative List Checker</h1><p>Generated ${esc(new Date().toLocaleString())}</p></div><div><strong>${results.length.toLocaleString()}</strong> pasted<br><strong>${matched.toLocaleString()}</strong> matched${checkActive?`<br><strong>${withCoachings.toLocaleString()}</strong> with coachings<br><strong>${averageCoachings.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</strong> average coachings per matched representative`:''}</div></header><section class="listTesterPdfSection"><h2>Check Settings</h2><table><tbody><tr><th>Source</th><td>${esc(labelSource(config.source)||config.source||'Name matching only')}</td><th>Search Header</th><td>${esc(config.header||'—')}</td></tr><tr><th>Contains</th><td>${esc((config.phrases||[]).join(' | ')||'—')}</td><th>Date Range</th><td>${esc([config.startDate,config.endDate].filter(Boolean).join(' through ')||'All dates')}</td></tr></tbody></table></section><section class="listTesterPdfSection"><h2>Unique Coaches</h2><table><thead><tr><th>Coach</th><th>Representatives</th>${checkActive?'<th>Total Coachings</th><th>Average Coachings</th>':''}</tr></thead><tbody>${coachRows||`<tr><td colspan="${checkActive?4:2}">No confirmed coaches.</td></tr>`}</tbody></table></section><section class="listTesterPdfSection"><h2>Representative Results</h2><table><thead><tr><th>#</th><th>Pasted Name</th><th>Matched Associate</th><th>Team / Coach</th>${checkActive?'<th>Coachings</th>':''}<th>Status</th><th>Confidence</th></tr></thead><tbody>${summaryRows}</tbody></table></section>${people}</div>`;
}
async function exportListTesterPdf(){
  const results=state.listTesterResults||[]; if(!results.length) return alert('Test a list before exporting a PDF.');
  const exporter=window.html2pdf; if(!exporter) return alert('PDF export is not available in this browser session.');
  const host=document.createElement('div'); host.style.cssText='position:fixed;left:-20000px;top:0;background:#fff;z-index:-1'; host.innerHTML=listTesterPdfHtml(); document.body.appendChild(host);
  showProgress('Building List Checker PDF...',12);
  try{
    await yieldToBrowser(); updateProgress('Rendering names and matched cell details...',48,{force:true});
    await exporter().set({margin:[.28,.28,.32,.28],filename:`representative-list-checker-${ymd(new Date())}.pdf`,image:{type:'jpeg',quality:.96},html2canvas:{scale:1.25,useCORS:true,logging:false},jsPDF:{unit:'in',format:'letter',orientation:'landscape'},pagebreak:{mode:['css','legacy'],avoid:['tr']}}).from(host.firstElementChild).save();
    updateProgress('List Checker PDF exported',100,{force:true}); await yieldToBrowser();
  }catch(err){ console.error(err); alert('List Checker PDF export failed: '+(err?.message||err)); }
  finally{ host.remove(); hideProgress(); }
}
function exportListTesterResults(){
  const results=state.listTesterResults||[]; if(!results.length) return alert('Test a list before exporting.');
  const checkActive=!!state.listTesterCheckConfig?.enabled||results.some(r=>r.itemCount!==null&&r.itemCount!==undefined), config=state.listTesterCheckConfig||{};
  const header=['Pasted Name','Matched Associate','Team / Coach',...(checkActive?['Item Count','Check Status']:[]),'Name Match Status','Match Type','Confidence'];
  const lines=[header.map(csvEscape).join(',')];
  results.forEach(r=>lines.push([r.input,r.entry?.name||'',(r.entry?.coaches||[]).join(' / '),...(checkActive?[r.itemCount??'',Number(r.itemCount)>0?'Found':'None']:[]),r.status,r.matchType||'',r.score?Math.round(r.score*100)+'%':''].map(csvEscape).join(',')));
  if(checkActive){ lines.push(''); lines.push(['Check Item Source',labelSource(config.source)||config.source||''].map(csvEscape).join(',')); lines.push(['Search Header',config.header||''].map(csvEscape).join(',')); lines.push(['Contains Phrases',(config.phrases||[]).join(' | ')].map(csvEscape).join(',')); lines.push(['Date Column',config.dateHeader||''].map(csvEscape).join(',')); lines.push(['Date Range',config.startDate||'',config.endDate||''].map(csvEscape).join(',')); }
  lines.push(''); lines.push(['Unique Coaches'].map(csvEscape).join(',')); listTesterCoachCounts(results).forEach(x=>lines.push([x.coach,x.count].map(csvEscape).join(',')));
  downloadText(`representative-list-test-${ymd(new Date())}.csv`,lines.join('\n'));
}
function openListTester(){
  state.listTesterResults=state.listTesterResults||[];
  populateListTesterCheckSources({keepSource:true,keepHeader:true,keepDate:true});
  updateListTesterCheckMeta(); renderListTesterResults(); openModal('listTesterModal'); setTimeout(()=>els.listTesterInput?.focus(),0);
}

function knownCoachNames(){ const s=new Map(); const add=t=>{ t=canonicalCoachName(t); if(t) s.set(coachNameKey(t),t); }; (currentTeamIndex().teamCounts||[]).forEach(x=>add(x.team)); (state.teams||[]).forEach(add); (state.repTeams||new Map()).forEach(add); return [...s.values()].filter(Boolean).sort((a,b)=>a.localeCompare(b)); }
function orgRepCount(o){ const set=orgCoachSet(o); return (currentTeamIndex().reps||[]).filter(r=>set.has(normalizeOrgName(r.team))).length; }
function activeOrg(){ return (state.orgs||[]).find(o=>o.id===state.activeOrgId) || null; }
