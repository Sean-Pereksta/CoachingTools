/* Workbook intake, header detection, categorization, roster intake, and troubleshooting.
 * Behavior-preserving extraction from the definitive All-Star application.
 */
'use strict';

async function readFileWorkbook(file){
  const timing=importTiming('file parsing/loading');
  updateProgress(`Loading file... ${file?.name||''}`,5);
  await yieldToBrowser();
  const buf=await file.arrayBuffer();
  timing.mark('file parsing/loading', `${file?.name||''} buffer ${Number(buf.byteLength||0).toLocaleString()} bytes`);
  updateProgress('Loading file... parsing workbook',10);
  await yieldToBrowser();
  const wb=XLSX.read(buf,{type:'array',cellDates:true,raw:false});
  timing.end(`${(wb.SheetNames||[]).length} sheets`);
  return wb;
}
const workbookAoaCache=new WeakMap();
function sheetAoa(wb, sheetName){
  const ws=wb.Sheets[sheetName]; if(!ws) return [];
  let cached=workbookAoaCache.get(wb); if(!cached){cached=new Map();workbookAoaCache.set(wb,cached);}
  if(cached.has(sheetName)) return cached.get(sheetName);
  const aoa=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false}); cached.set(sheetName,aoa); return aoa;
}
function sheetAoaPreview(wb,sheetName,maxRows=100){
  const ws=wb.Sheets[sheetName]; if(!ws) return [];
  let range; try{ const decoded=XLSX.utils.decode_range(ws['!ref']||'A1:A1'); range={s:{r:0,c:decoded.s.c},e:{r:Math.min(decoded.e.r,Math.max(0,maxRows-1)),c:decoded.e.c}}; }catch(_){range=undefined;}
  return XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false,range});
}
function controlSheetName(wb){
  const names=wb?.SheetNames||[];
  return names.find(sn=>norm(sn)===norm('Control')) || names.find(sn=>norm(sn).includes('control')) || '';
}
function findWorkbookSheetByName(wb, name){
  const names=wb?.SheetNames||[], target=norm(name);
  return names.find(sn=>sn===name) || names.find(sn=>norm(sn)===target) || '';
}
function detectControlColumns(aoa){
  const maxRows=Math.min(50,(aoa||[]).length);
  for(let r=0;r<maxRows;r++){
    const row=aoa[r]||[];
    let teamCol=-1, tabCol=-1, bestTeam=0, bestTab=0;
    row.forEach((cell,c)=>{
      const text=plainHeaderName(cell);
      const teamScore=Math.max(headerCellMatchScore(text,'Team Name'),headerCellMatchScore(text,'Team'));
      const tabScore=Math.max(headerCellMatchScore(text,'Tab Name'),headerCellMatchScore(text,'Sheet Name'),headerCellMatchScore(text,'Tab'));
      if(teamScore>bestTeam){ bestTeam=teamScore; teamCol=c; }
      if(tabScore>bestTab){ bestTab=tabScore; tabCol=c; }
    });
    if(teamCol>=0 && tabCol>=0 && teamCol!==tabCol && bestTeam>=70 && bestTab>=70) return {headerRow:r,teamCol,tabCol};
  }
  return null;
}
function controlRowsFromWorkbook(wb){
  const sn=controlSheetName(wb);
  if(!sn) return [];
  const aoa=sheetAoa(wb,sn);
  const cols=detectControlColumns(aoa);
  if(!cols) return [];
  const rows=[];
  for(let r=cols.headerRow+1;r<aoa.length;r++){
    const arr=aoa[r]||[];
    const team=canonicalCoachName(arr[cols.teamCol]||'');
    const tabName=String(arr[cols.tabCol]||'').trim();
    if(!team && !tabName) continue;
    if(team && tabName) rows.push({team,tabName});
  }
  return rows;
}
function isIgnoredRosterName(value){
  const s=String(value||'').trim(); if(!s) return true;
  const k=norm(s);
  if(!k) return true;
  if(/^(name|representative|rep|agent|associate|team|total|totals|notes?|footer|header|count)$/.test(k)) return true;
  if(/^(total|note|header|footer)\b/i.test(s)) return true;
  if(/^[-–—_]+$/.test(s)) return true;
  return false;
}
function deterministicRosterId(sourceArea,team,fullNameKey,workbook,sheet){
  return ['roster',sourceArea||'',coachNameKey(team),fullNameKey,norm(workbook||''),norm(sheet||'')].join('|');
}
async function buildControlRosterFromWorkbookAsync(bookKey, wb, label='Control roster', start=24, end=35, opts={}){
  const controlRows=controlRowsFromWorkbook(wb);
  const roster=[], seen=new Set(), diagnostics={};
  const total=Math.max(1,controlRows.length), span=end-start;
  const startingRow=6, nameCol=0, maxBlank=10;
  for(let i=0;i<controlRows.length;i++){
    const item=controlRows[i], team=canonicalCoachName(item.team), sn=findWorkbookSheetByName(wb,item.tabName);
    const diag={sourceArea:bookKey,workbook:wb?.Props?.Title||state.books?.[bookKey]?.fileName||'',tab:item.tabName,sheet:sn||'',team,startingRow,nameColumn:nameCol+1,rowsInspected:0,validNames:0,blankRowsSkipped:0,duplicateNames:0,ignoredRows:0,duplicates:[],ignored:[]};
    if(sn && team){
      const aoa=sheetAoa(wb,sn); let blanks=0;
      for(let r=startingRow-1;r<aoa.length;r++){
        const raw=aoa[r]?.[nameCol]; diag.rowsInspected++;
        if(String(raw??'').trim()===''){ blanks++; diag.blankRowsSkipped++; if(blanks>=maxBlank) break; continue; }
        blanks=0;
        if(isIgnoredRosterName(raw)){ diag.ignoredRows++; diag.ignored.push({rowNumber:r+1,value:String(raw??'')}); continue; }
        const rep=cleanName(raw), key=fullNameIdentityKey(rep);
        if(!key){ diag.ignoredRows++; diag.ignored.push({rowNumber:r+1,value:String(raw??'')}); continue; }
        const dedupe=`${bookKey}\u0000${coachNameKey(team)}\u0000${key}`;
        if(seen.has(dedupe)){ diag.duplicateNames++; diag.duplicates.push({rowNumber:r+1,value:String(raw??''),fullNameKey:key}); continue; }
        seen.add(dedupe); diag.validNames++;
        const workbookName=opts.workbookName||state.books?.[bookKey]?.fileName||wb?.Props?.Title||'';
        const rosterId=deterministicRosterId(bookKey,team,key,workbookName,sn);
        roster.push({rosterId,source:bookKey,sourceArea:bookKey,team,tabName:item.tabName,sheetName:sn,sheet:sn,workbook:workbookName,rowNumber:r+1,sourceRow:r+1,originalName:String(raw??'').trim(),displayName:rep,fullNameKey:key,representative:rep,_sourceKey:`${bookKey}_control_roster`,_rep:rep,_repKey:key,_rosterId:rosterId,_team:team,_isControlRoster:true,controlRosterSchemaVersion:CONTROL_ROSTER_SCHEMA_VERSION});
      }
    }
    diagnostics[`${bookKey}|${team}|${item.tabName}`]=diag;
    if(i%20===0 || i===controlRows.length-1){ updateProgress(`${label}... ${i+1} / ${controlRows.length || 1} teams`, start + span*((i+1)/total)); await yieldToBrowser(); }
  }
  state.rosterDiagnostics={...(state.rosterDiagnostics||{}),...diagnostics};
  return roster.sort((a,b)=>(a.team||'').localeCompare(b.team||'')||(a.representative||'').localeCompare(b.representative||''));
}
function rosterRowsByRep(rows){
  const map=new Map();
  (rows||[]).forEach(r=>{
    const rep=cleanName(r._rep||r.representative||r.displayName||r.originalName||''), key=fullNameIdentityKey(rep), team=canonicalCoachName(r._team||r.team||'');
    if(!key||!rep||!team) return;
    if(!map.has(key)) map.set(key,[]);
    map.get(key).push({rep,key,team,row:r});
  });
  return map;
}
function rosterReassignmentAnalysis(area,currentRows,nextRows,wb){
  const current=rosterRowsByRep(currentRows), next=rosterRowsByRep(nextRows);
  const moved=[], added=[], removed=[], duplicates=[];
  next.forEach((items,key)=>{
    const uniqueTeams=[...new Set(items.map(x=>x.team))];
    if(uniqueTeams.length>1) duplicates.push({rep:items[0].rep,teams:uniqueTeams});
    const before=current.get(key)?.[0];
    const after=items[0];
    if(!before) added.push({rep:after.rep,from:'Not on current roster',to:after.team});
    else if(coachNameKey(before.team)!==coachNameKey(after.team)) moved.push({rep:after.rep,from:before.team,to:after.team});
  });
  current.forEach((items,key)=>{ if(!next.has(key)){ const before=items[0]; removed.push({rep:before.rep,from:before.team,to:'Removed from roster'}); } });
  const controlRows=controlRowsFromWorkbook(wb), missingTabs=controlRows.filter(x=>!findWorkbookSheetByName(wb,x.tabName)).map(x=>`${x.team} → ${x.tabName}`);
  const emptyTeams=controlRows.filter(x=>{
    const teamKey=coachNameKey(x.team);
    return !nextRows.some(r=>coachNameKey(r._team||r.team||'')===teamKey);
  }).map(x=>x.team);
  const teams=[...new Set((nextRows||[]).map(r=>canonicalCoachName(r._team||r.team||'')).filter(Boolean))];
  return {area,currentCount:(currentRows||[]).length,nextCount:(nextRows||[]).length,teamCount:teams.length,controlTeamCount:controlRows.length,moved,added,removed,duplicates,missingTabs,emptyTeams,blocked:duplicates.length>0 || !nextRows.length || !controlRows.length};
}
function rosterSummaryCard(label,value){ return `<div class="rosterSummaryCard"><strong>${esc(label)}</strong><span>${Number(value||0).toLocaleString()}</span></div>`; }
function renderRosterReassignmentPreview(){
  const p=state.pendingRosterReassignment;
  const setDisabled=disabled=>{ if(els.applyRosterReassignmentBtn) els.applyRosterReassignmentBtn.disabled=disabled; if(els.applyRosterReassignmentFootBtn) els.applyRosterReassignmentFootBtn.disabled=disabled; };
  if(!p){
    if(els.rosterReassignmentSummary) els.rosterReassignmentSummary.innerHTML='';
    if(els.rosterReassignmentWarnings) els.rosterReassignmentWarnings.innerHTML='';
    if(els.rosterReassignmentChanges) els.rosterReassignmentChanges.innerHTML='<div class="checkResultMeta">No roster file has been previewed yet.</div>';
    if(els.rosterReassignmentStatus) els.rosterReassignmentStatus.textContent='Choose Retail or Referral, then upload the new roster workbook.';
    setDisabled(true); restoreImportFileLabels(); return;
  }
  const a=p.analysis;
  if(els.rosterReassignmentFileName) els.rosterReassignmentFileName.textContent=`${p.fileName} · previewing ${p.area==='retail'?'Retail':'Referral'} roster`;
  if(els.rosterReassignmentSummary) els.rosterReassignmentSummary.innerHTML=[rosterSummaryCard('New representatives',a.nextCount),rosterSummaryCard('Teams',a.teamCount),rosterSummaryCard('Moved',a.moved.length),rosterSummaryCard('Added',a.added.length),rosterSummaryCard('Removed',a.removed.length)].join('');
  const warnings=[];
  if(a.duplicates.length) warnings.push(`${a.duplicates.length} representative name${a.duplicates.length===1?' appears':'s appear'} on multiple teams: ${a.duplicates.slice(0,8).map(x=>`${x.rep} (${x.teams.join(' / ')})`).join('; ')}`);
  if(a.missingTabs.length) warnings.push(`${a.missingTabs.length} Control mapping${a.missingTabs.length===1?' points':'s point'} to a missing worksheet: ${a.missingTabs.slice(0,8).join('; ')}`);
  if(a.emptyTeams.length) warnings.push(`${a.emptyTeams.length} Control team${a.emptyTeams.length===1?' has':'s have'} no representatives read from column A starting at row 6: ${a.emptyTeams.slice(0,8).join('; ')}`);
  if(!a.controlTeamCount) warnings.push('No usable Team Name / Tab Name mapping was found on a Control sheet.');
  if(!a.nextCount) warnings.push('No representatives were found. The workbook must use the monthly Control + team-tab layout.');
  if(els.rosterReassignmentWarnings) els.rosterReassignmentWarnings.innerHTML=warnings.map(w=>`<div class="rosterWarning">${esc(w)}</div>`).join('');
  const changes=[...a.moved,...a.added,...a.removed];
  if(els.rosterReassignmentChanges) els.rosterReassignmentChanges.innerHTML=changes.length ? changes.slice(0,500).map(x=>`<div class="rosterChangeRow"><strong>${esc(x.rep)}</strong><span>${esc(x.from)}</span><span class="rosterArrow">→</span><span>${esc(x.to)}</span></div>`).join('') : '<div class="checkResultMeta">No representative-level changes were detected. Applying will still replace the selected area’s roster with this workbook.</div>';
  if(els.rosterReassignmentStatus) els.rosterReassignmentStatus.textContent=a.blocked ? 'Preview found blocking roster problems. Correct the workbook before applying.' : `Ready to replace the ${p.area==='retail'?'Retail':'Referral'} roster only. Existing statistical rows will be retained and remapped to these teams.`;
  setDisabled(!!a.blocked);
}
function clearRosterReassignmentPreview(){
  state.pendingRosterReassignment=null;
  if(els.rosterReassignmentFile) els.rosterReassignmentFile.value='';
  renderRosterReassignmentPreview();
}
async function previewRosterReassignmentFile(file){
  const area=els.rosterReassignmentArea?.value==='referral'?'referral':'retail';
  showProgress(`Reading ${area} roster reassignment...`,4);
  try{
    const wb=await readFileWorkbook(file);
    updateProgress('Reading Control roster and team tabs...',30); await yieldToBrowser();
    const rows=await buildControlRosterFromWorkbookAsync(area,wb,`Building ${area} roster reassignment`,30,78,{workbookName:file.name});
    const analysis=rosterReassignmentAnalysis(area,state.data?.[area]?.controlRoster||[],rows,wb);
    state.pendingRosterReassignment={area,fileName:file.name,rows,analysis,previewedAt:new Date().toISOString()};
    renderRosterReassignmentPreview();
  }catch(err){ console.error(err); clearRosterReassignmentPreview(); alert('Roster reassignment preview failed. Confirm this is an Excel workbook with a Control sheet and monthly team tabs.'); }
  finally{ hideProgress(); }
}
function resetManualTeamFlagsForRosterArea(area,affectedRepKeys=new Set()){
  const areaSources=area==='referral' ? [state.data.referral.sv2,state.data.referral.wiper] : [state.data.retail.sv2,state.data.retail.wiper];
  areaSources.forEach(rows=>(rows||[]).forEach(r=>{ r._teamAssignedManually=false; }));
  [state.data.qa.rows,state.data.checklist.rows,state.data.documented_coaching.rows,state.data.comp_calls.rows,...(state.customSources||[]).map(c=>c.rows||[])].forEach(rows=>(rows||[]).forEach(r=>{
    const sourceArea=r._sourceArea||sourceAreaForSource(r._sourceKey||''), repKey=repKeyFromAnyRow(r);
    if(sourceArea===area || affectedRepKeys.has(repKey)) r._teamAssignedManually=false;
  }));
}
async function applyRosterReassignment(){
  const p=state.pendingRosterReassignment;
  if(!p || p.analysis?.blocked || !(p.rows||[]).length) return alert('Preview a valid roster reassignment workbook before applying it.');
  showProgress(`Applying ${p.area} roster reassignment...`,10);
  try{
    const area=p.area, areaData=state.data[area], appliedAt=new Date().toISOString();
    const affectedRepKeys=new Set([...(areaData.controlRoster||[]),...(p.rows||[])].map(r=>fullNameIdentityKey(r._rep||r.representative||r.displayName||r.originalName||'')).filter(Boolean));
    areaData.controlRoster=p.rows.map(r=>({...r,_teamAssignedManually:false,rosterImportFile:p.fileName,rosterImportedAt:appliedAt}));
    areaData.rosterFileName=p.fileName; areaData.rosterUpdatedAt=appliedAt;
    resetManualTeamFlagsForRosterArea(area,affectedRepKeys);
    bumpVersion('roster'); invalidateRosterIndex(`${area} roster reassignment imported`); ensureRosterIndex();
    applyRepAliasMappingsToAllRows();
    markImportCacheDirty('source',`${area}:controlRoster`,`${area} roster reassignment`);
    markImportCacheDirty('source',`${area}:metadata`,`${area} roster reassignment metadata`);
    markImportCacheDirty('misc','aliases',`${area} roster reassignment alias validation`);
    await finishDataChanged(`${area} roster reassignment`,52);
    await flushImportCacheSave(`${area} roster reassignment`);
    state.pendingRosterReassignment=null;
    restoreImportFileLabels(); renderTeamTotalsImportControls();
    if(els.rosterReassignmentStatus) els.rosterReassignmentStatus.textContent=`Applied ${p.fileName}: ${(areaData.controlRoster||[]).length.toLocaleString()} representatives across ${new Set((areaData.controlRoster||[]).map(r=>coachNameKey(r._team||r.team||'')).filter(Boolean)).size.toLocaleString()} teams. Statistical imports were not replaced.`;
    if(els.rosterReassignmentSummary) els.rosterReassignmentSummary.innerHTML=[rosterSummaryCard('Representatives',areaData.controlRoster.length),rosterSummaryCard('Teams',new Set(areaData.controlRoster.map(r=>coachNameKey(r._team||r.team||'')).filter(Boolean)).size),rosterSummaryCard('Moved',p.analysis.moved.length),rosterSummaryCard('Added',p.analysis.added.length),rosterSummaryCard('Removed',p.analysis.removed.length)].join('');
    if(els.rosterReassignmentWarnings) els.rosterReassignmentWarnings.innerHTML='';
    if(els.rosterReassignmentChanges) els.rosterReassignmentChanges.innerHTML='<div class="checkResultMeta">Roster reassignment applied successfully. Open Teams Imported to review the new team membership.</div>';
    if(els.applyRosterReassignmentBtn) els.applyRosterReassignmentBtn.disabled=true;
    if(els.applyRosterReassignmentFootBtn) els.applyRosterReassignmentFootBtn.disabled=true;
    if(els.rosterReassignmentFile) els.rosterReassignmentFile.value='';
  }catch(err){ console.error(err); alert('Roster reassignment failed. The previous roster may still be active; review Teams Imported and the browser console.'); }
  finally{ hideProgress(); }
}
function openRosterReassignment(){
  clearRosterReassignmentPreview();
  restoreImportFileLabels();
  openModal('rosterReassignmentModal');
}

function buildRowsFromLayout(aoa, headerRow, startCol, fullRow=false, manualHeaders=[]){
  aoa=aoa||[];
  const hr=Math.max(0,Number(headerRow)||0);
  const requestedStart=Math.max(0,Number(startCol)||0);
  const sc=fullRow ? 0 : requestedStart;
  const row=aoa[hr]||[];
  const manualMap=new Map();
  (manualHeaders||[]).forEach(m=>{
    const col=Math.max(0,Number(m.col ?? m.colIndex ?? 0));
    const name=plainHeaderName(m.name || m.header || m.value);
    if(name) manualMap.set(col,{name,row:Math.max(0,Number(m.row ?? hr))});
  });
  const headerDefs=[]; const seenCols=new Set();
  const maxCol=Math.max(row.length, ...Array.from(manualMap.keys()).map(x=>x+1), 0);
  for(let c=sc;c<maxCol;c++){
    const manual=manualMap.get(c);
    let h=manual ? manual.name : String(row[c]??'').trim().replace(/\s+/g,' ');
    if(!h) continue;
    headerDefs.push({h, col:c, row:manual ? manual.row : hr});
    seenCols.add(c);
  }
  Array.from(manualMap.entries()).sort((a,b)=>a[0]-b[0]).forEach(([c,manual])=>{
    if(!seenCols.has(c)) headerDefs.push({h:manual.name, col:c, row:manual.row});
  });
  const headers=[]; const headerCols=[]; const seen={};
  headerDefs.forEach(def=>{
    let h=def.h;
    const base=h;
    if(seen[base]){ seen[base]++; h=`${base}_${seen[base]}`; } else seen[base]=1;
    def.finalHeader=h;
    headers.push(h); headerCols.push(def.col);
  });
  const dataStart=headerDefs.length ? Math.min(...headerDefs.map(d=>d.row+1)) : hr+1;
  const rows=[];
  for(let r=dataStart;r<aoa.length;r++){
    const arr=aoa[r]||[]; const obj={}; let any=false;
    headerDefs.forEach(def=>{
      const v = r>def.row ? (arr[def.col]??'') : '';
      if(String(v).trim()!=='') any=true;
      obj[def.finalHeader]=v;
    });
    if(any) rows.push(obj);
  }
  return {rows,headers,headerCols,headerDefs,headerRow:hr,startCol:sc,detected:false,matchCount:0,fullRow:!!fullRow,manualHeaders:manualHeaders||[]};
}
async function buildRowsFromLayoutAsync(aoa, headerRow, startCol, fullRow=false, manualHeaders=[], label='Building rows', start=20, end=38){
  aoa=aoa||[];
  const base=buildRowsFromLayout(aoa.slice(0,Math.min(aoa.length,1)), headerRow, startCol, fullRow, manualHeaders);
  const hr=Math.max(0,Number(headerRow)||0);
  const requestedStart=Math.max(0,Number(startCol)||0);
  const sc=fullRow ? 0 : requestedStart;
  const row=aoa[hr]||[];
  const manualMap=new Map();
  (manualHeaders||[]).forEach(m=>{
    const col=Math.max(0,Number(m.col ?? m.colIndex ?? 0));
    const name=plainHeaderName(m.name || m.header || m.value);
    if(name) manualMap.set(col,{name,row:Math.max(0,Number(m.row ?? hr))});
  });
  const headerDefs=[]; const seenCols=new Set();
  const maxCol=Math.max(row.length, ...Array.from(manualMap.keys()).map(x=>x+1), 0);
  for(let c=sc;c<maxCol;c++){
    const manual=manualMap.get(c);
    let h=manual ? manual.name : String(row[c]??'').trim().replace(/\s+/g,' ');
    if(!h) continue;
    headerDefs.push({h, col:c, row:manual ? manual.row : hr});
    seenCols.add(c);
  }
  Array.from(manualMap.entries()).sort((a,b)=>a[0]-b[0]).forEach(([c,manual])=>{ if(!seenCols.has(c)) headerDefs.push({h:manual.name, col:c, row:manual.row}); });
  const headers=[]; const headerCols=[]; const seen={};
  headerDefs.forEach(def=>{ let h=def.h; const baseName=h; if(seen[baseName]){ seen[baseName]++; h=`${baseName}_${seen[baseName]}`; } else seen[baseName]=1; def.finalHeader=h; headers.push(h); headerCols.push(def.col); });
  const dataStart=headerDefs.length ? Math.min(...headerDefs.map(d=>d.row+1)) : hr+1;
  const rows=[], total=Math.max(1,aoa.length-dataStart), span=end-start;
  for(let r=dataStart;r<aoa.length;r++){
    const arr=aoa[r]||[]; const obj={}; let any=false;
    headerDefs.forEach(def=>{ const v = r>def.row ? (arr[def.col]??'') : ''; if(String(v).trim()!=='') any=true; obj[def.finalHeader]=v; });
    if(any) rows.push(obj);
    const done=r-dataStart+1;
    if(done%IMPORT_CHUNK_SIZE===0 || r===aoa.length-1){ updateProgress(`${label} (${done.toLocaleString()} / ${total.toLocaleString()})`, start + span*(done/total)); await yieldToBrowser(); }
  }
  return {...base,rows,headers,headerCols,headerDefs,headerRow:hr,startCol:sc,fullRow:!!fullRow,manualHeaders:manualHeaders||[]};
}
function detectHeaderLayout(aoa, expectedNames, preferredRow=0, preferredCol=0){
  aoa=aoa||[]; expectedNames=uniquePlain(expectedNames);
  let best=null;
  const maxRows=Math.min(100, aoa.length);
  for(let r=0;r<maxRows;r++){
    const row=aoa[r]||[];
    const nonEmpty=row.map((v,c)=>({v:String(v??'').trim().replace(/\s+/g,' '),c})).filter(x=>x.v);
    if(nonEmpty.length<2) continue;
    const matchedKeys=new Set(); let exactish=0; let score=0;
    nonEmpty.forEach(cell=>{
      expectedNames.forEach(exp=>{
        const s=headerCellMatchScore(cell.v, exp);
        if(s>=70){ matchedKeys.add(norm(exp)); score+=s; if(s>=105) exactish++; }
      });
    });
    const matched=matchedKeys.size;
    const density=nonEmpty.length;
    const texty=nonEmpty.filter(x=>/[A-Za-z]/.test(x.v)).length;
    const percentLike=nonEmpty.filter(x=>/%/.test(x.v)).length;
    const likelyDataPenalty=(texty<Math.max(2,Math.ceil(density*.35)) ? 65 : 0) + (percentLike>2 ? 15 : 0);
    const distancePenalty=Math.abs(r-preferredRow)*1.2;
    // Start column is intentionally 0 for detected layouts. Once a header row is found,
    // pull the whole row and keep every non-blank header, regardless of order or column.
    const finalScore=matched*240 + exactish*50 + Math.min(density,60)*3 + texty*4 + score/20 - distancePenalty - likelyDataPenalty;
    if(!best || finalScore>best.score) best={headerRow:r,startCol:0,score:finalScore,matched,density,texty,fullRow:true};
  }
  if(best && best.matched>0) return best;
  let fallback=null;
  for(let r=0;r<maxRows;r++){
    const row=aoa[r]||[];
    const nonEmpty=row.map((v,c)=>({v:String(v??'').trim().replace(/\s+/g,' '),c})).filter(x=>x.v);
    if(nonEmpty.length<2) continue;
    const texty=nonEmpty.filter(x=>/[A-Za-z]/.test(x.v)).length;
    const score=nonEmpty.length*10 + texty*12 - Math.abs(r-preferredRow)*1.2;
    if(!fallback || score>fallback.score) fallback={headerRow:r,startCol:0,score,matched:0,density:nonEmpty.length,texty,fullRow:true};
  }
  return fallback;
}
function betterHeaderPack(candidate, current, source, expected, model, strict){
  if(!candidate) return current;
  candidate.matchCount=headersMatchCount(candidate.headers,expected);
  current.matchCount=headersMatchCount(current.headers,expected);
  const candidateGood=layoutLooksGoodForSource(source,candidate.headers,expected,model);
  const currentGood=layoutLooksGoodForSource(source,current.headers,expected,model);
  if(candidateGood && !currentGood) return candidate;
  if(candidateGood && currentGood && candidate.headers.length>current.headers.length) return candidate;
  if(candidate.matchCount>current.matchCount) return candidate;
  if(candidate.matchCount===current.matchCount && candidate.headers.length>current.headers.length && candidate.matchCount>=2) return candidate;
  if(!strict && candidate.headers.length>current.headers.length) return candidate;
  return current;
}
function inspectRowsLayout(aoa,headerRow,startCol,fullRow=false,manualHeaders=[]){
  const manualMax=(manualHeaders||[]).reduce((m,x)=>Math.max(m,Number(x.row??headerRow)||0),Number(headerRow)||0);
  return buildRowsFromLayout((aoa||[]).slice(0,manualMax+1),headerRow,startCol,fullRow,manualHeaders);
}
function sheetRowsFromAoa(aoa, headerRow, startCol, strict=false, expectedNames=[], source='', model=null, manualHeaders=[]){
  aoa=aoa||[];
  let hr=Math.max(0,Number(headerRow)||0), sc=Math.max(0,Number(startCol)||0);
  let layout=inspectRowsLayout(aoa,hr,sc,false,manualHeaders), detected=false;
  const expected=uniquePlain(expectedNames);
  if(expected.length){
    layout.matchCount=headersMatchCount(layout.headers,expected);
    const wholeSameRow=inspectRowsLayout(aoa,hr,0,true,manualHeaders);
    wholeSameRow.matchCount=headersMatchCount(wholeSameRow.headers,expected);
    layout=betterHeaderPack(wholeSameRow,layout,source,expected,model,strict);
    if(!layoutLooksGoodForSource(source,layout.headers,expected,model)){
      const found=detectHeaderLayout(aoa,expected,hr,sc);
      if(found){ const candidate=inspectRowsLayout(aoa,found.headerRow,0,true,manualHeaders); candidate.detected=true; layout=betterHeaderPack(candidate,layout,source,expected,model,strict); detected=layout===candidate; }
    }
  }else{
    const sameRowHeaders=inspectRowsLayout(aoa,hr,0,true,manualHeaders); if(sameRowHeaders.headers.length>layout.headers.length) layout=sameRowHeaders;
    if(!strict && (!aoa[hr] || layout.headers.length<2)){ const found=detectHeaderLayout(aoa,[],hr,sc); if(found){layout=inspectRowsLayout(aoa,found.headerRow,0,true,manualHeaders);detected=true;} }
  }
  const pack=buildRowsFromLayout(aoa,layout.headerRow,layout.startCol,layout.fullRow,manualHeaders); pack.detected=detected||!!layout.detected; pack.matchCount=headersMatchCount(pack.headers,expected);
  return pack;
}
async function sheetRowsFromAoaAsync(aoa, headerRow, startCol, strict=false, expectedNames=[], source='', model=null, manualHeaders=[], label='Building rows', start=20, end=38){
  aoa=aoa||[];
  let hr=Math.max(0,Number(headerRow)||0), sc=Math.max(0,Number(startCol)||0);
  const expected=uniquePlain(expectedNames);
  let layout=inspectRowsLayout(aoa,hr,sc,false,manualHeaders), detected=false;
  if(expected.length){
    layout.matchCount=headersMatchCount(layout.headers,expected);
    const wholeSameRow=inspectRowsLayout(aoa,hr,0,true,manualHeaders);
    wholeSameRow.matchCount=headersMatchCount(wholeSameRow.headers,expected);
    layout=betterHeaderPack(wholeSameRow,layout,source,expected,model,strict);
    if(!layoutLooksGoodForSource(source,layout.headers,expected,model)){
      const found=detectHeaderLayout(aoa,expected,hr,sc);
      if(found){ const candidate=inspectRowsLayout(aoa,found.headerRow,0,true,manualHeaders); candidate.detected=true; layout=betterHeaderPack(candidate,layout,source,expected,model,strict); detected=layout===candidate; }
    }
  }else{
    const sameRowHeaders=inspectRowsLayout(aoa,hr,0,true,manualHeaders); if(sameRowHeaders.headers.length>layout.headers.length) layout=sameRowHeaders;
    if(!strict && (!aoa[hr] || layout.headers.length<2)){ const found=detectHeaderLayout(aoa,[],hr,sc); if(found){layout=inspectRowsLayout(aoa,found.headerRow,0,true,manualHeaders);detected=true;} }
  }
  updateProgress(`${label} · layout locked at row ${layout.headerRow+1}`,start,{force:true}); await yieldToBrowser();
  const pack=await buildRowsFromLayoutAsync(aoa,layout.headerRow,layout.startCol,layout.fullRow,manualHeaders,label,start,end); pack.detected=detected||!!layout.detected; pack.matchCount=headersMatchCount(pack.headers,expected);
  return pack;
}
function sheetRows(wb, sheetName, headerRow, startCol, strict=false){
  return sheetRowsFromAoa(sheetAoa(wb,sheetName), headerRow, startCol, strict);
}


function sourceBookKey(source){ return SOURCE_TO_BOOK[source] || source; }
function bookForSource(source){ if(isCustomSource(source)){ const c=customSource(source)||{}; return state.books[source] || {fileName:c.fileName||'',sheetNames:c.sheetNames||[],aoaBySheet:c.aoaBySheet||{},selectedSheets:{[source]:c.sheetName||''}}; } return state.books[sourceBookKey(source)] || {sheetNames:[],aoaBySheet:{},selectedSheets:{}}; }
function storeWorkbook(bookKey, file, wb){
  const aoaBySheet={};
  (wb.SheetNames||[]).forEach(sn=>{ aoaBySheet[sn]=sheetAoa(wb,sn); });
  state.books[bookKey]={fileName:file.name,sheetNames:wb.SheetNames||[],aoaBySheet,selectedSheets:{...(state.books[bookKey]?.selectedSheets||{})},sheetVersions:{}};
  markBookCacheDirty(bookKey,`${bookKey} workbook imported`);
}
async function storeWorkbookAsync(bookKey, file, wb, label='Preparing workbook', start=12, end=22, options={}){
  const aoaBySheet={};
  const allNames=wb.SheetNames||[], requested=(options.sheetNames||[]).filter(sn=>allNames.includes(sn)), names=requested.length?[...new Set(requested)]:allNames;
  const span=end-start, total=Math.max(1,names.length);
  for(let i=0;i<names.length;i++){
    // Sheet persistence is record-based: each worksheet gets its own dirty sheet
    // record so later saves do not rewrite unrelated workbook tabs.
    aoaBySheet[names[i]]=sheetAoa(wb,names[i]);
    markImportCacheDirty('sheet',`${bookKey}:${names[i]}`,`${bookKey} worksheet imported`);
    updateProgress(`${label}... ${i+1} / ${names.length} sheets`, start + span*((i+1)/total));
    await yieldToBrowser();
  }
  state.books[bookKey]={fileName:file.name,sheetNames:names,availableSheetNames:allNames,materializedSheetNames:names,aoaBySheet,selectedSheets:{...(state.books[bookKey]?.selectedSheets||{})},sheetVersions:{},lazyWorkbook:true};
  markImportCacheDirty('book',bookKey,`${bookKey} workbook metadata imported`);
}
function workbookSheetsNeededForImport(bookKey,wb,selected=[]){
  const out=new Set((selected||[]).filter(Boolean)), control=controlSheetName(wb); if(control) out.add(control);
  if(bookKey==='retail'||bookKey==='referral'){
    controlRowsFromWorkbook(wb).forEach(x=>{ const sn=findWorkbookSheetByName(wb,x.tabName); if(sn) out.add(sn); });
    const summaryHints=bookKey==='retail'?['Appt Summary','Appointment Summary','Retail Team Totals']:['KPI Summary','Referral Team Totals'];
    summaryHints.forEach(h=>{const sn=findWorkbookSheetByName(wb,h);if(sn)out.add(sn);});
  }
  return [...out];
}
function getSourceAoa(source){
  if(isCustomSource(source)) return customSource(source)?.aoa||[];
  if(source==='retail_sv2') return state.data.retail.sv2Aoa||[];
  if(source==='retail_wiper') return state.data.retail.wiperAoa||[];
  if(source==='referral_sv2') return state.data.referral.sv2Aoa||[];
  if(source==='referral_wiper') return state.data.referral.wiperAoa||[];
  if(source==='qa') return state.data.qa.aoa||[];
  if(source===QA_DIRECT_SOURCE) return state.data.qa_direct?.aoa||[];
  if(source==='checklist') return state.data.checklist.aoa||[];
  if(source==='documented_coaching') return state.data.documented_coaching.aoa||[];
  if(source==='comp_calls') return state.data.comp_calls.aoa||[];
  return [];
}
function setSourceAoa(source, aoa, sheetName=''){
  const book=bookForSource(source);
  if(sheetName) book.selectedSheets[source]=sheetName;
  if(source===NONDATED_SOURCE || source===DATED_SOURCE) markImportCacheDirty('misc','categorized',`${labelSource(source)} categorized rows updated`);
  if(isCustomSource(source)){ markImportCacheDirty('misc','customSources',`${labelSource(source)} custom source updated`); const c=customSource(source); if(c){ c.aoa=aoa||[]; c.sheetName=sheetName||c.sheetName||''; c.sheetNames=book.sheetNames||c.sheetNames||[]; c.aoaBySheet=book.aoaBySheet||c.aoaBySheet||{}; } }
  if(source==='retail_sv2') state.data.retail.sv2Aoa=aoa||[];
  if(source==='retail_wiper') state.data.retail.wiperAoa=aoa||[];
  if(source==='referral_sv2') state.data.referral.sv2Aoa=aoa||[];
  if(source==='referral_wiper') state.data.referral.wiperAoa=aoa||[];
  if(source==='qa') state.data.qa.aoa=aoa||[];
  if(source===QA_DIRECT_SOURCE) state.data.qa_direct={...(state.data.qa_direct||{}),aoa:aoa||[],sheetName:sheetName||state.data.qa_direct?.sheetName||''};
  if(source==='checklist') state.data.checklist.aoa=aoa||[];
  if(source==='documented_coaching') state.data.documented_coaching.aoa=aoa||[];
  if(source==='comp_calls') state.data.comp_calls.aoa=aoa||[];
  const bookKey=sourceBookKey(source); if(sheetName) markImportCacheDirty('sheet',`${bookKey}:${sheetName}`,`${labelSource(source)} sheet changed`);
  markSourceCacheDirty(source,`${labelSource(source)} source AOA changed`);
}

function normalizeCustomRow(row,headers,columns={},source=''){ const rep=repNameFromColumns(row,headers,columns,[columns.rep,'Agent Name','Associate Name','Name','Representative','Rep'].filter(Boolean)); const teamH=findHeaderFromExpected(headers,columns.team||columns.coach,['Team','Coach','Coach Assigned','Job Coach','Team Name'].filter(Boolean)); const dateH=selectedDateHeaderForSource(source,headers,columns); const weekH=findHeader(headers,[columns.week,'Week','Week Start','Week Ending'].filter(Boolean)); const textH=findHeader(headers,[columns.text,'Notes','Comment','Conversation','Text','Description'].filter(Boolean)); const scoreH=findHeader(headers,[columns.score,'Score','Score %','QA Score'].filter(Boolean)); const team=columns.skipTeamBuild?'':canonicalCoachName(row[teamH]??''); return {...row,_sourceKey:source,_sourceArea:sourceAreaForSource(source),_rawRep:rep,_rawRepKey:fullNameIdentityKey(rep),_rep:rep,_repKey:fullNameIdentityKey(rep),_rosterId:safeFallbackRosterIdentity({_rep:rep,_team:team},sourceAreaForSource(source)),_aliasApplied:false,_aliasRecord:null,_team:team,_date:dateH?row[dateH]:'',_dateValue:dateH?cachedSourceDateValue(source,dateH,row[dateH]):NaN,_week:weekH?row[weekH]:'',_text:textH?String(row[textH]??''):'',_score:scoreH?normalizeScore(row[scoreH]):NaN}; }
function nextSourceVersion(source){ state.sourceMeta=state.sourceMeta||{}; const m=state.sourceMeta[source]||{}; return Number(m.sourceVersion||0)+1; }
function cachedSourceDateValue(source,column,value){
  if(value instanceof Date) return value.getTime();
  const key=[source||'',column||'',String(value??'')].join('\u001f');
  state._dateParseCache=state._dateParseCache||new Map();
  if(state._dateParseCache.has(key)) return state._dateParseCache.get(key);
  const d=parseDateOnly(value)||parseWeekLabel(value);
  const n=d?d.getTime():NaN;
  if(state._dateParseCache.size>50000) state._dateParseCache.clear();
  state._dateParseCache.set(key,n);
  return n;
}
function buildHeaderMetadata(source, headers, cfg={}, pack={}){
  headers=headers||[];
  const normalizedHeaders=headers.map(h=>plainHeaderName(h));
  const headerMap={}, plainHeaderMap={}, columnIndexes={};
  headers.forEach((h,i)=>{ headerMap[h]=i; plainHeaderMap[plainHeaderName(h)]=h; columnIndexes[h]=i; });
  const cols=cfg.columns||{};
  const meta={sourceVersion:nextSourceVersion(source),originalHeaders:[...headers],normalizedHeaders,headerMap,plainHeaderMap,columnIndexes,headerRow:(pack.headerRow??0)+1,startCol:(pack.startCol??0)+1,detectedNameColumns:{},detectedTeamColumn:'',detectedDateColumn:''};
  if(source==='qa'){
    meta.detectedNameColumns.fullName=findHeaderFromExpected(headers,cols.fullName||cols.agent,['Agent Name','AgentName']);
    meta.detectedTeamColumn=findHeaderFromExpected(headers,cols.team,['Team']);
    meta.detectedDateColumn=selectedDateHeaderForSource(source,headers,cols);
    meta.scoreColumn=findHeaderFromExpected(headers,cols.score,['Score %','Score%','Score Percent','Evaluation Score']);
    meta.interactionDateColumn=findHeaderFromExpected(headers,cols.interactionDate,['Interaction start Time','Interaction Start Time','Interaction Start','Start Time','Date']);
    meta.assignedDateColumn=findHeaderFromExpected(headers,cols.assignedDate,['Assigned Date','Date Assigned','Assignment Date']);
  }else{
    const repFallbacks=source==='comp_calls'?['CSR/SSR Name (This is the person being complimented)','CSR/SSR Name','Representative','Associate Name','Associate','Agent Name','Rep']:(source==='documented_coaching'?['Associate name','Associate Name','Associate','Agent Name','Rep']:['Associate Name','Associate','Agent Name','Rep']);
    const teamFallbacks=source==='comp_calls'?['CSR Team/Coach','Coach Assigned','Coach','Team','Job Coach']:(source==='documented_coaching'?['Job Coach','Coach Assigned','Coach','Team']:['Coach Assigned','Coach','Team','Job Coach']);
    meta.detectedNameColumns.fullName=findHeaderFromExpected(headers,cols.fullName||cols.rep,repFallbacks);
    meta.detectedNameColumns.firstName=findHeader(headers,[cols.firstName,'First Name','First']);
    meta.detectedNameColumns.lastName=findHeader(headers,[cols.lastName,'Last Name','Last']);
    meta.detectedTeamColumn=findHeaderFromExpected(headers,cols.team||cols.coach,teamFallbacks);
    meta.detectedDateColumn=selectedDateHeaderForSource(source,headers,cols);
    meta.textColumn=findHeaderFromExpected(headers,cols.text,source==='comp_calls'?['Compliment','Comment','Comments','Notes']:['Notes','Comment','Description','Item']);
    meta.weekColumn=findHeader(headers,[cols.week,'Week','Week Start','Week Ending'].filter(Boolean));
    meta.scoreColumn=findHeader(headers,[cols.score,'Score','Score %','QA Score'].filter(Boolean));
  }
  return meta;
}
function repFromResolvedColumns(row, headers, cols, meta, fallbacks=[]){
  const c={...(cols||{})};
  if(meta?.detectedNameColumns?.fullName) c.fullName=meta.detectedNameColumns.fullName;
  if(meta?.detectedNameColumns?.firstName) c.firstName=meta.detectedNameColumns.firstName;
  if(meta?.detectedNameColumns?.lastName) c.lastName=meta.detectedNameColumns.lastName;
  return repNameFromColumns(row,headers,c,fallbacks);
}
function normalizeImportedRowOnce(row, headers, cfg, source, meta, i){
  const cols=cfg.columns||{}, sourceArea=sourceAreaForSource(source);
  if(source==='qa' || source===QA_DIRECT_SOURCE){
    const q={...(SOURCE_SETTING_DEFAULTS.qa.columns||{}),...cols};
    const rep=repFromResolvedColumns(row,headers,{...q,nameMode:q.nameMode||'full',fullName:q.fullName||q.agent,convertLastFirst:!!q.convertLastFirst},meta,['Agent Name','AgentName']);
    const qaTeam=canonicalCoachName(row[meta.detectedTeamColumn]??'');
    const selectedDate=meta.detectedDateColumn?row[meta.detectedDateColumn]:'';
    const dateValue=cachedSourceDateValue(source,meta.detectedDateColumn||meta.interactionDateColumn,selectedDate || row[meta.interactionDateColumn]);
    return {...row,_rowId:`${source}:${i+1}`,_source:labelSource(source),_sourceKey:source,_sourceArea:'',_rep:rep,_repKey:nameKey(rep),_team:q.skipTeamBuild?'':qaTeam,_teamKey:q.skipTeamBuild?'':coachNameKey(qaTeam),_coach:q.skipTeamBuild?'':qaTeam,_coachKey:q.skipTeamBuild?'':coachNameKey(qaTeam),_qaTeam:qaTeam,_qaTeamKey:coachNameKey(qaTeam),_score:normalizeScore(row[meta.scoreColumn]),_interactionDate:row[meta.interactionDateColumn]||'',_interactionDateValue:cachedSourceDateValue(source,meta.interactionDateColumn,row[meta.interactionDateColumn]),_assignedDate:row[meta.assignedDateColumn]||'',_assignedDateValue:cachedSourceDateValue(source,meta.assignedDateColumn,row[meta.assignedDateColumn]),_date:selectedDate || row[meta.interactionDateColumn] || '',_dateValue:dateValue};
  }
  const defaults=SOURCE_SETTING_DEFAULTS[source]?.columns||SOURCE_SETTING_DEFAULTS.checklist.columns||{};
  const c={...defaults,...cols};
  const repFallbacks=source==='comp_calls'?['CSR/SSR Name (This is the person being complimented)','CSR/SSR Name','Representative','Associate Name','Associate','Agent Name','Rep']:(source==='documented_coaching'?['Associate name','Associate Name','Associate','Agent Name','Rep']:['Associate Name','Associate','Agent Name','Rep']);
  const rep=repFromResolvedColumns(row,headers,{...c,nameMode:c.nameMode||'full',fullName:c.fullName||c.rep,convertLastFirst:!!c.convertLastFirst},meta,repFallbacks);
  const directTeam=canonicalCoachName(row[meta.detectedTeamColumn]??'');
  const team=c.skipTeamBuild?'':directTeam;
  const dateRaw=meta.detectedDateColumn?row[meta.detectedDateColumn]:'';
  return {...row,_rowId:`${source}:${i+1}`,_source:labelSource(source),_sourceKey:source,_sourceArea:sourceArea,_rawRep:rep,_rawRepKey:fullNameIdentityKey(rep),_rep:rep,_repKey:fullNameIdentityKey(rep),_team:team,_teamKey:coachNameKey(team),_coach:team,_coachKey:coachNameKey(team),_rosterId:safeFallbackRosterIdentity({_rep:rep,_team:team},sourceArea),_date:dateRaw,_dateValue:dateRaw?cachedSourceDateValue(source,meta.detectedDateColumn,dateRaw):NaN,_week:meta.weekColumn?row[meta.weekColumn]:'',_text:meta.textColumn?String(row[meta.textColumn]??''):'',_score:meta.scoreColumn?normalizeScore(row[meta.scoreColumn]):NaN,_aliasApplied:false,_aliasRecord:null};
}
function commitImportedSource(source, file, pack, rows, cfg, meta, options={}){
  state.sourceMeta=state.sourceMeta||{}; state.categorizedFragments=state.categorizedFragments||{};
  const sourceVersion=meta.sourceVersion;
  meta.sourceVersion=sourceVersion;
  state.sourceMeta[source]={...(state.sourceMeta[source]||{}),...meta,sourceVersion,aliasVersionApplied:state.versions?.aliases||0,dirtyCategorized:true,lastImportedAt:new Date().toISOString(),lastImportDiagnostics:options.diagnostics||{}};
  if(isCustomSource(source)){ const c=customSource(source); if(c){ c.fileName=file?.name||c.fileName; c.headers=pack.headers; c.rows=rows; c.headerRow=cfg.headerRow; c.startCol=cfg.startCol; c.sheetName=cfg.sheetName||c.sheetName; c.manualHeaders=cfg.manualHeaders||[]; c.framework=cfg.framework||c.framework||'generic_table'; c.columns={...(c.columns||{}),...(cfg.columns||{})}; } markImportCacheDirty('misc','customSources',`${labelSource(source)} custom source updated`); }
  else if(source==='qa'){ state.data.qa={...state.data.qa,fileName:file.name,headers:pack.headers,rows}; }
  else if(source===QA_DIRECT_SOURCE){ state.data.qa_direct={fileName:file.name,headers:pack.headers,rows,aoa:getSourceAoa(source),sheetName:cfg.sheetName||''}; }
  else if(state.data[source]){ state.data[source]={...state.data[source],fileName:file.name,headers:pack.headers,rows}; }
  state.categorizedFragments[source]={sourceVersion,datedRows:null,nonDatedRows:null,dirty:true};
  markSourceCacheDirty(source,`${labelSource(source)} source rows updated`);
  markImportCacheDirty('misc','sourceMeta',`${labelSource(source)} source metadata updated`);
}
function sourceNameElement(source){ return source==='qa'?els.qaFileName:source===QA_DIRECT_SOURCE?els.qaDirectFileName:source==='comp_calls'?els.compCallsFileName:source==='documented_coaching'?els.documentedCoachingFileName:source==='checklist'?els.checklistFileName:null; }
async function finishSingleSourceIntake(source, reason, timing, counts){
  markDataIndexDirty(reason);
  // Non-roster imports should invalidate derived indexes but not rebuild Retail/Referral Control rosters or full team membership.
  selectiveResearchInvalidation({reason,source});
  setStatus(); renderEditModelSafe(); if(isCustomSource(source)) renderCustomSourcesList(); updateResearchCacheBadge();
  counts.render++;
  scheduleImportedDataSave(reason,{delay:500}); counts.cacheSave++;
  updateProgress(`${labelSource(source)} ready`,100,{force:true});
  await yieldToBrowser();
  timing.mark('Schedule save', 'one incremental IndexedDB save scheduled');
  console.info('[Import Timing Summary]', labelSource(source), {counts});
  timing.end('shared staged intake complete; team/categorized/research indexes remain lazy');
}
async function processImportedSource(source, file, options={}){
  const label=options.label||labelSource(source), timing=importTiming(`${label} intake`), counts={workbookParse:0,rowNormalization:0,teamRebuild:0,categorizedRebuild:0,indexRebuild:0,cacheSave:0,render:0};
  showProgress(`Reading ${label} file...`,3);
  beginDataUpdate(source);
  try{
    const wb=options.workbook || await readFileWorkbook(file); if(!options.workbook) counts.workbookParse++;
    timing.mark('Read/parse workbook', `${(wb.SheetNames||[]).length} sheets`);
    const m=activeModelForImport(); ensureSourceSettings(m);
    const settingSource=source===QA_DIRECT_SOURCE?'qa':source;
    const sn=options.sheetName || pickBestSheetForSource(wb,settingSource,m,SOURCE_SHEET_HINTS[settingSource]);
    const bookKey=options.bookKey || (source===QA_DIRECT_SOURCE?QA_DIRECT_SOURCE:source);
    if(!options.workbookAlreadyStored) await storeWorkbookAsync(bookKey,file,wb,`Preparing ${label} workbook`,12,24,{sheetNames:workbookSheetsNeededForImport(bookKey,wb,[sn])});
    const cfg=getSourceSetting(m,settingSource);
    cfg.sheetName=sn; if(m.sourceSettings?.[source]) m.sourceSettings[source].sheetName=sn;
    const aoa=options.aoa || sheetAoa(wb,sn);
    if(source!==QA_DIRECT_SOURCE){ state.books[sourceBookKey(source)].selectedSheets[source]=sn; setSourceAoa(source,aoa,sn); }
    else { setSourceAoa(source,aoa,sn); }
    updateProgress(`Detecting ${label} headers...`,28); await yieldToBrowser();
    const pack=await sheetRowsFromAoaAsync(aoa||[],Math.max(0,(Number(cfg.headerRow)||1)-1),Math.max(0,(Number(cfg.startCol)||1)-1),!isCustomSource(source),expectedHeadersForSource(settingSource,m),settingSource,m,cfg.manualHeaders||[],`Building ${label} rows`,28,42);
    if((pack.detected || pack.fullRow) && m.sourceSettings?.[settingSource]){ m.sourceSettings[settingSource].headerRow=pack.headerRow+1; m.sourceSettings[settingSource].startCol=pack.startCol+1; cfg.headerRow=pack.headerRow+1; cfg.startCol=pack.startCol+1; }
    const meta=buildHeaderMetadata(settingSource,pack.headers,cfg,pack);
    timing.mark('Detect headers', `${pack.headers.length} headers`);
    const rows=await mapRowsChunked(pack.rows,r=>normalizeImportedRowOnce(r,pack.headers,cfg,source,meta,counts.rowNormalization++),(r)=>source==='qa'||source===QA_DIRECT_SOURCE?(r._repKey||r._team||Number.isFinite(r._score)):(r._repKey||r._team),`Normalizing ${label} rows`,42,70);
    timing.mark(`Normalize ${rows.length.toLocaleString()} rows`, 'identity/team/date fields resolved once per row');
    commitImportedSource(source,file,pack,rows,cfg,meta,{diagnostics:{counts}});
    const nameEl=sourceNameElement(source); if(nameEl) nameEl.textContent=`${file.name} · ${sn}${source===QA_DIRECT_SOURCE?' · direct mode source':''}`;
    await finishSingleSourceIntake(source,`${label} import`,timing,counts);
    if(!options.fromCentral) await saveAllStarWorkbookToCoachTools(sharedDatasetTypeForAllStarSource(source),file,wb,`allstar-${source}`);
    return true;
  }catch(err){ console.error(err); alert(`${label} import failed. Check the console for details.`); return false; }
  finally{ state.dataUpdateBatch=null; hideProgress(); }
}

function sharedDatasetTypeForAllStarSource(source){
  return ({qa:'qa',checklist:'checklist',documented_coaching:'documentedCoaching',comp_calls:'compCoaching'})[source]||'';
}
function coachToolsParsedFromWorkbook(file,wb){
  const sheets=[...(wb?.SheetNames||[])], data={}; let totalRows=0;
  sheets.forEach(name=>{
    const raw=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,defval:''});
    const aoa=window.CoachToolsImport?.trimAOA?window.CoachToolsImport.trimAOA(raw):raw;
    data[name]={aoa}; totalRows+=aoa.length;
  });
  return {meta:{fileName:file?.name||'',fileSize:Number(file?.size)||0,fileModifiedDate:file?.lastModified?new Date(file.lastModified).toISOString():'',loadedAt:new Date().toISOString(),sheetsCount:sheets.length,totalRows},workbook:{sheets,data}};
}
async function saveAllStarWorkbookToCoachTools(datasetType,file,wb,method='allstar-import'){
  if(!datasetType||!window.CoachToolsData||!window.CoachToolsImport) return null;
  try{
    const parsed=coachToolsParsedFromWorkbook(file,wb);
    const period=window.CoachToolsImport.detectPeriod(file,datasetType);
    return await window.CoachToolsData.importDataset(datasetType,parsed,{originalFileName:file?.name||'',fileSize:Number(file?.size)||0,fileModifiedDate:file?.lastModified?new Date(file.lastModified).toISOString():'',rowCount:parsed.meta.totalRows,detectedPeriod:period,classificationMethod:method,validationStatus:'ready'});
  }catch(error){ console.warn('[All-Star] Shared CoachTools save failed; All-Star import remains available.',error); return null; }
}
function sheetJsWorkbookFromCoachToolsDataset(dataset){
  const workbook=XLSX.utils.book_new();
  for(const name of dataset?.workbook?.sheets||[]){
    const aoa=dataset.workbook.data?.[name]?.aoa||[];
    XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(aoa),String(name).slice(0,31)||'Data');
  }
  return workbook;
}
async function coachToolsDatasetFromAllStarBook(bookKey,datasetType){
  const book=state.books?.[bookKey]||{}, names=[...new Set(book.sheetNames||[])], data={}; let totalRows=0;
  for(const name of names){ const aoa=await ensureSheetLoaded(bookKey,name); if(aoa?.length){ data[name]={aoa}; totalRows+=aoa.length; } }
  const fallbacks={
    monthlyRetail:[['Retail SV2',state.data.retail.sv2Aoa],['Retail Wiper',state.data.retail.wiperAoa]],
    monthlyReferral:[['Referral SV2',state.data.referral.sv2Aoa],['Referral Wiper',state.data.referral.wiperAoa],['Referral ITAC',state.data.referral.itacAoa]],
    qa:[['QA',state.data.qa.aoa]],checklist:[['Checklist',state.data.checklist.aoa]],documentedCoaching:[['Documented Coaching',state.data.documented_coaching.aoa]],compCoaching:[['Comp Coaching',state.data.comp_calls.aoa]]
  };
  if(!Object.keys(data).length){ for(const [name,aoa] of fallbacks[datasetType]||[]){ if(aoa?.length){ data[name]={aoa}; totalRows+=aoa.length; } } }
  const sheets=Object.keys(data), fileName=book.fileName||({monthlyRetail:state.data.retail.fileName,monthlyReferral:state.data.referral.fileName,qa:state.data.qa.fileName,checklist:state.data.checklist.fileName,documentedCoaching:state.data.documented_coaching.fileName,compCoaching:state.data.comp_calls.fileName})[datasetType]||'';
  return sheets.length?{meta:{fileName,totalRows,sheetsCount:sheets.length,loadedAt:new Date().toISOString()},workbook:{sheets,data}}:null;
}
async function backfillCoachToolsDataFromAllStar(){
  if(!window.CoachToolsData||!window.CoachToolsImport) return {};
  const mappings=[['monthlyRetail','retail'],['monthlyReferral','referral'],['qa','qa'],['documentedCoaching','documented_coaching'],['checklist','checklist'],['compCoaching','comp_calls']], synced={};
  for(const [datasetType,bookKey] of mappings){
    if(await window.CoachToolsData.getCurrent(datasetType,{includeRecord:true})) continue;
    const dataset=await coachToolsDatasetFromAllStarBook(bookKey,datasetType);
    if(!dataset) continue;
    const period=window.CoachToolsImport.detectPeriod(dataset.meta.fileName,datasetType);
    const result=await window.CoachToolsData.importDataset(datasetType,dataset,{originalFileName:dataset.meta.fileName,rowCount:dataset.meta.totalRows,detectedPeriod:period,classificationMethod:'allstar-cache-migration',validationStatus:'ready'});
    if(result?.dataset?.id) synced[datasetType]=result.dataset.id;
  }
  return synced;
}
async function syncAllStarFromCoachToolsData(options={}){
  if(!window.CoachToolsData) return false;
  await window.CoachToolsData.ready();
  const mappings=[
    ['monthlyRetail',(file,wb)=>loadRetailFile(file,{workbook:wb,fromCentral:true})],
    ['monthlyReferral',(file,wb)=>loadReferralFile(file,{workbook:wb,fromCentral:true})],
    ['qa',(file,wb)=>processImportedSource('qa',file,{label:'QA Stats',bookKey:'qa',workbook:wb,fromCentral:true})],
    ['documentedCoaching',(file,wb)=>processImportedSource('documented_coaching',file,{label:'Documented Coaching',bookKey:'documented_coaching',workbook:wb,fromCentral:true})],
    ['checklist',(file,wb)=>processImportedSource('checklist',file,{label:'Checklist',bookKey:'checklist',workbook:wb,fromCentral:true})],
    ['compCoaching',(file,wb)=>processImportedSource('comp_calls',file,{label:'Comp Coaching',bookKey:'comp_calls',workbook:wb,fromCentral:true})]
  ];
  const syncKey='allStarCoachToolsSync.v1';
  let synced={}; try{ synced=JSON.parse(localStorage.getItem(syncKey)||'{}')||{}; }catch(_){ synced={}; }
  Object.assign(synced,await backfillCoachToolsDataFromAllStar());
  let loaded=0;
  for(const [datasetType,loader] of mappings){
    const record=await window.CoachToolsData.getCurrent(datasetType,{includeRecord:true});
    if(!record?.data?.workbook?.sheets?.length) continue;
    if(synced[datasetType]===record.id) continue;
    const wb=sheetJsWorkbookFromCoachToolsDataset(record.data);
    const file={name:record.originalFileName||`${datasetType}.xlsx`,size:record.fileSize||0,lastModified:Date.parse(record.fileModifiedDate||record.importedAt)||Date.now()};
    const ok=await loader(file,wb); if(ok===false) continue; synced[datasetType]=record.id; loaded++;
  }
  try{ localStorage.setItem(syncKey,JSON.stringify(synced)); }catch(_){}
  if(loaded>0) await categorizeImportedData({automatic:true,reason:options.reason||'central IndexedDB synchronization'});
  return loaded>0;
}

function renderCoachToolsImportReview(){
  if(!els.coachtoolsImportReview) return;
  const batch=state.coachToolsImportBatch||{recognized:[],needsReview:[],errors:[]};
  const rows=[];
  batch.recognized.forEach((entry,index)=>rows.push(`<div class="checkResultRow" data-shared-import-row="${index}"><strong>✓ ${esc(entry.classification.id&&window.CoachToolsImport.SOURCES[entry.classification.id]?.label||entry.classification.id)}</strong><div class="checkResultMeta">${esc(entry.file.name)} · ${esc(entry.classification.detectedPeriod?.label||'Current')} · Ready</div></div>`));
  batch.needsReview.forEach(entry=>rows.push(`<div class="checkResultRow"><strong>Needs Review · ${esc(entry.classification.predictedId&&window.CoachToolsImport.SOURCES[entry.classification.predictedId]?.label||'Unknown source')}</strong><div class="checkResultMeta">${esc(entry.file.name)} · ${esc(entry.classification.validation?.reason||'No compatible dataset structure was found.')}</div></div>`));
  batch.errors.forEach(entry=>rows.push(`<div class="checkResultRow"><strong>Could not read</strong><div class="checkResultMeta">${esc(entry.file?.name||'File')} · ${esc(entry.error?.message||String(entry.error))}</div></div>`));
  els.coachtoolsImportReview.innerHTML=rows.join('')||'<div class="checkResultMeta">No files staged.</div>';
  if(els.coachtoolsImportAllBtn) els.coachtoolsImportAllBtn.disabled=!batch.recognized.length;
  if(els.coachtoolsImportSummary) els.coachtoolsImportSummary.textContent=batch.recognized.length?`${batch.recognized.length} file${batch.recognized.length===1?'':'s'} recognized${batch.needsReview.length?` · ${batch.needsReview.length} need review`:''}.`:'Choose weekly, monthly, QA, MyOne, Checklist, and Comp Coaching files together.';
}
async function stageCoachToolsImportFiles(files){
  if(!window.CoachToolsImport) return alert('Shared CoachTools import utilities are unavailable.');
  showProgress('Analyzing CoachTools files...',5);
  try{
    state.coachToolsImportBatch=await window.CoachToolsImport.analyzeFiles(files,{onProgress:progress=>updateProgress(`Reading ${progress.fileName||'file'}${progress.sheetName?' · '+progress.sheetName:''}`,10+Math.round(70*((progress.fileIndex+(progress.total?progress.current/progress.total:0))/Math.max(1,progress.fileCount))))});
    renderCoachToolsImportReview(); updateProgress('Files analyzed',100,{force:true});
  }finally{ hideProgress(); }
}
async function importCoachToolsBatch(){
  const batch=state.coachToolsImportBatch;
  if(!batch?.recognized?.length) return;
  els.coachtoolsImportAllBtn.disabled=true;
  state.coachToolsBatchImportRunning=true;
  let imported=0, failed=0, categorizable=0, categorized=false;
  try{
    for(let index=0;index<batch.recognized.length;index++){
      const entry=batch.recognized[index], type=entry.classification.id;
      showProgress(`Importing ${window.CoachToolsImport.SOURCES[type]?.label||type}...`,Math.round(index/batch.recognized.length*100));
      try{
        let ok=true;
        if(type==='weeklyRetail'||type==='weeklyReferral') ok=!!(await window.CoachToolsImport.saveRecognizedEntry(entry));
        else if(type==='monthlyRetail') ok=await loadRetailFile(entry.file);
        else if(type==='monthlyReferral') ok=await loadReferralFile(entry.file);
        else if(type==='qa') ok=await loadQAFile(entry.file);
        else if(type==='documentedCoaching') ok=await loadChecklistLikeFile(entry.file,'documented_coaching');
        else if(type==='checklist') ok=await loadChecklistFile(entry.file);
        else if(type==='compCoaching') ok=await loadChecklistLikeFile(entry.file,'comp_calls');
        if(ok===false) failed++;
        else { imported++; if(type!=='weeklyRetail'&&type!=='weeklyReferral') categorizable++; }
      }catch(error){ console.error('[All-Star] Shared batch import failed',entry.file?.name,error); failed++; }
    }
    hideProgress();
    if(categorizable) categorized=await categorizeImportedData({automatic:true,reason:'shared multi-file upload'});
  }finally{
    state.coachToolsBatchImportRunning=false;
    hideProgress();
    els.coachtoolsImportAllBtn.disabled=false;
  }
  if(els.coachtoolsImportSummary) els.coachtoolsImportSummary.textContent=`CoachTools Data Ready · ${imported} source${imported===1?'':'s'} updated${categorized?' · Dated and Non-Date databases rebuilt':''}${failed?` · ${failed} failed`:''}.`;
}
function setSourceRowsAndHeaders(source, headers, rows, model){
  if(source===NONDATED_SOURCE || source===DATED_SOURCE){
    const normalizedRows=normalizeCategorizedRowsFromObjects(source, headers||[], rows||[]);
    if(source===NONDATED_SOURCE) state.categorized.nondated={...state.categorized.nondated,headers:(headers||[]).length?headers:['Representative','Coach'],rows:normalizedRows,builtAt:new Date().toISOString()};
    if(source===DATED_SOURCE) state.categorized.dated={...state.categorized.dated,headers:(headers||[]).length?headers:['Representative','Coach','Date'],rows:normalizedRows,builtAt:new Date().toISOString()};
  }
  if(source===NONDATED_SOURCE || source===DATED_SOURCE) markImportCacheDirty('misc','categorized',`${labelSource(source)} categorized rows updated`);
  if(isCustomSource(source)){ markImportCacheDirty('misc','customSources',`${labelSource(source)} custom source updated`); const c=customSource(source); if(c){ const cfg=getSourceSetting(model,source); c.headers=headers||[]; c.rows=(rows||[]).map(r=>normalizeCustomRow(r,headers||[],cfg.columns||{},source)); c.headerRow=cfg.headerRow; c.startCol=cfg.startCol; c.sheetName=cfg.sheetName||c.sheetName; c.manualHeaders=cfg.manualHeaders||[]; c.framework=cfg.framework||c.framework||'generic_table'; c.columns={...(c.columns||{}),...(cfg.columns||{})}; } }
  if(source==='retail_sv2'){ state.data.retail.headers.sv2=headers; state.data.retail.sv2=rows.map(r=>normalizeStatRow(r,'retail','sv2',getSourceSetting(model,source).columns,headers)); }
  if(source==='retail_wiper'){ state.data.retail.headers.wiper=headers; state.data.retail.wiper=rows.map(r=>normalizeStatRow(r,'retail','wiper',getSourceSetting(model,source).columns,headers)); }
  if(source==='retail_team_totals'){ const base=teamTotalsDataHeaders(headers||[]); const rows2=(rows||[]).map(r=>({...r,_sourceKey:'retail_team_totals',_team:canonicalCoachName(r._team||r['Full Team Name']||''),_teamKey:coachNameKey(r._team||r['Full Team Name']||''),_controlTab:r._controlTab||r['Control Tab']||'',_summaryLookupKey:r._summaryLookupKey||r['AA2 Lookup Key']||'',_summaryDisplayName:r._summaryDisplayName||r['Source Summary Name']||'',_summarySheet:r._summarySheet||r['Source Summary Sheet']||'Appt Summary',_summaryRowNumber:r._summaryRowNumber||r['Source Summary Row']||''})); state.data.retail.teamTotals=rebuildTeamTotalsIndex({...(state.data.retail.teamTotals||emptyTeamTotalsDataset('retail')),identitySchemaVersion:0,headers:base,rows:rows2}); }
  if(source==='referral_sv2'){ state.data.referral.headers.sv2=headers; state.data.referral.sv2=rows.map(r=>normalizeStatRow(r,'referral','sv2',getSourceSetting(model,source).columns,headers)); }
  if(source==='referral_wiper'){ state.data.referral.headers.wiper=headers; state.data.referral.wiper=rows.map(r=>normalizeStatRow(r,'referral','wiper',getSourceSetting(model,source).columns,headers)); }
  if(source==='referral_team_totals'){ const base=teamTotalsDataHeaders(headers||[]); const rows2=(rows||[]).map(r=>({...r,_sourceKey:'referral_team_totals',_team:canonicalCoachName(r._team||r['Full Team Name']||''),_teamKey:coachNameKey(r._team||r['Full Team Name']||''),_controlTab:r._controlTab||r['Control Tab']||'',_summaryLookupKey:r._summaryLookupKey||r['AA2 Lookup Key']||'',_summaryDisplayName:r._summaryDisplayName||r['Source Summary Name']||'',_summarySheet:r._summarySheet||r['Source Summary Sheet']||'KPI Summary',_summaryRowNumber:r._summaryRowNumber||r['Source Summary Row']||''})); state.data.referral.teamTotals=rebuildTeamTotalsIndex({...(state.data.referral.teamTotals||emptyTeamTotalsDataset('referral')),identitySchemaVersion:0,headers:base,rows:rows2}); }
  if(source==='qa'){ const q=getSourceSetting(model,'qa').columns||{}; state.data.qa.headers=headers; state.data.qa.rows=rows.map(r=>normalizeQARow(r,headers,q)).filter(r=>r._repKey||r._team||Number.isFinite(r._score)); }
  if(source==='checklist'){ const c=getSourceSetting(model,'checklist').columns||{}; state.data.checklist.headers=headers; state.data.checklist.rows=rows.map(r=>normalizeChecklistRow(r,headers,c,'checklist')).filter(r=>r._repKey||r._team); }
  if(source==='documented_coaching'){ const c=getSourceSetting(model,'documented_coaching').columns||{}; state.data.documented_coaching.headers=headers; state.data.documented_coaching.rows=rows.map(r=>normalizeChecklistRow(r,headers,c,'documented_coaching')).filter(r=>r._repKey||r._team); }
  if(source==='comp_calls'){ const c=getSourceSetting(model,'comp_calls').columns||{}; state.data.comp_calls.headers=headers; state.data.comp_calls.rows=rows.map(r=>normalizeChecklistRow(r,headers,c,'comp_calls')).filter(r=>r._repKey||r._team); }
  markSourceCacheDirty(source,`${labelSource(source)} rows updated`);
  markDataIndexDirty(`${labelSource(source)} rows updated`);
}

async function setSourceRowsAndHeadersAsync(source, headers, rows, model, label='Normalizing rows', start=40, end=55){
  rows=rows||[]; headers=headers||[];
  if(source===NONDATED_SOURCE || source===DATED_SOURCE){
    markImportCacheDirty('misc','categorized',`${labelSource(source)} categorized rows updated`);
    const normalizedRows=await mapRowsChunked(rows,r=>normalizeCategorizedRowsFromObjects(source,headers,[r])[0],null,label,start,end);
    if(source===NONDATED_SOURCE) state.categorized.nondated={...state.categorized.nondated,headers:headers.length?headers:['Representative','Coach'],rows:normalizedRows,builtAt:new Date().toISOString()};
    if(source===DATED_SOURCE) state.categorized.dated={...state.categorized.dated,headers:headers.length?headers:['Representative','Coach','Date'],rows:normalizedRows,builtAt:new Date().toISOString()};
  }else if(isCustomSource(source)){
    markImportCacheDirty('misc','customSources',`${labelSource(source)} custom source updated`);
    const c=customSource(source); if(c){ const cfg=getSourceSetting(model,source); c.headers=headers; c.rows=await mapRowsChunked(rows,r=>normalizeCustomRow(r,headers,cfg.columns||{},source),null,label,start,end); c.headerRow=cfg.headerRow; c.startCol=cfg.startCol; c.sheetName=cfg.sheetName||c.sheetName; c.manualHeaders=cfg.manualHeaders||[]; c.framework=cfg.framework||c.framework||'generic_table'; c.columns={...(c.columns||{}),...(cfg.columns||{})}; }
  }else{
    setSourceRowsAndHeaders(source,headers,rows,model);
  }
  markSourceCacheDirty(source,`${labelSource(source)} rows updated`);
  markDataIndexDirty(`${labelSource(source)} rows updated`);
}

function categorizedIdentityColumn(headers, kind){
  const repAliases=['Representative','Rep','Rep Name','Agent Name','Associate Name','Associate name','Associate','Employee Name','Name','CSR','SSR'];
  const coachAliases=['Coach','Coach Name','Team','Team Name','Manager','Supervisor','Leader','Coach Assigned','Assigned Coach','QA Coach','Team Lead','Job Coach'];
  const aliases=kind==='coach'?coachAliases:repAliases;
  return findHeader(headers||[], aliases) || (headers||[]).find(h=>{
    const n=norm(h);
    return kind==='coach' ? /(coach|team|manager|supervisor|leader)/.test(n) : /(representative|rep|agent|associate|employee|csr|ssr|name)/.test(n);
  }) || '';
}
function normalizeCategorizedRowsFromObjects(source, headers, rows){
  headers=headers||[];
  const repH=categorizedIdentityColumn(headers,'rep');
  const coachH=categorizedIdentityColumn(headers,'coach');
  const dateH=findHeader(headers,['Date','Interaction Date','Interaction Start Time','Assigned Date','Created Date','Week','Week Start','Week Ending','Month']) || headers.find(headerLooksLikeDateColumn) || '';
  return normalizeCategorizedRowsWithResolvedHeaders(source,headers,rows,repH,coachH,dateH);
}
function normalizeCategorizedRowsWithResolvedHeaders(source, headers, rows, repH, coachH, dateH){
  return (rows||[]).map(row=>{
    const out={...(row||{})};
    const rep=canonicalRepName(out._rep || (repH?out[repH]:'') || out.Representative || out['Agent Name'] || out['Associate Name'] || out['Associate name'] || out.Name || '');
    const team=canonicalCoachName(out._team || (coachH?out[coachH]:'') || out.Coach || out.Team || out['Coach Name'] || out['Team Name'] || '');
    if(rep) out._rep=rep;
    if(team) out._team=team;
    if(source===DATED_SOURCE && dateH && out[dateH]!==undefined) out._date=parseDateOnly(out[dateH]) || out[dateH];
    else if(out.Date!==undefined) out._date=parseDateOnly(out.Date) || out.Date;
    out._repKey=out._repKey || nameKey(rep || out.Representative || out[repH]);
    return out;
  }).filter(row=>Object.keys(row||{}).some(h=>!String(h).startsWith('_') && String(row[h]??'').trim()!==''));
}
function categorizedHeadersFromAoa(aoa){
  const headers=(aoa?.[0]||[]).map(h=>String(h??'').trim()).filter(Boolean);
  const rawRows=(aoa||[]).slice(1).map(arr=>{
    const row={}; let any=false;
    headers.forEach((h,i)=>{ const v=arr?.[i]??''; if(String(v).trim()!=='') any=true; row[h]=v; });
    return any?row:null;
  }).filter(Boolean);
  return {headers,rows:normalizeCategorizedRowsFromObjects('',headers,rawRows)};
}
async function categorizedHeadersFromAoaAsync(aoa, label='Importing categorized rows', start=25, end=50){
  const headers=(aoa?.[0]||[]).map(h=>String(h??'').trim()).filter(Boolean);
  const repH=categorizedIdentityColumn(headers,'rep'), coachH=categorizedIdentityColumn(headers,'coach');
  const dateH=findHeader(headers,['Date','Interaction Date','Interaction Start Time','Assigned Date','Created Date','Week','Week Start','Week Ending','Month']) || headers.find(headerLooksLikeDateColumn) || '';
  const rawRows=[];
  await forEachChunked((aoa||[]).slice(1), arr=>{
    const row={}; let any=false;
    headers.forEach((h,i)=>{ const v=arr?.[i]??''; if(String(v).trim()!=='') any=true; row[h]=v; });
    if(any) rawRows.push(row);
  }, label, start, Math.min(end,start+(end-start)*.55));
  const rows=await mapRowsChunked(rawRows,r=>normalizeCategorizedRowsWithResolvedHeaders('',headers,[r],repH,coachH,dateH)[0],null,`${label} · normalizing`,Math.min(end,start+(end-start)*.55),end);
  return {headers,rows};
}
function setCategorizedRowsFromAoa(source, aoa){
  const pack=categorizedHeadersFromAoa(aoa||[]);
  const rows=normalizeCategorizedRowsFromObjects(source, pack.headers, pack.rows);
  if(source===DATED_SOURCE) state.categorized.dated={...state.categorized.dated,headers:pack.headers.length?pack.headers:['Representative','Coach','Date'],rows,builtAt:new Date().toISOString()};
  if(source===NONDATED_SOURCE) state.categorized.nondated={...state.categorized.nondated,headers:pack.headers.length?pack.headers:['Representative','Coach'],rows,builtAt:new Date().toISOString()};
}
async function setCategorizedRowsFromAoaAsync(source, aoa){
  const pack=await categorizedHeadersFromAoaAsync(aoa||[],`Importing packaged ${labelSource(source)} rows`,25,52);
  const repH=categorizedIdentityColumn(pack.headers,'rep'), coachH=categorizedIdentityColumn(pack.headers,'coach');
  const dateH=findHeader(pack.headers,['Date','Interaction Date','Interaction Start Time','Assigned Date','Created Date','Week','Week Start','Week Ending','Month']) || pack.headers.find(headerLooksLikeDateColumn) || '';
  const rows=await mapRowsChunked(pack.rows,r=>normalizeCategorizedRowsWithResolvedHeaders(source,pack.headers,[r],repH,coachH,dateH)[0],null,`Indexing packaged ${labelSource(source)} rows`,52,58);
  if(source===DATED_SOURCE) state.categorized.dated={...state.categorized.dated,headers:pack.headers.length?pack.headers:['Representative','Coach','Date'],rows,builtAt:new Date().toISOString()};
  if(source===NONDATED_SOURCE) state.categorized.nondated={...state.categorized.nondated,headers:pack.headers.length?pack.headers:['Representative','Coach'],rows,builtAt:new Date().toISOString()};
}
function dotHeaderPart(v){ return String(v||'').trim().toLowerCase().replace(/[%]/g,' percent ').replace(/&/g,' and ').replace(/[^a-z0-9]+/g,'.').replace(/^\.+|\.+$/g,'') || 'field'; }
function sourceColumnPrefix(source){
  const label=labelSource(source)||source||'source';
  return dotHeaderPart(label.replace(/\bDatabase\b/ig,''));
}
function outputHeaderForColumn(source, header, used, preferred=''){
  const raw=plainHeaderName(preferred||header);
  if(!raw || ['_rep','_repKey','_team','_date','_week','_text','_score','_dept','_part'].includes(raw)) return '';
  const base=`${sourceColumnPrefix(source)}.${dotHeaderPart(raw)}`;
  let final=base, i=2;
  while(used.has(final)) final=`${base}.${i++}`;
  used.add(final);
  return final;
}
function sourceDateHeader(source, headers){
  const cfg=getSourceSetting(activeModelForImport(),source);
  return selectedDateHeaderForSource(source,headers,cfg.columns||{});
}
function sourceHasDateHeader(source, headers){
  if(sourceAlwaysNonDated(source)) return false;
  return !!sourceDateHeader(source,headers);
}
function bestDateForCategorizedRow(source,row,headers){
  if(sourceAlwaysNonDated(source)) return null;
  if(source==='qa') return parseDateOnly(row._interactionDate||row._assignedDate||row._date);
  if(source===DATED_SOURCE || source===NONDATED_SOURCE) return parseDateOnly(row.Date||row._date);
  if(isCustomSource(source)){
    const c=customSource(source)||{}, cols=c.columns||{};
    return parseDateOnly((cols.date&&row[cols.date])||row._date) || parseWeekLabel((cols.week&&row[cols.week])||row._week, cols.weekStart) || parseDateOnly(cols.month&&row[cols.month]);
  }
  const explicit=sourceDateHeader(source,headers||getHeaders(source));
  if(explicit) return parseDateOnly(row[explicit]) || parseWeekLabel(row[explicit]);
  for(const h of (headers||getHeaders(source)||[])){
    if(headerLooksLikeDateColumn(h)){
      const d=parseDateOnly(row[h]) || parseWeekLabel(row[h]);
      if(d) return d;
    }
  }
  return null;
}
function categorizedKnownTeamByRep(){
  const teamMembers=new Map(), rowCounts=new Map(), repCandidates=new Map();
  const trusted=trustedRosterMaps();
  if(trusted.byRep.size){
    trusted.byRep.forEach((rec,key)=>{
      if(!rec.team) return;
      if(!teamMembers.has(rec.team)) teamMembers.set(rec.team,new Set());
      teamMembers.get(rec.team).add(key);
    });
    return {chosen:new Map([...trusted.byRep.entries()].map(([key,rec])=>[key,rec.team])),teamMembers,usingTrustedRoster:true};
  }
  allSourceKeys().filter(src=>!isCategorizedSource(src)).forEach(src=>{
    if(sourceSkipsTeamBuild(src)) return;
    (getRowsRaw(src)||[]).forEach(r=>{
      const rep=cleanName(r._rep||''), key=nameKey(rep), team=cleanName(r._team||'');
      if(!key||!team) return;
      if(!teamMembers.has(team)) teamMembers.set(team,new Set());
      teamMembers.get(team).add(key);
      const pair=key+'\u0000'+team;
      rowCounts.set(pair,(rowCounts.get(pair)||0)+1);
      if(!repCandidates.has(key)) repCandidates.set(key,new Set());
      repCandidates.get(key).add(team);
    });
  });
  const chosen=new Map();
  repCandidates.forEach((teams,key)=>{
    let best='', bestSize=-1, bestRows=-1;
    teams.forEach(team=>{
      const size=teamMembers.get(team)?.size||0, rows=rowCounts.get(key+'\u0000'+team)||0;
      if(size>bestSize || (size===bestSize && rows>bestRows) || (size===bestSize && rows===bestRows && team.localeCompare(best)<0)){
        best=team; bestSize=size; bestRows=rows;
      }
    });
    if(best) chosen.set(key,best);
  });
  return {chosen,teamMembers};
}
function mergeCategorizedCell(row, header, value){
  if(value===null||value===undefined||String(value).trim()==='') return;
  if(row[header]===undefined || row[header]===''){ row[header]=value; return; }
  const a=toNum(row[header]), b=toNum(value);
  if(Number.isFinite(a) && Number.isFinite(b)){ row[header]=a+b; return; }
  const vals=String(row[header]).split(';').map(x=>x.trim()).filter(Boolean);
  const incoming=String(value).trim();
  if(incoming && !vals.some(x=>normalizeResearchText(x)===normalizeResearchText(incoming))) vals.push(incoming);
  row[header]=vals.join('; ');
}
function categorizedSourceRowsForBuild(){
  return allSourceKeys().filter(src=>!isCategorizedSource(src)&&!TEAM_TOTAL_SOURCE_KEYS.includes(src)).map(src=>({source:src,headers:getHeaders(src)||[],rows:getRowsRaw(src)||[]}));
}
function buildCategorizedHeaderMaps(packs){
  const nondateUsed=new Set(['Representative','Coach']), dateUsed=new Set(['Representative','Coach','Date','Source']);
  const maps=new Map();
  packs.forEach(pack=>{
    const source=pack.source, headers=pack.headers||[], hasDate=sourceHasDateHeader(source,headers);
    const nondate=new Map(), dated=new Map();
    headers.forEach(h=>{
      const clean=plainHeaderName(h);
      if(!clean) return;
      const target=outputHeaderForColumn(source,clean,hasDate?dateUsed:nondateUsed);
      if(!target) return;
      if(hasDate) dated.set(clean,target);
      else nondate.set(clean,target);
    });
    maps.set(source,{nondate,dated,hasDate});
  });
  return maps;
}
function renderCategorizedSummary(){
  if(!els.categorizedDataSummary) return;
  const nd=state.categorized.nondated, dt=state.categorized.dated, built=nd.builtAt||dt.builtAt;
  const warnings=(state.categorized.warnings||[]).slice(0,2);
  els.categorizedDataSummary.textContent=built
    ? `Categorized ${Number(nd.rows?.length||0).toLocaleString()} non-date reps and ${Number(dt.rows?.length||0).toLocaleString()} dated rows. Use !nondate.Column or !date.Column in Research, Metrics, and Models.${warnings.length?' '+warnings.join(' '):''}`
    : 'Categorized database not built yet.';
}
function renderSpreadsheetDataPreview(){
  const box=els.spreadsheetDataPreview;
  if(!box) return;
  box.classList.toggle('hidden');
  if(box.classList.contains('hidden')) return;
  const sources=allSourceKeys().filter(src=>(getHeaders(src)||[]).length || (getRowsRaw(src)||[]).length);
  if(!sources.length){ box.innerHTML='<div class="checkResultMeta">No spreadsheet data imported yet.</div>'; return; }
  box.innerHTML=sources.map(src=>{
    const headers=getHeaders(src)||[], rows=getRowsRaw(src)||[], shown=rows.slice(0,50);
    const table=headers.length ? `<div class="tableWrap"><table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${shown.map(r=>`<tr>${headers.map(h=>`<td>${esc(r[h]??'')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<div class="checkResultMeta">No headers detected.</div>';
    return `<details class="panel"><summary><strong>${esc(labelSource(src))}</strong> <span class="badge">${rows.length.toLocaleString()} rows</span> <span class="badge">${headers.length} headers</span></summary><div class="checkResultMeta">${headers.map(esc).join(' | ')||'No headers'}</div><div class="checkResultMeta">Showing first ${shown.length.toLocaleString()} rows.</div>${table}</details>`;
  }).join('');
}
async function categorizeImportedData(options={}){
  const automatic=!!options.automatic;
  const packs=categorizedSourceRowsForBuild().filter(p=>(p.rows||[]).length);
  if(!packs.length){ if(!automatic) alert('Import data before categorizing.'); return false; }
  const timing=importTiming('categorization');
  showProgress(automatic?'Auto-categorizing Dated and Non-Date data...':'Preparing categorized databases...',4);
  try{
    await yieldToBrowser();
    updateProgress('Building date and non-date datasets...',6);
    await yieldToBrowser();
    const teamInfo=categorizedKnownTeamByRep();
    timing.mark('categorization', 'known team lookup prepared');
    const headerMaps=buildCategorizedHeaderMaps(packs);
    timing.mark('preparing headers/dropdowns', `${packs.length} source header maps`);
    const nondateByRep=new Map(), datedRows=[], missingCoachRows=[];
    const nondateHeaders=['Representative','Coach'], datedHeaders=['Representative','Coach','Date','Source'];
    headerMaps.forEach(map=>{ map.nondate.forEach(h=>{ if(!nondateHeaders.includes(h)) nondateHeaders.push(h); }); map.dated.forEach(h=>{ if(!datedHeaders.includes(h)) datedHeaders.push(h); }); });
    const total=Math.max(1,packs.reduce((n,p)=>n+(p.rows||[]).length,0)); let done=0;
    for(const pack of packs){
      const maps=headerMaps.get(pack.source)||{nondate:new Map(),dated:new Map(),hasDate:false};
      for(const row of pack.rows||[]){
        const rep=cleanName(row._rep||''), key=row._rosterId || safeFallbackRosterIdentity(row,sourceAreaForSource(pack.source)||row._sourceArea||'');
        if(!key){ done++; continue; }
        const directCoach=sourceSkipsTeamBuild(pack.source) ? '' : canonicalCoachName(rowTeam(row)||row._team||'');
        const coach=canonicalCoachName(directCoach||teamInfo.chosen.get(row._repKey||fullNameIdentityKey(rep))||(teamInfo.usingTrustedRoster?NA_TEAM:''));
        if(!coach) missingCoachRows.push(rep);
        const date=bestDateForCategorizedRow(pack.source,row,pack.headers);
        if(maps.hasDate){
          const out={Representative:rep,Coach:coach||'',Date:date?ymd(date):'',Source:labelSource(pack.source),_rep:rep,_repKey:row._repKey||fullNameIdentityKey(rep),_rosterId:row._rosterId||key,_rawRep:row._rawRep||rep,_team:coach||'',_sourceArea:sourceAreaForSource(pack.source)||row._sourceArea||'',_sourceKey:pack.source,_sourceRow:row._sourceRow||row.rowNumber||'',_date:date||null};
          maps.dated.forEach((target,srcHeader)=>{ out[target]=row[srcHeader]??''; });
          datedRows.push(out);
        }else{
          if(!nondateByRep.has(key)) nondateByRep.set(key,{Representative:rep,Coach:coach||'',_rep:rep,_repKey:row._repKey||fullNameIdentityKey(rep),_rosterId:row._rosterId||key,_rawRep:row._rawRep||rep,_team:coach||'',_sourceArea:sourceAreaForSource(pack.source)||row._sourceArea||'',_sourceRows:[]});
          const out=nondateByRep.get(key);
          out._sourceRows=out._sourceRows||[]; out._sourceRows.push({source:pack.source,row:row._sourceRow||row.rowNumber||'',rawRep:row._rawRep||rep});
          if(coach && !out.Coach){ out.Coach=coach; out._team=coach; }
          maps.nondate.forEach((target,srcHeader)=>mergeCategorizedCell(out,target,row[srcHeader]));
        }
        done++;
        if(done%900===0){ updateProgress(`Categorizing rows... ${done.toLocaleString()} / ${total.toLocaleString()}`, 8 + 72*(done/total)); await yieldToBrowser(); }
      }
    }
    const warnings=[];
    const unknown=[...new Set(missingCoachRows.map(cleanName).filter(Boolean))];
    if(unknown.length) warnings.push(`${unknown.length.toLocaleString()} reps had no coach in any imported source; their Coach cell was left blank.`);
    if(unknown.length && !automatic && !confirm(`${unknown.length.toLocaleString()} representative name${unknown.length===1?'':'s'} could not be tied to a coach/team from any imported source. Proceed and categorize the rest anyway?`)){
      updateProgress('Categorize cancelled before saving.',100);
      return false;
    }
    const nonRows=[...nondateByRep.values()].sort((a,b)=>(a.Coach||'').localeCompare(b.Coach||'')||a.Representative.localeCompare(b.Representative));
    datedRows.sort((a,b)=>(a.Date||'').localeCompare(b.Date||'')||(a.Coach||'').localeCompare(b.Coach||'')||a.Representative.localeCompare(b.Representative));
    const nondateStats=packs.filter(p=>!(headerMaps.get(p.source)||{}).hasDate).map(p=>({source:p.source,rows:p.rows.length}));
    const datedStats=packs.filter(p=>(headerMaps.get(p.source)||{}).hasDate).map(p=>({source:p.source,rows:p.rows.length}));
    state.categorized.nondated={headers:nondateHeaders,rows:nonRows,builtAt:new Date().toISOString(),sourceStats:nondateStats};
    state.categorized.dated={headers:datedHeaders,rows:datedRows,builtAt:new Date().toISOString(),sourceStats:datedStats};
    state.categorized.warnings=warnings;
    timing.mark('building date/non-date datasets', `${nonRows.length.toLocaleString()} non-date, ${datedRows.length.toLocaleString()} dated`);
    updateProgress('Finalizing categorized import...',86); await yieldToBrowser();
    markImportCacheDirty('misc','categorized','categorized database build');
    markImportCacheDirty('misc','sourceMeta','categorized database build');
    await finishDataChanged('categorized database build',88);
    updateProgress('Saving categorized databases to IndexedDB...',97,{force:true});
    await flushImportCacheSave('categorized database build complete');
    renderCategorizedSummary();
    timing.mark('rendering previews', 'summary only; full preview deferred until opened');
    timing.end('categorize complete');
    return true;
  }catch(err){ console.error(err); if(!automatic) alert('Categorize failed. Check the console for details.'); return false; }
  finally{ hideProgress(); }
}

function packageSheetToSource(sheetName){
  const n=norm(sheetName);
  if(n===norm('Non-Date Database') || n===norm('Nondate Database') || n===norm('Non-Date') || n===norm('nondate')) return NONDATED_SOURCE;
  if(n===norm('Dated Database') || n===norm('Dated') || n===norm('Date Database') || n===norm('date')) return DATED_SOURCE;
  const customHit=(state.customSources||[]).find(c=>norm(c.name)===n || norm(c.sourceKey)===n || norm('Custom '+c.name)===n); if(customHit) return customHit.sourceKey;
  if(!n) return '';
  const exact=Object.entries(PACKAGE_SHEETS).find(([,label])=>norm(label)===n);
  if(exact) return exact[0];
  const hasRetail=/retail/.test(n), hasReferral=/referral/.test(n);
  const hasWiper=/wipers?/.test(n), hasSv2=/sv2/.test(n);
  if(hasRetail && !hasReferral){ if(hasWiper) return 'retail_wiper'; if(hasSv2) return 'retail_sv2'; }
  if(hasReferral && !hasRetail){ if(hasWiper) return 'referral_wiper'; if(hasSv2) return 'referral_sv2'; }
  if((/genesys/.test(n) && /evaluation/.test(n)) || n==='qa' || /quality/.test(n)) return 'qa';
  if(/documentedcoaching|coaching/.test(n)) return 'documented_coaching';
  if(/compliments?|compcalls?|compcall/.test(n)) return 'comp_calls';
  if(/checklist|checkitems|items/.test(n)) return 'checklist';
  return '';
}
function packageRowsToAoa(headers, rows){
  const cleanHeaders=(headers||[]).map(h=>String(h??'').trim()).filter(Boolean);
  return [cleanHeaders, ...(rows||[]).map(row=>cleanHeaders.map(h=>row?.[h] ?? ''))];
}
function sourcePackageAoa(source){
  if(source===NONDATED_SOURCE) return packageRowsToAoa(state.categorized.nondated.headers,state.categorized.nondated.rows);
  if(source===DATED_SOURCE) return packageRowsToAoa(state.categorized.dated.headers,state.categorized.dated.rows);
  if(isCustomSource(source)){ const c=customSource(source)||{}; return packageRowsToAoa(c.headers,c.rows); }
  if(source==='retail_sv2') return packageRowsToAoa(state.data.retail.headers.sv2,state.data.retail.sv2);
  if(source==='retail_wiper') return packageRowsToAoa(state.data.retail.headers.wiper,state.data.retail.wiper);
  if(source==='retail_team_totals') return teamTotalsExportAoa(state.data.retail.teamTotals||emptyTeamTotalsDataset('retail'));
  if(source==='referral_sv2') return packageRowsToAoa(state.data.referral.headers.sv2,state.data.referral.sv2);
  if(source==='referral_wiper') return packageRowsToAoa(state.data.referral.headers.wiper,state.data.referral.wiper);
  if(source==='referral_team_totals') return teamTotalsExportAoa(state.data.referral.teamTotals||emptyTeamTotalsDataset('referral'));
  if(source==='qa') return packageRowsToAoa(state.data.qa.headers,state.data.qa.rows);
  if(source==='checklist') return packageRowsToAoa(state.data.checklist.headers,state.data.checklist.rows);
  if(source==='documented_coaching') return packageRowsToAoa(state.data.documented_coaching.headers,state.data.documented_coaching.rows);
  if(source==='comp_calls') return packageRowsToAoa(state.data.comp_calls.headers,state.data.comp_calls.rows);
  return [[]];
}
const PACKAGE_EXPORT_CHUNK_SIZE=1000;
function sourcePackageTable(source){
  if(source===NONDATED_SOURCE) return {headers:state.categorized.nondated.headers,rows:state.categorized.nondated.rows};
  if(source===DATED_SOURCE) return {headers:state.categorized.dated.headers,rows:state.categorized.dated.rows};
  if(isCustomSource(source)){ const c=customSource(source)||{}; return {headers:c.headers,rows:c.rows}; }
  if(source==='retail_sv2') return {headers:state.data.retail.headers.sv2,rows:state.data.retail.sv2};
  if(source==='retail_wiper') return {headers:state.data.retail.headers.wiper,rows:state.data.retail.wiper};
  if(source==='referral_sv2') return {headers:state.data.referral.headers.sv2,rows:state.data.referral.sv2};
  if(source==='referral_wiper') return {headers:state.data.referral.headers.wiper,rows:state.data.referral.wiper};
  if(source==='referral_itac') return {headers:state.data.referral.headers.itac,rows:state.data.referral.itac};
  if(source==='qa') return {headers:state.data.qa.headers,rows:state.data.qa.rows};
  if(source===QA_DIRECT_SOURCE) return {headers:state.data.qa_direct?.headers||[],rows:state.data.qa_direct?.rows||[]};
  if(source==='checklist') return {headers:state.data.checklist.headers,rows:state.data.checklist.rows};
  if(source==='documented_coaching') return {headers:state.data.documented_coaching.headers,rows:state.data.documented_coaching.rows};
  if(source==='comp_calls') return {headers:state.data.comp_calls.headers,rows:state.data.comp_calls.rows};
  if(source==='retail_team_totals' || source==='referral_team_totals'){
    const area=source==='retail_team_totals'?'retail':'referral';
    const aoa=teamTotalsExportAoa(state.data[area].teamTotals||emptyTeamTotalsDataset(area));
    return {headers:aoa[0]||[],rows:aoa.slice(1),arrayRows:true};
  }
  return {headers:[],rows:[]};
}
async function packageSourceSheetChunked(source, table, reportProgress){
  const headers=(table.headers||[]).map(h=>String(h??'').trim()).filter(Boolean);
  const rows=table.rows||[];
  const ws=XLSX.utils.aoa_to_sheet(headers.length?[headers]:[[]],{dense:true});
  for(let start=0;start<rows.length;start+=PACKAGE_EXPORT_CHUNK_SIZE){
    const end=Math.min(rows.length,start+PACKAGE_EXPORT_CHUNK_SIZE), batch=[];
    for(let i=start;i<end;i++){
      const row=rows[i];
      batch.push(table.arrayRows ? headers.map((_,col)=>row?.[col]??'') : headers.map(h=>row?.[h]??''));
    }
    if(batch.length) XLSX.utils.sheet_add_aoa(ws,batch,{origin:{r:start+1,c:0}});
    reportProgress(end-start);
    await yieldToBrowser();
  }
  if(!rows.length){ reportProgress(1); await yieldToBrowser(); }
  return ws;
}
async function packageImportedData(){
  const hasReusableData=allSourceKeys().some(source=>(getRowsRaw(source)||[]).length)||(state.data.referral.itac||[]).length||controlRosterRows().length||(state.data.retail.teamTotals?.rows||[]).length||(state.data.referral.teamTotals?.rows||[]).length;
  if(!(state.categorized.nondated.rows||[]).length && !(state.categorized.dated.rows||[]).length){
    await categorizeImportedData();
    if(!hasReusableData && !(state.categorized.nondated.rows||[]).length && !(state.categorized.dated.rows||[]).length) return;
  }
  const packageButton=els.packageDataBtn;
  if(packageButton) packageButton.disabled=true;
  showProgress('Preparing data package...',2);
  try{
    const packageData=buildAllStarJsonPackage();
    updateProgress(`Serializing ${packageData.statistics.totalRows.toLocaleString()} normalized rows...`,72,{force:true}); await yieldToBrowser();
    const json=JSON.stringify(packageData);
    updateProgress('Writing JSON package...',94,{force:true}); await yieldToBrowser();
    const blob=new Blob([json],{type:'application/json'}), a=document.createElement('a');
    a.href=URL.createObjectURL(blob); a.download='All_Star_Data_Package.json'; document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},0);
    updateProgress('Data package complete.',100,{force:true});
  }catch(err){
    console.error(err);
    alert('Package Imported Data failed: '+String(err?.message||err));
  }finally{
    if(packageButton) packageButton.disabled=false;
    hideProgress();
  }
}
const ALL_STAR_JSON_PACKAGE_TYPE='allstar-data-package';
const ALL_STAR_JSON_PACKAGE_SCHEMA=1;
const JSON_PACKAGE_SOURCE_KEYS=['retail_sv2','retail_wiper','referral_sv2','referral_wiper','referral_itac','qa',QA_DIRECT_SOURCE,'checklist','documented_coaching','comp_calls'];
function jsonPackageSourceRecord(source){
  const table=sourcePackageTable(source), book=bookForSource(source)||{};
  return {headers:[...(table.headers||[])],rows:table.arrayRows?[]:(table.rows||[]),fileName:sourceFileName(source)||'',selectedWorksheet:book.selectedSheets?.[source]||state.sourceMeta?.[source]?.selectedWorksheet||'',sourceVersion:Number(state.sourceMeta?.[source]?.sourceVersion||0)};
}
function jsonSafeTeamTotals(source){
  const area=source==='referral_team_totals'?'referral':'retail', ds=state.data[area].teamTotals||emptyTeamTotalsDataset(area);
  return {fileName:ds.fileName||'',sheetName:ds.sheetName||'',headers:[...(ds.headers||[])],rows:ds.rows||[],mappings:ds.mappings||[],diagnostics:ds.diagnostics||{},rowsVersion:Number(ds.rowsVersion||0),identitySchemaVersion:Number(ds.identitySchemaVersion||TEAM_TOTAL_IDENTITY_SCHEMA_VERSION),identityHeader:ds.identityHeader||''};
}
function buildAllStarJsonPackage(){
  const sources={}; JSON_PACKAGE_SOURCE_KEYS.forEach(source=>{ sources[source]=jsonPackageSourceRecord(source); });
  const customSources=(state.customSources||[]).map(c=>({id:c.id||id(),sourceKey:c.sourceKey,name:c.name||c.sourceKey,displayName:c.displayName||c.name||c.sourceKey,sourceType:'custom',framework:c.framework||'generic_table',fileName:c.fileName||'',sheetName:c.sheetName||'',headers:c.headers||[],rows:c.rows||[],headerRow:Number(c.headerRow||1),startCol:Number(c.startCol||1),manualHeaders:c.manualHeaders||[],columns:c.columns||{},aggregation:c.aggregation||{}}));
  const categorized={nondated:{headers:state.categorized.nondated.headers||[],rows:state.categorized.nondated.rows||[],builtAt:state.categorized.nondated.builtAt||'',sourceStats:state.categorized.nondated.sourceStats||[]},dated:{headers:state.categorized.dated.headers||[],rows:state.categorized.dated.rows||[],builtAt:state.categorized.dated.builtAt||'',sourceStats:state.categorized.dated.sourceStats||[]},warnings:state.categorized.warnings||[]};
  const totalRows=Object.values(sources).reduce((n,s)=>n+(s.rows||[]).length,0)+customSources.reduce((n,s)=>n+(s.rows||[]).length,0)+(categorized.nondated.rows||[]).length+(categorized.dated.rows||[]).length;
  return {packageType:ALL_STAR_JSON_PACKAGE_TYPE,schemaVersion:ALL_STAR_JSON_PACKAGE_SCHEMA,createdAt:new Date().toISOString(),appVersion:'all-star-modular',sources,rosters:{retail:state.data.retail.controlRoster||[],referral:state.data.referral.controlRoster||[]},teamTotals:{retail:jsonSafeTeamTotals('retail_team_totals'),referral:jsonSafeTeamTotals('referral_team_totals')},categorized,customSources,sourceMeta:state.sourceMeta||{},categorizedFragments:state.categorizedFragments||{},organizations:state.orgs||[],sourceSettings:{activeModelId:activeModelForImport()?.id||'',byModel:Object.fromEntries((state.models||[]).map(m=>[m.id,m.sourceSettings||{}]))},sourceFiles:{retail:state.data.retail.fileName||'',referral:state.data.referral.fileName||''},statistics:{totalRows,sourceCount:Object.keys(sources).length+customSources.length}};
}
async function rebuildSourceFromPackage(source, sheetName, model){
  const book=bookForSource(source), aoa=(book.aoaBySheet||{})[sheetName] || [];
  if(isCategorizedSource(source)){
    await setCategorizedRowsFromAoaAsync(source,aoa);
    return;
  }
  setSourceAoa(source,aoa,sheetName);
  const cfg=getSourceSetting(model,source);
  cfg.sheetName=sheetName; cfg.headerRow=1; cfg.startCol=1; cfg.manualHeaders=[];
  const pack=await sheetRowsFromAoaAsync(aoa,0,0,true,expectedHeadersForSource(source,model),source,model,[],`Building ${labelSource(source)} dataset`,25,45);
  await setSourceRowsAndHeadersAsync(source,pack.headers,pack.rows,model,`Importing ${labelSource(source)} rows`,45,55);
}
function emptyJsonHydratedData(){
  return {
    retail:{fileName:'',rosterFileName:'',rosterUpdatedAt:'',sv2:[],wiper:[],sv2Aoa:[],wiperAoa:[],controlRoster:[],teamTotals:emptyTeamTotalsDataset('retail'),headers:{sv2:[],wiper:[]}},
    referral:{fileName:'',rosterFileName:'',rosterUpdatedAt:'',sv2:[],wiper:[],itac:[],sv2Aoa:[],wiperAoa:[],itacAoa:[],controlRoster:[],teamTotals:emptyTeamTotalsDataset('referral'),headers:{sv2:[],wiper:[],itac:[]},itacSheetName:''},
    qa:{fileName:'',rows:[],headers:[],aoa:[]},qa_direct:{fileName:'',rows:[],headers:[],aoa:[],sheetName:''},checklist:{fileName:'',rows:[],headers:[],aoa:[]},documented_coaching:{fileName:'',rows:[],headers:[],aoa:[]},comp_calls:{fileName:'',rows:[],headers:[],aoa:[]}
  };
}
function validateJsonPackageRecord(record,label){
  if(!record || !Array.isArray(record.headers) || !Array.isArray(record.rows)) throw new Error(`Missing source data: ${label}.`);
  return record;
}
function stageJsonSource(nextData,source,record){
  record=validateJsonPackageRecord(record,labelSource(source)||source); const headers=record.headers, rows=record.rows, fileName=record.fileName||'';
  if(source==='retail_sv2'){nextData.retail.sv2=rows;nextData.retail.headers.sv2=headers;nextData.retail.fileName=nextData.retail.fileName||fileName;return;}
  if(source==='retail_wiper'){nextData.retail.wiper=rows;nextData.retail.headers.wiper=headers;nextData.retail.fileName=nextData.retail.fileName||fileName;return;}
  if(source==='referral_sv2'){nextData.referral.sv2=rows;nextData.referral.headers.sv2=headers;nextData.referral.fileName=nextData.referral.fileName||fileName;return;}
  if(source==='referral_wiper'){nextData.referral.wiper=rows;nextData.referral.headers.wiper=headers;nextData.referral.fileName=nextData.referral.fileName||fileName;return;}
  if(source==='referral_itac'){nextData.referral.itac=rows;nextData.referral.headers.itac=headers;nextData.referral.itacSheetName=record.selectedWorksheet||'';nextData.referral.fileName=nextData.referral.fileName||fileName;return;}
  if(source==='qa'){nextData.qa={fileName,headers,rows,aoa:[]};return;}
  if(source===QA_DIRECT_SOURCE){nextData.qa_direct={fileName,headers,rows,aoa:[],sheetName:record.selectedWorksheet||''};return;}
  if(['checklist','documented_coaching','comp_calls'].includes(source)){nextData[source]={fileName,headers,rows,aoa:[]};}
}
function emptyJsonPackageBooks(fileName,sources,customSources){
  const books={}; ['nondate','date','retail','referral','qa',QA_DIRECT_SOURCE,'checklist','documented_coaching','comp_calls','packaged'].forEach(k=>books[k]={fileName:'',sheetNames:[],aoaBySheet:{},selectedSheets:{},sheetVersions:{},normalizedPackage:true});
  Object.entries(sources||{}).forEach(([source,record])=>{ const key=sourceBookKey(source), selected=record.selectedWorksheet||''; books[key]=books[key]||{fileName:'',sheetNames:[],aoaBySheet:{},selectedSheets:{},sheetVersions:{},normalizedPackage:true}; books[key].fileName=record.fileName||fileName; if(selected){books[key].sheetNames.push(selected);books[key].selectedSheets[source]=selected;} });
  (customSources||[]).forEach(c=>{books[c.sourceKey]={fileName:c.fileName||fileName,sheetNames:c.sheetName?[c.sheetName]:[],aoaBySheet:{},selectedSheets:{[c.sourceKey]:c.sheetName||''},sheetVersions:{},normalizedPackage:true};});
  books.packaged={fileName,sheetNames:[],aoaBySheet:{},selectedSheets:{},sheetVersions:{},normalizedPackage:true}; return books;
}
function stageAllStarJsonPackage(pkg,fileName){
  if(!pkg || pkg.packageType!==ALL_STAR_JSON_PACKAGE_TYPE) throw new Error('Invalid All-Star package.');
  const schema=Number(pkg.schemaVersion); if(schema>ALL_STAR_JSON_PACKAGE_SCHEMA) throw new Error('Package created by a newer All-Star version.'); if(schema!==ALL_STAR_JSON_PACKAGE_SCHEMA) throw new Error('Unsupported package schema.');
  if(!pkg.sources || typeof pkg.sources!=='object' || !Object.keys(pkg.sources).length) throw new Error('Missing source data.');
  if(!pkg.rosters || !pkg.teamTotals || !pkg.categorized || !Array.isArray(pkg.customSources)) throw new Error('Invalid All-Star package: required structures are missing.');
  if(!Array.isArray(pkg.rosters.retail)||!Array.isArray(pkg.rosters.referral)||!Array.isArray(pkg.teamTotals.retail?.rows)||!Array.isArray(pkg.teamTotals.referral?.rows)) throw new Error('Missing source data: roster or Team Totals rows.');
  const nextData=emptyJsonHydratedData(); JSON_PACKAGE_SOURCE_KEYS.forEach(source=>{ if(pkg.sources[source]) stageJsonSource(nextData,source,pkg.sources[source]); });
  nextData.retail.fileName=pkg.sourceFiles?.retail||nextData.retail.fileName||fileName; nextData.referral.fileName=pkg.sourceFiles?.referral||nextData.referral.fileName||fileName;
  nextData.retail.controlRoster=Array.isArray(pkg.rosters.retail)?pkg.rosters.retail:[]; nextData.referral.controlRoster=Array.isArray(pkg.rosters.referral)?pkg.rosters.referral:[];
  nextData.retail.teamTotals=normalizeTeamTotalsDataset({...emptyTeamTotalsDataset('retail'),...(pkg.teamTotals.retail||{})},'retail_team_totals',{force:true});
  nextData.referral.teamTotals=normalizeTeamTotalsDataset({...emptyTeamTotalsDataset('referral'),...(pkg.teamTotals.referral||{})},'referral_team_totals',{force:true});
  const categorized={nondated:{headers:pkg.categorized.nondated?.headers||['Representative','Coach'],rows:Array.isArray(pkg.categorized.nondated?.rows)?pkg.categorized.nondated.rows:[],builtAt:pkg.categorized.nondated?.builtAt||'',sourceStats:pkg.categorized.nondated?.sourceStats||[]},dated:{headers:pkg.categorized.dated?.headers||['Representative','Coach','Date'],rows:Array.isArray(pkg.categorized.dated?.rows)?pkg.categorized.dated.rows:[],builtAt:pkg.categorized.dated?.builtAt||'',sourceStats:pkg.categorized.dated?.sourceStats||[]},warnings:Array.isArray(pkg.categorized.warnings)?pkg.categorized.warnings:[]};
  const customSources=pkg.customSources.map((c,i)=>{ if(!c?.sourceKey || !Array.isArray(c.headers)||!Array.isArray(c.rows)) throw new Error(`Missing source data: custom source ${i+1}.`); return {...c,id:c.id||id(),sourceType:'custom',aoa:[],aoaBySheet:{},sheetNames:c.sheetName?[c.sheetName]:[]}; });
  const sourceMeta={...(pkg.sourceMeta||{})}; Object.entries(pkg.sources).forEach(([source,record])=>{sourceMeta[source]={...(sourceMeta[source]||{}),sourceVersion:Number(record.sourceVersion||sourceMeta[source]?.sourceVersion||1),originalHeaders:record.headers||[],normalizedHeaders:record.headers||[],rowCount:(record.rows||[]).length,hydratedFromJson:true};});
  if(pkg.organizations!==undefined&&!Array.isArray(pkg.organizations)) throw new Error('Invalid All-Star package: organizations must be an array.');
  const orgs=(pkg.organizations||[]).map(normalizeOrg), models=clonePlain(state.models||[]), byModel=pkg.sourceSettings?.byModel||{}; models.forEach(m=>{if(byModel[m.id])m.sourceSettings=clonePlain(byModel[m.id]);});
  return {nextData,categorized,customSources,sourceMeta,categorizedFragments:pkg.categorizedFragments||{},orgs,models:models.map(normalizeModelForStorage),books:emptyJsonPackageBooks(fileName,pkg.sources,customSources),statistics:pkg.statistics||{}};
}
function commitStagedJsonPackage(staged){
  const previous={...state,versions:{...(state.versions||{})}}, priorResearchCache=(()=>{try{return localStorage.getItem(RESEARCH_CACHE_KEY);}catch(_){return null;}})();
  try{
    state.data=staged.nextData; state.categorized=staged.categorized; state.customSources=staged.customSources; state.sourceMeta=staged.sourceMeta; state.categorizedFragments=staged.categorizedFragments; state.books=staged.books; state.orgs=staged.orgs; state.models=staged.models;
    bumpVersion('roster'); bumpVersion('teams'); markDataIndexDirty('JSON package hydration'); clearResearchComputedCaches('JSON package hydration'); rebuildTeams();
  }catch(error){
    Object.assign(state,previous);
    try{if(priorResearchCache===null)localStorage.removeItem(RESEARCH_CACHE_KEY);else localStorage.setItem(RESEARCH_CACHE_KEY,priorResearchCache);}catch(_){}
    throw error;
  }
}
async function loadJsonPackageFile(file){
  let parsed; try{ parsed=JSON.parse(await file.text()); }catch(_){ throw new Error('Corrupted JSON.'); }
  updateProgress('Validating normalized package...',18,{force:true}); await yieldToBrowser();
  const staged=stageAllStarJsonPackage(parsed,file.name); updateProgress('Hydrating normalized application state...',42,{force:true}); await yieldToBrowser();
  commitStagedJsonPackage(staged);
  try{localStorage.setItem(MODEL_KEY,JSON.stringify(state.models));localStorage.setItem(ORG_BUILDER_KEY,JSON.stringify(state.orgs));}catch(_){}
  markRetailPersistenceDirty('JSON package hydration'); markReferralPersistenceDirty('JSON package hydration'); JSON_PACKAGE_SOURCE_KEYS.filter(s=>!s.startsWith('retail')&&!s.startsWith('referral')).forEach(s=>markSourceCacheDirty(s,'JSON package hydration')); staged.customSources.forEach(c=>markSourceCacheDirty(c.sourceKey,'JSON package hydration')); ['categorized','customSources','sourceMeta','sourceSettings','orgs'].forEach(k=>markImportCacheDirty('misc',k,'JSON package hydration'));
  renderCustomSourcesList(); renderCategorizedSummary(); restoreImportFileLabels(); renderModelList(); populateRunModels(); renderOrgBuilder(); renderTeamTotalsImportControls(); setStatus(); renderEditModelSafe(); renderTeamSelect(); updateResearchCacheBadge();
  if(els.packagedFileName) els.packagedFileName.textContent=`${file.name} · normalized JSON hydrated directly`;
  updateProgress('Saving hydrated package locally...',88,{force:true}); const saved=await flushImportCacheSave('JSON package hydration complete'); if(!saved){ const message=state.importCache.lastError||'The JSON package loaded, but its local IndexedDB save failed.'; console.warn(message); alert(message); }
  updateProgress(`JSON package ready${staged.statistics.totalRows?` · ${Number(staged.statistics.totalRows).toLocaleString()} rows`:''}.`,100,{force:true});
}
async function loadPackagedFile(file){
  const timing=importTiming('package load hydration');
  showProgress('Reading packaged data...',3);
  try{
    await yieldToBrowser();
    if(/\.json$/i.test(file.name)||file.type==='application/json'){ await loadJsonPackageFile(file); timing.end('normalized JSON hydrated directly; workbook intake bypassed'); return; }
    const wb=await readFileWorkbook(file);
    timing.mark('file parsing/loading', `${(wb.SheetNames||[]).length} sheets`);
    const names=wb.SheetNames||[];
    const metaSheet=names.find(sn=>norm(sn)===norm('All Star Metadata'))||'';
    let packageMeta={};
    if(metaSheet){
      try{ packageMeta=JSON.parse(sheetAoa(wb,metaSheet)?.[1]?.[0]||'{}')||{}; }
      catch(e){ console.warn('Package metadata could not be read',e); }
    }
    if(packageMeta.preprocessed){ state.sourceMeta={...(state.sourceMeta||{}),...(packageMeta.sourceMeta||{})}; state.categorizedFragments={...(state.categorizedFragments||{}),...(packageMeta.categorizedFragments||{})}; }
    const sheetByNorm=new Map(names.map(sn=>[norm(sn),sn]));
    const resolveSheet=(candidate)=> candidate && (names.includes(candidate)?candidate:sheetByNorm.get(norm(candidate))||sheetByNorm.get(norm(String(candidate).slice(0,31)))||'');
    (packageMeta.customSources||[]).forEach(def=>{
      if(!def.sourceKey) return;
      let c=customSource(def.sourceKey);
      if(!c){ c={id:def.id||id(),sourceKey:def.sourceKey,name:def.name||def.displayName||def.sourceKey,sourceType:'custom',rows:[],headers:[],aoa:[]}; state.customSources.push(c); }
      Object.assign(c,{...def,id:c.id||def.id||id(),sourceType:'custom',name:def.name||c.name,displayName:def.displayName||def.name||c.displayName||c.name,headerRow:1,startCol:1,manualHeaders:[]});
    });
    if(Array.isArray(packageMeta.orgs)){ const prev=state.orgs||[]; packageMeta.orgs.map(normalizeOrg).forEach(o=>{ const i=prev.findIndex(x=>x.id===o.id); if(i>=0) prev[i]=o; else prev.push(o); }); state.orgs=prev; saveOrgs(); }
    const assigned={};
    Object.entries(packageMeta.sourceSheetMap||{}).forEach(([src,sn])=>{ const resolved=resolveSheet(sn); if(resolved) assigned[src]=resolved; });
    names.forEach(sn=>{ if(sn===metaSheet) return; const src=packageSheetToSource(sn); if(src&&!assigned[src]) assigned[src]=sn; });
    (packageMeta.customSources||[]).forEach(def=>{ const resolved=resolveSheet(def.sheetName||def.name); if(def.sourceKey&&resolved) assigned[def.sourceKey]=resolved; });
    const m=activeModelForImport(); ensureSourceSettings(m);
    const legacyPackage=!packageMeta.schemaVersion;
    if(legacyPackage){ availableTroubleSources().filter(src=>src!==QA_DIRECT_SOURCE).forEach(src=>{ if(!assigned[src]) assigned[src]=pickBestSheetForSource(wb,src,m,SOURCE_SHEET_HINTS[src]); }); }
    const packageSources=[...new Set([...(packageMeta.includedSources||[]),...Object.keys(assigned)])].filter(src=>src!==QA_DIRECT_SOURCE&&assigned[src]&&names.includes(assigned[src]));
    if(!packageSources.length) throw new Error('No recognized All Star data sheets were found in the package.');
    updateProgress('Preparing packaged source sheets...',16); await yieldToBrowser();
    const groupedBooks={};
    for(let i=0;i<packageSources.length;i++){
      const src=packageSources[i], sn=assigned[src], bookKey=sourceBookKey(src);
      groupedBooks[bookKey]=groupedBooks[bookKey]||{fileName:file.name,sheetNames:[],aoaBySheet:{},selectedSheets:{},sheetVersions:{},packageLayoutVersion:2};
      const book=groupedBooks[bookKey]; if(!book.sheetNames.includes(sn)){ book.sheetNames.push(sn); book.aoaBySheet[sn]=sheetAoa(wb,sn); }
      book.selectedSheets[src]=sn;
      updateProgress(`Preparing packaged sheets... ${i+1} / ${packageSources.length}`,16+16*((i+1)/packageSources.length));
      await yieldToBrowser();
    }
    Object.entries(groupedBooks).forEach(([bookKey,book])=>replaceWorkbookCache(bookKey,book,'packaged source workbook imported'));
    const metaAoa=metaSheet?sheetAoa(wb,metaSheet):[];
    replaceWorkbookCache('packaged',{fileName:file.name,sheetNames:metaSheet?[metaSheet]:[],aoaBySheet:metaSheet?{[metaSheet]:metaAoa}:{},selectedSheets:{},sheetVersions:{},packageLayoutVersion:2},'packaged metadata imported');
    for(let i=0;i<packageSources.length;i++){
      const src=packageSources[i];
      updateProgress(`Importing packaged ${labelSource(src)}...`,34+46*((i+1)/packageSources.length));
      await rebuildSourceFromPackage(src,assigned[src],m);
      timing.mark('building date/non-date datasets', `${labelSource(src)} hydrated`);
      await yieldToBrowser();
    }
    state.data.retail.fileName=file.name; state.data.referral.fileName=file.name;
    ['qa','checklist','documented_coaching','comp_calls'].forEach(src=>{ if(packageSources.includes(src)&&state.data[src]) state.data[src].fileName=file.name; });
    if(packageMeta.categorized?.warnings) state.categorized.warnings=packageMeta.categorized.warnings;
    markImportCacheDirty('misc','customSources','packaged custom source definitions imported');
    markImportCacheDirty('misc','sourceMeta','packaged source metadata imported');
    markImportCacheDirty('misc','sourceSettings','packaged source settings imported');
    renderCustomSourcesList(); renderCategorizedSummary(); restoreImportFileLabels();
    if(els.packagedFileName) els.packagedFileName.textContent=`${file.name} · ${packageSources.length} data sheets imported`;
    await finishDataChanged('packaged data import',82);
    updateProgress('Saving packaged import locally...',97,{force:true});
    const saved=await flushImportCacheSave('packaged data import complete');
    if(!saved) throw new Error(state.importCache.lastError||'The packaged data loaded, but its local IndexedDB save failed.');
    timing.mark('rendering previews', 'summary only; full preview deferred until opened');
    timing.end(`${packageSources.length} sheets imported and saved`);
  }catch(err){ console.error(err); alert('Packaged data import failed: '+String(err?.message||err)); }
  finally{ hideProgress(); if(els.packagedFile) els.packagedFile.value=''; }
}

function sourceFileName(source){
  if(source===NONDATED_SOURCE || source===DATED_SOURCE) return state.books[source]?.fileName || (categorizedStore(source).rows?.length?'Categorized database':'');
  if(isCustomSource(source)) return customSource(source)?.fileName || state.books[source]?.fileName || '';
  if(source.startsWith('retail')) return state.data.retail.fileName || state.books.retail.fileName;
  if(source.startsWith('referral')) return state.data.referral.fileName || state.books.referral.fileName;
  if(source==='qa') return state.data.qa.fileName || state.books.qa.fileName;
  if(source===QA_DIRECT_SOURCE) return state.data.qa_direct?.fileName || state.books[QA_DIRECT_SOURCE]?.fileName || '';
  if(source==='checklist') return state.data.checklist.fileName || state.books.checklist.fileName;
  if(source==='documented_coaching') return state.data.documented_coaching.fileName || state.books.documented_coaching.fileName;
  if(source==='comp_calls') return state.data.comp_calls.fileName || state.books.comp_calls.fileName;
  return '';
}
function exactSheetByName(names, wanted){
  return (names||[]).find(sn=>norm(sn)===norm(wanted)) || '';
}
function currentYearCompCallSheet(names){
  const year=String(new Date().getFullYear());
  const scored=(names||[]).map(name=>{
    const n=norm(name);
    if(!n.includes(year)) return null;
    const isComp=/compliments?|compcalls?|compcall/.test(n);
    const archive=/archive/.test(n);
    let score=isComp?100:40;
    if(new RegExp(`^compliments?${year}$`).test(n)) score+=80;
    if(new RegExp(`^${year}(archive)?$`).test(n) || new RegExp(`^(archive)?${year}$`).test(n)) score+=45;
    if(archive) score+=10;
    return {name,score};
  }).filter(Boolean).sort((a,b)=>b.score-a.score);
  return scored[0]?.name || '';
}
function preferredRequiredSheetForSource(names, source){
  if(source==='checklist') return exactSheetByName(names,'All Items');
  if(source==='comp_calls') return currentYearCompCallSheet(names);
  return '';
}
function pickBestSheetForSource(wb, source, model, variants=[]){
  const cfg=getSourceSetting(model,source);
  const names=wb.SheetNames||[];
  const required=preferredRequiredSheetForSource(names,source);
  if(required) return required;
  const strictHint=strictSheetMatchForSource(names,source,variants.length?variants:(SOURCE_SHEET_HINTS[source]||[]));
  if(strictHint) return strictHint;
  if(cfg.sheetName && names.includes(cfg.sheetName)) return cfg.sheetName;
  const hinted=findSheet(wb, variants.length?variants:(SOURCE_SHEET_HINTS[source]||[]), isStrictStatSource(source));
  const expected=expectedHeadersForSource(source,model);
  let best=null;
  names.forEach(sn=>{
    const aoa=sheetAoaPreview(wb,sn,100);
    const p=sheetRowsFromAoa(aoa,Math.max(0,(Number(cfg.headerRow)||1)-1),Math.max(0,(Number(cfg.startCol)||1)-1),true,expected,source,model,cfg.manualHeaders||[]);
    const good=layoutLooksGoodForSource(source,p.headers,expected,model);
    const hintBonus=sn===hinted ? 25 : 0;
    const score=(p.matchCount||0)*500 + (good?300:0) + Math.min(p.headers.length,80)*3 + hintBonus - (p.detected?0:10);
    if(!best || score>best.score) best={sheetName:sn,score,headers:p.headers,pack:p};
  });
  return best?.sheetName || hinted || names[0];
}
function isStrictStatSource(source){ return ['retail_sv2','retail_wiper','referral_sv2','referral_wiper'].includes(source); }
function strictSheetMatchForSource(names, source, variants=[]){
  const wants=(variants.length?variants:(SOURCE_SHEET_HINTS[source]||[])).map(norm);
  if(!wants.length) return '';
  return (names||[]).find(n=>wants.includes(norm(n))) || '';
}
function applySourceSheetChoice(source, sheetName){
  const book=bookForSource(source);
  const aoa=(book.aoaBySheet||{})[sheetName] || getSourceAoa(source) || [];
  setSourceAoa(source,aoa,sheetName);
  return aoa;
}
function findSheet(wb, variants, exactOnly=false){
  const names=wb.SheetNames||[];
  for(const want of variants){ const hit=names.find(n=>norm(n)===norm(want)); if(hit) return hit; }
  if(exactOnly) return names[0];
  for(const want of variants){ const hit=names.find(n=>norm(n).includes(norm(want))); if(hit) return hit; }
  return names[0];
}
function repNameFromColumns(row, headers, columns, fallbackNames=[]){
  const cols=columns||{};
  const mode=cols.nameMode || 'auto';
  const getCol=(val, fallbacks=[])=>findHeaderFromExpected(headers||Object.keys(row||{}), val, fallbacks);
  let rep='';
  if(mode==='firstLast'){
    const firstH=getCol(cols.firstName,['First Name','Firstname','Agent Firstname','Agent_firstname']);
    const lastH=getCol(cols.lastName,['Last Name','Lastname','Agent Surname','Agent_Surname','Surname']);
    rep=cleanName(`${row[firstH]||''} ${row[lastH]||''}`.trim());
  }else if(mode==='full'){
    const fullH=getCol(cols.fullName || cols.agent || cols.rep, fallbackNames);
    const val=row[fullH];
    rep=cols.convertLastFirst ? lastFirstToFirstLast(val) : cleanName(val);
  }
  if(rep) return cleanName(rep);
  const keys=Object.keys(row||{}); const byNorm=Object.fromEntries(keys.map(k=>[norm(k),k]));
  const get=(...names)=>{for(const n of names){const k=byNorm[norm(n)]; if(k!==undefined) return row[k];} return '';};
  const last=get('Last_Name','Agent_Surname','Agent Surname','Surname','Last Name','Lastname');
  const first=get('First_Name','Agent_firstname','Agent Firstname','Agent_firstname','First Name','Firstname');
  if(first||last) return cleanName(`${first} ${last}`);
  const combined=get(...fallbackNames,'Last_Name First_Name','Agent_Surname Agent_firstname','Agent_Surname Agent_Firstname','Name','Agent Name','Associate Name','Representative','Rep');
  if(combined){
    const k=keys.find(k=>String(row[k])===String(combined))||'';
    if(cols.convertLastFirst || /last[_\s-]*name.*first[_\s-]*name/i.test(k) || String(combined).includes(',')) return cleanName(lastFirstToFirstLast(combined));
	    return cleanName(combined);
  }
  return '';
}
function normalizeStatRow(row, dept, part, columns={}, headers=[]){
  const sourceKey=`${dept}_${part}`;
  const out={...row,_sourceKey:sourceKey,_dept:dept,_part:part};
  const keys=Object.keys(row); const byNorm=Object.fromEntries(keys.map(k=>[norm(k),k]));
  const get=(...names)=>{for(const n of names){const k=byNorm[norm(n)]; if(k!==undefined) return row[k];} return '';};
  const teamH=findHeaderFromExpected(headers,columns.team,['team_Name','Team_Name','Team Name','Team','Coach','Coach Assigned']);
  const dateH=selectedDateHeaderForSource(sourceKey,headers,columns);
  const rep=repNameFromColumns(row,headers,columns,['Name','Agent Name','Associate Name','Representative','Rep']);
  const team=columns.skipTeamBuild ? '' : canonicalCoachName((teamH?row[teamH]:'') || get('team_Name','Team_Name','Team Name','Team','Coach','Coach Assigned') || '');
  out._sourceArea=dept; out._rawRep=rep; out._rawRepKey=fullNameIdentityKey(rep); out._rep=rep; out._repKey=fullNameIdentityKey(rep); out._rosterId=safeFallbackRosterIdentity(out,dept); out._aliasApplied=false; out._aliasRecord=null; out._team=team; out._date=dateH?row[dateH]:'';
  return out;
}
function controlRosterRows(){
  return [
    ...(state.data.retail.controlRoster||[]),
    ...(state.data.referral.controlRoster||[])
  ].map(r=>{
    const sourceArea=r.sourceArea||r.source||(/referral/i.test(r._sourceKey||'')?'referral':'retail');
    const rep=cleanName(r.displayName||r.originalName||r._rep||r.representative||r.Representative||'');
    const team=canonicalCoachName(r._team||r.team||r.Team||'');
    const fullNameKey=fullNameIdentityKey(rep);
    const rosterId=r.rosterId||deterministicRosterId(sourceArea,team,fullNameKey,r.workbook||state.books?.[sourceArea]?.fileName||'',r.sheetName||r.tabName||'');
    return {...r,rosterId,_rosterId:rosterId,sourceArea,source:sourceArea,_sourceKey:r._sourceKey||`${sourceArea}_control_roster`,displayName:rep,originalName:r.originalName||r.representative||r._rep||'',fullNameKey,_rep:rep,_repKey:fullNameKey,_team:team,representative:rep,team};
  }).filter(r=>r._repKey&&r._team);
}
function controlRosterSignature(){
  const rows=[...(state.data.retail.controlRoster||[]),...(state.data.referral.controlRoster||[])];
  return [rows.length,rows.slice(0,5).map(r=>`${r.representative||r._rep}|${r.team||r._team}|${r.rowNumber||''}`).join(';'),rows.slice(-5).map(r=>`${r.representative||r._rep}|${r.team||r._team}|${r.rowNumber||''}`).join(';')].join('|');
}
function hasTrustedControlRoster(){ return trustedRosterMaps().byRep.size>0; }
function conflictId(type,key){ return `${type}|${key}`; }
function trustedRosterMaps(){
  const idx=ensureRosterIndex();
  const repsByTeam=new Map();
  idx.repsByTeamKey.forEach((map,teamKey)=>repsByTeam.set(idx.byTeamKey.get(teamKey)||teamKey,map));
  return {byRep:idx.byRepKey,bySourceRep:idx.bySourceRepKey,teams:idx.byTeamKey,repsByTeam,conflicts:idx.conflicts};
}
function trustedTeamForRepKey(repKey,sourceArea=''){
  if(!repKey) return '';
  if(sourceArea){ const hit=ensureRosterIndex().bySourceRepKey.get(sourceRepCompositeKey(sourceArea,repKey)); if(hit && !hit.conflict) return hit.team; }
  const rec=trustedRosterMaps().byRep.get(repKey);
  return rec && !rec.conflict ? rec.team : (state.repTeams?.get?.(repKey) || '');
}
function trustedRosterTeamNames(){ return [...trustedRosterMaps().teams.values()].sort((a,b)=>a.localeCompare(b)); }
function directTeamFromAnyRow(row){
  if(!row) return '';
  const direct=row._team || row.Coach || row.coach || row.Team || row.team || row['Coach Name'] || row['Team Name'] || row.Manager || row.Supervisor || row.Leader || row['Coach Assigned'] || row['Assigned Coach'] || row['QA Coach'] || row['Team Lead'] || row['Job Coach'] || '';
  if(direct) return canonicalCoachName(direct);
  const h=findHeader(Object.keys(row||{}),['Coach','Coach Name','Team','Team Name','Manager','Supervisor','Leader','Coach Assigned','Assigned Coach','QA Coach','Team Lead','Job Coach']);
  return h ? canonicalCoachName(row[h]) : '';
}
function rebuildTeams(){
  const prevSelected=new Set(state.selectedTeams||[]);
  const prevSelectedKeys=new Set([...prevSelected].map(coachNameKey).filter(Boolean));
  const hadTeamsBefore=(state.teams||[]).length>0;
  state.repTeams=new Map();
  const teams=new Set();
  const trusted=trustedRosterMaps();
  const usingRoster=trusted.byRep.size>0;
  trusted.teams.forEach(team=>addTeamNameUnique(teams,team));
  trusted.byRep.forEach((rec,key)=>state.repTeams.set(key,rec.team));
  const allRows=[
    ...state.data.retail.sv2,
    ...state.data.referral.sv2,
    ...state.data.retail.wiper,
    ...state.data.referral.wiper,
    ...(state.categorized.nondated.rows||[]),
    ...(state.categorized.dated.rows||[]),
    ...state.data.qa.rows,
    ...state.data.checklist.rows,
    ...state.data.documented_coaching.rows,
    ...state.data.comp_calls.rows,
    ...(state.customSources||[]).flatMap(c=>c.rows||[])
  ];
  const addTrustedRowTeam=(r)=>{
    if(rowSkipsTeamBuild(r)) return;
    if(usingRoster) return;
    const team=addTeamNameUnique(teams, teamNameFromAnyRow(r));
    const repKey=repKeyFromAnyRow(r);
    if(team && r) r._team=team;
    if(repKey && team) state.repTeams.set(repKey,team);
  };
  allRows.forEach(r=>{
    const repKey=repKeyFromAnyRow(r), manual=!!r?._teamAssignedManually, team=manual?canonicalCoachName(r._team||''):'';
    if(repKey && team){ state.repTeams.set(repKey,team); addTeamNameUnique(teams,team); }
  });
  const applyKnownTeam=(r)=>{
    const repKey=repKeyFromAnyRow(r);
    if(usingRoster){
      const team=trusted.byRep.get(repKey)?.team || state.repTeams.get(repKey) || (repKey?NA_TEAM:'');
      if(team) r._team=team;
    }else if(!r._team && repKey && state.repTeams.has(repKey)) r._team=state.repTeams.get(repKey);
    else if(r._team) r._team=canonicalCoachName(r._team);
    const team=rowTeam(r);
    if(team) addTeamNameUnique(teams, team);
  };
  allRows.forEach(addTrustedRowTeam);
  allRows.forEach(applyKnownTeam);
  state.teams=Array.from(teams).sort((a,b)=>a.localeCompare(b));
  if(!state.teamSelectionInitialized || (!prevSelected.size && !hadTeamsBefore && state.teams.length)){
    state.selectedTeams=new Set(state.teams);
    state.teamSelectionInitialized=!!state.teams.length;
  }else if(prevSelected.size){
    const kept=state.teams.filter(t=>prevSelected.has(t) || prevSelectedKeys.has(coachNameKey(t)));
    state.selectedTeams=new Set(kept.length ? kept : state.teams);
  }else{
    state.selectedTeams=new Set();
  }
}

function addDateToRange(range,d){
  d=parseDateOnly(d);
  if(!(d instanceof Date)||isNaN(d)) return range;
  if(!range) range={min:d,max:d};
  else{ if(d<range.min) range.min=d; if(d>range.max) range.max=d; }
  return range;
}
function pushMapArray(map,key,row){ if(!key) return; if(!map.has(key)) map.set(key,[]); map.get(key).push(row); }
function rowTeam(row){
  if(!row) return '';
  if(TEAM_TOTAL_SOURCE_KEYS.includes(rowSourceKey(row))){
    const identityHeader=teamTotalsIdentityHeader(Object.keys(row||{}));
    const team=usableTeamTotalCoachName(row._team) || usableTeamTotalCoachName(row['Full Team Name']) || usableTeamTotalCoachName(identityHeader?row[identityHeader]:'');
    if(team){ row._team=team; row._teamKey=coachNameKey(team); if(identityHeader) row[identityHeader]=team; }
    return team;
  }
  if(row._rosterId){ const rr=ensureRosterIndex().byRosterId.get(row._rosterId); if(rr?.team){ if(row._team!==rr.team) row._team=rr.team; return rr.team; } }
  const repKey=repKeyFromAnyRow(row);
  if(hasTrustedControlRoster()){
    const trusted=trustedTeamForRepKey(repKey,row._sourceArea||'');
    const team=trusted || (repKey ? NA_TEAM : '');
    if(team && row._team !== team) row._team=team;
    return team;
  }
  if(rowSkipsTeamBuild(row)) return repKey ? (state.repTeams.get(repKey)||'') : '';
  const team=canonicalCoachName(row._team || (repKey ? state.repTeams.get(repKey) : '') || '');
  if(team && row._team !== team) row._team=team;
  return team;
}
function teamNameFromAnyRow(row){
  if(!row) return '';
  if(TEAM_TOTAL_SOURCE_KEYS.includes(rowSourceKey(row))) return rowTeam(row);
  if(hasTrustedControlRoster()){
    const repKey=repKeyFromAnyRow(row);
    return trustedTeamForRepKey(repKey) || (repKey ? NA_TEAM : '');
  }
  if(rowSkipsTeamBuild(row)){
    const repKey=repKeyFromAnyRow(row);
    return repKey ? (state.repTeams.get(repKey)||'') : '';
  }
  return directTeamFromAnyRow(row);
}
function repKeyFromAnyRow(row){
  if(!row) return '';
  if(TEAM_TOTAL_SOURCE_KEYS.includes(rowSourceKey(row))) return '';
  return row._repKey || nameKey(row._rep || row.Representative || row['Representative'] || row['Agent Name'] || row['Associate Name'] || row['Associate name'] || row['Rep Name'] || row.Rep || row.Name || '');
}
function addTeamNameUnique(set, value){
  const name=canonicalCoachName(value);
  if(!name) return '';
  const key=coachNameKey(name);
  for(const existing of set){ if(coachNameKey(existing)===key) return existing; }
  set.add(name);
  return name;
}
function allImportedRowsForTeams(){
  return [...controlRosterRows(), ...allSourceKeys().filter(src=>!TEAM_TOTAL_SOURCE_KEYS.includes(src)).flatMap(src=>getRowsRaw(src)||[])];
}
function buildCompactTeamIndexFromRows(reason='team index'){
  const reps=new Map();
  allImportedRowsForTeams().forEach(r=>{
    const key=repKeyFromAnyRow(r), name=canonicalRepName(r?._rep || r?.Representative || r?.['Agent Name'] || r?.['Associate Name'] || r?.['Associate name'] || r?.Name || '');
    const team=rowTeam(r);
    if(key && name && team) reps.set(key,mergeRepDisplay(reps.get(key),{kind:'rep',key,name,team}));
  });
  const repList=[...reps.values()].map(r=>({...r,team:canonicalCoachName(r.team)})).sort((a,b)=>(a.team||'').localeCompare(b.team||'')||a.name.localeCompare(b.name));
  const repsByTeam=new Map();
  repList.forEach(r=>{ const t=r.team||'No Team'; if(!repsByTeam.has(t)) repsByTeam.set(t,[]); repsByTeam.get(t).push(r); });
  const teamCounts=[...repsByTeam.entries()].filter(([team])=>team&&team!=='No Team').map(([team,list])=>({team,count:list.length})).sort((a,b)=>a.team.localeCompare(b.team));
  const rosterIdx=ensureRosterIndex(), teamSummaries=new Map();
  teamCounts.forEach(x=>{ const key=coachNameKey(x.team), pre=rosterIdx.teamSummaries.get(key)||{}; teamSummaries.set(key,{team:x.team,teamKey:key,count:x.count,originalControlCount:pre.originalControlCount||0,sourceArea:pre.sourceArea||'',manualMoveCount:pre.manualMoveCount||0,conflictCount:pre.conflictCount||0,quarantinedAliasCount:(ensureQuarantineIndex().byTeamKey.get(key)||[]).length}); });
  return {version:1,reason,signature:dataIndexSignature(),builtAt:Date.now(),reps:repList,teamCounts,repsByTeam,teamSummaries};
}
function serializeTeamIndex(idx){
  if(!idx) return null;
  return {version:1,reason:idx.reason||'',signature:idx.signature||dataIndexSignature(),builtAt:idx.builtAt||Date.now(),reps:idx.reps||[],teamCounts:idx.teamCounts||[],repsByTeam:[...(idx.repsByTeam||new Map()).entries()].map(([team,reps])=>[team,reps]),teamSummaries:[...(idx.teamSummaries||new Map()).entries()]};
}
function restoreTeamIndex(record){
  if(!record) return null;
  const repsByTeam=new Map((record.repsByTeam||[]).map(([team,reps])=>[canonicalCoachName(team)||team,(reps||[]).map(r=>({...r,team:canonicalCoachName(r.team||team)}))]));
  return {version:record.version||1,reason:record.reason||'',signature:record.signature||'',builtAt:record.builtAt||0,reps:record.reps||[...repsByTeam.values()].flat(),teamCounts:record.teamCounts||[...repsByTeam.entries()].map(([team,reps])=>({team,count:reps.length})),repsByTeam,teamSummaries:new Map(record.teamSummaries||[])};
}
function currentTeamIndex(){
  if(dataIndexReady()) return state.dataIndex;
  if(state.teamIndexCache?.teamCounts && state.teamIndexCache?.repsByTeam) return state.teamIndexCache;
  state.teamIndexCache=buildCompactTeamIndexFromRows('on-demand team index');
  return state.teamIndexCache;
}
function runTeamNames(){
  const idx=currentTeamIndex();
  const teams=new Set((idx.teamCounts||[]).map(x=>x.team).filter(Boolean));
  (state.teams||[]).forEach(t=>addTeamNameUnique(teams,t));
  return Array.from(teams).filter(Boolean).sort((a,b)=>a.localeCompare(b));
}
function rebuildDataIndexSync(reason='data changed'){
  const index={dirty:false,reason,version:(state.dataIndex?.version||0)+1,sources:{},reps:[],teamCounts:[],repsByTeam:new Map(),dateRanges:{qa:{interaction:null,assigned:null},date:new Map(),checklist:new Map(),documented_coaching:new Map(),comp_calls:new Map()},lastBuiltAt:Date.now()};
  const globalReps=new Map();
  controlRosterRows().forEach(r=>{
    const team=rowTeam(r);
    if(r._repKey && r._rep && team) globalReps.set(r._repKey,mergeRepDisplay(globalReps.get(r._repKey),{kind:'rep',key:r._repKey,name:r._rep,team}));
  });
  allSourceKeys().forEach(source=>{
    const rows=getRowsRaw(source);
    const idx=makeResearchSourceIndex(source,rows); idx.version=index.version;
    rows.forEach((r,i)=>{
      const key=r._repKey||'';
      const team=rowTeam(r);
      if(team && !r._team) r._team=team;
      if(source==='qa'){
        index.dateRanges.qa.interaction=addDateToRange(index.dateRanges.qa.interaction,r._interactionDate);
        index.dateRanges.qa.assigned=addDateToRange(index.dateRanges.qa.assigned,r._assignedDate);
      }
      if(isDatedRowPullSource(source) && index.dateRanges[source] instanceof Map){
        const h=sourceDateHeader(source,getHeaders(source));
        if(h){ const cur=index.dateRanges[source].get(h)||null; index.dateRanges[source].set(h,addDateToRange(cur,r[h])); }
      }
      addResearchIndexedRow(idx,source,r,i);
      if(key && r._rep){
        const rep={kind:'rep',key,name:cleanName(r._rep),team};
        globalReps.set(key,mergeRepDisplay(globalReps.get(key),rep));
      }
    });
    idx.byRepSortedDate.forEach(list=>list.sort((a,b)=>(idx.rowMeta.get(a)?.dateMs||0)-(idx.rowMeta.get(b)?.dateMs||0)));
    idx.byTeamSortedDate.forEach(list=>list.sort((a,b)=>(idx.rowMeta.get(a)?.dateMs||0)-(idx.rowMeta.get(b)?.dateMs||0)));
    idx.dateSortedRows.sort((a,b)=>(idx.rowMeta.get(a)?.dateMs||0)-(idx.rowMeta.get(b)?.dateMs||0));
    finalizeResearchSourceIndex(idx,source);
    index.sources[source]=idx;
  });
  const reps=Array.from(globalReps.values()).sort((a,b)=>(a.team||'').localeCompare(b.team||'')||a.name.localeCompare(b.name));
  const repsByTeam=new Map();
  reps.forEach(r=>{ const t=r.team||'No Team'; if(!repsByTeam.has(t)) repsByTeam.set(t,[]); repsByTeam.get(t).push(r); });
  const teamCounts=Array.from(repsByTeam.entries()).filter(([team])=>team&&team!=='No Team').map(([team,list])=>({team,count:list.length})).sort((a,b)=>a.team.localeCompare(b.team));
  index.reps=reps; index.repsByTeam=repsByTeam; index.teamCounts=teamCounts;
  state.dataIndex=index; state.indexes=index.sources;
  state.teamIndexCache=restoreTeamIndex(serializeTeamIndex(index));
  return index;
}
async function rebuildDataIndexAsync(reason='Indexing data...', progress={}){
  const signature=dataIndexSignature();
  if(dataIndexReady() && state.dataIndex.signature===signature) return state.dataIndex;
  if(dataIndexReady() && state.dataIndex.signature!==signature) state.dataIndex.dirty=true;
  const timing=importTiming('building indexes/maps');
  const start=Number(progress.start ?? 0), end=Number(progress.end ?? 100), span=end-start;
  const totalRows=Math.max(1,allSourceKeys().reduce((n,src)=>n+getRowsRaw(src).length,0));
  let done=0;
  const index={dirty:false,reason,signature,version:(state.dataIndex?.version||0)+1,sources:{},reps:[],teamCounts:[],repsByTeam:new Map(),dateRanges:{qa:{interaction:null,assigned:null},date:new Map(),checklist:new Map(),documented_coaching:new Map(),comp_calls:new Map()},lastBuiltAt:Date.now()};
  const globalReps=new Map();
  controlRosterRows().forEach(r=>{
    const team=rowTeam(r);
    if(r._repKey && r._rep && team) globalReps.set(r._repKey,mergeRepDisplay(globalReps.get(r._repKey),{kind:'rep',key:r._repKey,name:r._rep,team}));
  });
  const chunkSize=Number(progress.chunkSize)||1200;
  for(const source of allSourceKeys()){
    const rows=getRowsRaw(source);
    const idx=makeResearchSourceIndex(source,rows); idx.version=index.version;
    for(let i=0;i<rows.length;i++){
      const r=rows[i];
      const key=r._repKey||'';
      const team=rowTeam(r);
      if(team && !r._team) r._team=team;
      if(source==='qa'){
        index.dateRanges.qa.interaction=addDateToRange(index.dateRanges.qa.interaction,r._interactionDate);
        index.dateRanges.qa.assigned=addDateToRange(index.dateRanges.qa.assigned,r._assignedDate);
      }
      if(isDatedRowPullSource(source) && index.dateRanges[source] instanceof Map){
        const h=sourceDateHeader(source,getHeaders(source));
        if(h){ const cur=index.dateRanges[source].get(h)||null; index.dateRanges[source].set(h,addDateToRange(cur,r[h])); }
      }
      addResearchIndexedRow(idx,source,r,i);
      if(key && r._rep){
        const rep={kind:'rep',key,name:cleanName(r._rep),team};
        globalReps.set(key,mergeRepDisplay(globalReps.get(key),rep));
      }
      done++;
      if(done%chunkSize===0){
        updateProgress(`${reason} · ${labelSource(source)} (${done.toLocaleString()} rows)`, start + span*Math.min(.95,done/totalRows));
        await yieldToBrowser();
      }
    }
    idx.byRepSortedDate.forEach(list=>list.sort((a,b)=>(idx.rowMeta.get(a)?.dateMs||0)-(idx.rowMeta.get(b)?.dateMs||0)));
    idx.byTeamSortedDate.forEach(list=>list.sort((a,b)=>(idx.rowMeta.get(a)?.dateMs||0)-(idx.rowMeta.get(b)?.dateMs||0)));
    idx.dateSortedRows.sort((a,b)=>(idx.rowMeta.get(a)?.dateMs||0)-(idx.rowMeta.get(b)?.dateMs||0));
    finalizeResearchSourceIndex(idx,source);
    index.sources[source]=idx;
    timing.mark(`indexed ${labelSource(source)}`, `${rows.length.toLocaleString()} rows`);
    updateProgress(`${reason} · ${labelSource(source)} indexed`, start + span*Math.min(.95,done/totalRows));
    await yieldToBrowser();
  }
  const reps=Array.from(globalReps.values()).sort((a,b)=>(a.team||'').localeCompare(b.team||'')||a.name.localeCompare(b.name));
  const repsByTeam=new Map();
  reps.forEach(r=>{ const t=r.team||'No Team'; if(!repsByTeam.has(t)) repsByTeam.set(t,[]); repsByTeam.get(t).push(r); });
  const teamCounts=Array.from(repsByTeam.entries()).filter(([team])=>team&&team!=='No Team').map(([team,list])=>({team,count:list.length})).sort((a,b)=>a.team.localeCompare(b.team));
  index.reps=reps; index.repsByTeam=repsByTeam; index.teamCounts=teamCounts;
  state.dataIndex=index; state.indexes=index.sources;
  state.teamIndexCache=restoreTeamIndex(serializeTeamIndex(index));
  updateProgress(`${reason} complete`, end);
  await yieldToBrowser();
  timing.end(`${totalRows.toLocaleString()} rows`);
  return index;
}

function beginDataUpdate(reason='data update'){
  state.dataUpdateBatch={reason,dirty:false,teamBuild:false,save:false,render:false};
}
async function endDataUpdate(reason='data update', progressStart=55){
  const batch=state.dataUpdateBatch; state.dataUpdateBatch=null;
  if(batch?.dirty) markDataIndexDirty(reason);
  if(batch?.teamBuild) rebuildTeams();
  if(batch?.render){ setStatus(); renderEditModelSafe(); renderTeamSelect(); updateResearchCacheBadge(); }
  if(batch?.save) scheduleImportedDataSave(reason,{delay:500});
}

async function finishDataChanged(reason='Data updated', progressStart=55){
  const timing=importTiming(reason);
  markDataIndexDirty(reason);
  rebuildTeams();
  timing.mark('building date/non-date datasets', 'source rows normalized; research indexes deferred');
  updateProgress('Preparing headers...',94,{force:true});
  await yieldToBrowser();
  setStatus(); renderEditModelSafe(); renderTeamSelect(); updateResearchCacheBadge(); if(els.researchModal?.classList.contains('open')) scheduleResearchCacheWarm('data updated');
  timing.mark('preparing headers/dropdowns', 'visible controls refreshed');
  updateProgress('Scheduling local IndexedDB cache save...',96,{force:true});
  scheduleImportedDataSave(reason,{delay:500});
  updateProgress('Preparing headers complete',100,{force:true});
  await yieldToBrowser();
  timing.end('essential import flow complete; indexes build on first research/model need; local save scheduled');
}
function activeModelForImport(){ return state.editModel || findModel(els.runModelSelect?.value) || state.models[0] || normalizeModelForStorage({criteria:[]}); }
function sourceRowsFromStoredAoa(source, model, strict=true){
  if(isCategorizedSource(source) || TEAM_TOTAL_SOURCE_KEYS.includes(source)) return {headers:getHeaders(source),rows:getRowsRaw(source),headerRow:0,startCol:0,detected:false,matchCount:getHeaders(source).length,fullRow:true,manualHeaders:[]};
  const cfg=getSourceSetting(model,source);
  const hr=Math.max(0,(Number(cfg.headerRow)||1)-1), sc=Math.max(0,(Number(cfg.startCol)||1)-1);
  let aoa=[];
  if(source==='retail_sv2') aoa=state.data.retail.sv2Aoa;
  if(source==='retail_wiper') aoa=state.data.retail.wiperAoa;
  if(source==='referral_sv2') aoa=state.data.referral.sv2Aoa;
  if(source==='referral_wiper') aoa=state.data.referral.wiperAoa;
  if(source==='qa') aoa=state.data.qa.aoa;
  if(source==='checklist') aoa=state.data.checklist.aoa;
  if(source==='documented_coaching') aoa=state.data.documented_coaching.aoa;
  if(source==='comp_calls') aoa=state.data.comp_calls.aoa;
  if(isCustomSource(source)) aoa=customSource(source)?.aoa||[];
  const pack=sheetRowsFromAoa(aoa||[],hr,sc,strict,expectedHeadersForSource(source,model),source,model,cfg.manualHeaders||[]);
  if((pack.detected || pack.fullRow) && model && model.sourceSettings && model.sourceSettings[source]){
    model.sourceSettings[source].headerRow=pack.headerRow+1;
    model.sourceSettings[source].startCol=pack.startCol+1;
  }
  return pack;
}
async function sourceRowsFromStoredAoaAsync(source, model, strict=true, label='Building imported rows', start=20, end=38){
  if(isCategorizedSource(source) || TEAM_TOTAL_SOURCE_KEYS.includes(source)) return {headers:getHeaders(source),rows:getRowsRaw(source),headerRow:0,startCol:0,detected:false,matchCount:getHeaders(source).length,fullRow:true,manualHeaders:[]};
  const cfg=getSourceSetting(model,source);
  const hr=Math.max(0,(Number(cfg.headerRow)||1)-1), sc=Math.max(0,(Number(cfg.startCol)||1)-1);
  let aoa=[];
  if(source==='retail_sv2') aoa=state.data.retail.sv2Aoa;
  if(source==='retail_wiper') aoa=state.data.retail.wiperAoa;
  if(source==='referral_sv2') aoa=state.data.referral.sv2Aoa;
  if(source==='referral_wiper') aoa=state.data.referral.wiperAoa;
  if(source==='qa') aoa=state.data.qa.aoa;
  if(source==='checklist') aoa=state.data.checklist.aoa;
  if(source==='documented_coaching') aoa=state.data.documented_coaching.aoa;
  if(source==='comp_calls') aoa=state.data.comp_calls.aoa;
  if(isCustomSource(source)) aoa=customSource(source)?.aoa||[];
  const pack=await sheetRowsFromAoaAsync(aoa||[],hr,sc,strict,expectedHeadersForSource(source,model),source,model,cfg.manualHeaders||[],label,start,end);
  if((pack.detected || pack.fullRow) && model && model.sourceSettings && model.sourceSettings[source]){
    model.sourceSettings[source].headerRow=pack.headerRow+1;
    model.sourceSettings[source].startCol=pack.startCol+1;
  }
  return pack;
}
function applyModelSourceSettings(model){
  if(!model) return;
  ensureSourceSettings(model);
  if(state.data.retail.sv2Aoa?.length){ const p=sourceRowsFromStoredAoa('retail_sv2',model,true); state.data.retail.headers.sv2=p.headers; state.data.retail.sv2=p.rows.map(r=>normalizeStatRow(r,'retail','sv2',getSourceSetting(model,'retail_sv2').columns,p.headers)); }
  if(state.data.retail.wiperAoa?.length){ const p=sourceRowsFromStoredAoa('retail_wiper',model,true); state.data.retail.headers.wiper=p.headers; state.data.retail.wiper=p.rows.map(r=>normalizeStatRow(r,'retail','wiper',getSourceSetting(model,'retail_wiper').columns,p.headers)); }
  if(state.data.referral.sv2Aoa?.length){ const p=sourceRowsFromStoredAoa('referral_sv2',model,true); state.data.referral.headers.sv2=p.headers; state.data.referral.sv2=p.rows.map(r=>normalizeStatRow(r,'referral','sv2',getSourceSetting(model,'referral_sv2').columns,p.headers)); const found=state.data.referral.itacAoa?.length?{aoa:state.data.referral.itacAoa,headers:state.data.referral.headers.itac||[],headerRow:1,phone:findHeader(state.data.referral.headers.itac||[],['PHONE_LOGINID','Phone Login ID']),offered:findHeader(state.data.referral.headers.itac||[],['Offered ITAC','ITAC Offered']),accepted:findHeader(state.data.referral.headers.itac||[],['Accepted ITAC','ITAC Accepted'])}:null; const itacRows=found?.phone?parseItacRows(found):(state.data.referral.itac||[]); state.data.referral.itac=itacRows; attachItacToReferralSv2(state.data.referral.sv2,itacRows,p.headers); ['Offered ITAC','Accepted ITAC'].forEach(h=>{if(!state.data.referral.headers.sv2.includes(h)) state.data.referral.headers.sv2.push(h);}); }
  if(state.data.referral.wiperAoa?.length){ const p=sourceRowsFromStoredAoa('referral_wiper',model,true); state.data.referral.headers.wiper=p.headers; state.data.referral.wiper=p.rows.map(r=>normalizeStatRow(r,'referral','wiper',getSourceSetting(model,'referral_wiper').columns,p.headers)); }
  if(state.data.qa.aoa?.length){ const p=sourceRowsFromStoredAoa('qa',model,true); const q=getSourceSetting(model,'qa').columns||{}; state.data.qa.headers=p.headers; state.data.qa.rows=p.rows.map(r=>normalizeQARow(r,p.headers,q)).filter(r=>r._repKey||r._team||Number.isFinite(r._score)); }
  if(state.data.checklist.aoa?.length){ const p=sourceRowsFromStoredAoa('checklist',model,true); const c=getSourceSetting(model,'checklist').columns||{}; state.data.checklist.headers=p.headers; state.data.checklist.rows=p.rows.map(r=>normalizeChecklistRow(r,p.headers,c,'checklist')).filter(r=>r._repKey||r._team); }
  if(state.data.documented_coaching.aoa?.length){ const p=sourceRowsFromStoredAoa('documented_coaching',model,true); const c=getSourceSetting(model,'documented_coaching').columns||{}; state.data.documented_coaching.headers=p.headers; state.data.documented_coaching.rows=p.rows.map(r=>normalizeChecklistRow(r,p.headers,c,'documented_coaching')).filter(r=>r._repKey||r._team); }
  if(state.data.comp_calls.aoa?.length){ const p=sourceRowsFromStoredAoa('comp_calls',model,true); const c=getSourceSetting(model,'comp_calls').columns||{}; state.data.comp_calls.headers=p.headers; state.data.comp_calls.rows=p.rows.map(r=>normalizeChecklistRow(r,p.headers,c,'comp_calls')).filter(r=>r._repKey||r._team); }
  customSourceKeys().forEach(src=>{ if(customSource(src)?.aoa?.length){ const p=sourceRowsFromStoredAoa(src,model,false); setSourceRowsAndHeaders(src,p.headers,p.rows,model); } });
  rebuildTeams();
  markDataIndexDirty('source settings applied');
}

async function loadRetailFile(file,options={}){
  showProgress('Reading retail file...',3);
  try{
    await yieldToBrowser();
    const wb=options.workbook||await readFileWorkbook(file);
    updateProgress('Preparing retail workbook...',18); await yieldToBrowser();
    const sv2Name=pickBestSheetForSource(wb,'retail_sv2',activeModelForImport(),SOURCE_SHEET_HINTS.retail_sv2);
    const wiperName=pickBestSheetForSource(wb,'retail_wiper',activeModelForImport(),SOURCE_SHEET_HINTS.retail_wiper);
    await storeWorkbookAsync('retail',file,wb,'Preparing retail workbook',12,24,{sheetNames:workbookSheetsNeededForImport('retail',wb,[sv2Name,wiperName])});
    const m=activeModelForImport(); ensureSourceSettings(m); m.sourceSettings.retail_sv2.sheetName=sv2Name; m.sourceSettings.retail_wiper.sheetName=wiperName;
    const sv2Aoa=sheetAoa(wb,sv2Name), wiperAoa=sheetAoa(wb,wiperName);
    state.data.retail.sv2Aoa=sv2Aoa; state.data.retail.wiperAoa=wiperAoa; state.books.retail.selectedSheets.retail_sv2=sv2Name; state.books.retail.selectedSheets.retail_wiper=wiperName;
    const controlRoster=await buildControlRosterFromWorkbookAsync('retail',wb,'Building retail Control roster',24,32);
    const teamTotals=await buildTeamTotalsFromWorkbook('retail',wb,'Retail Team Totals.xlsx',32,38);
    updateProgress('Normalizing retail rows...',38); await yieldToBrowser();
    const sv2=await sourceRowsFromStoredAoaAsync('retail_sv2',m,true,'Building retail SV2 dataset',28,40);
    const wip=await sourceRowsFromStoredAoaAsync('retail_wiper',m,true,'Building retail wiper dataset',40,47);
    const sv2Rows=await mapRowsChunked(sv2.rows,r=>normalizeStatRow(r,'retail','sv2',getSourceSetting(m,'retail_sv2').columns,sv2.headers),null,'Normalizing retail SV2 rows',40,47);
    const wiperRows=await mapRowsChunked(wip.rows,r=>normalizeStatRow(r,'retail','wiper',getSourceSetting(m,'retail_wiper').columns,wip.headers),null,'Normalizing retail wiper rows',47,54);
    state.data.retail={...state.data.retail,fileName:file.name,sv2:sv2Rows,wiper:wiperRows,controlRoster,teamTotals,headers:{sv2:sv2.headers,wiper:wip.headers}}; bumpVersion('roster'); invalidateRosterIndex('retail control roster imported'); ensureRosterIndex();
    els.retailFileName.textContent=`${file.name}${controlRoster.length?` · ${controlRoster.length.toLocaleString()} Control reps`:''} · ${teamTotalsSummaryText('retail')}`;
    renderTeamTotalsImportControls();
    markRetailPersistenceDirty('retail import complete');
    await finishDataChanged('retail import',55);
    updateProgress('Saving retail import to IndexedDB...',97,{force:true});
    await flushImportCacheSave('retail import complete');
    if(!options.fromCentral) await saveAllStarWorkbookToCoachTools('monthlyRetail',file,wb,'allstar-retail');
    return true;
  }catch(err){ console.error(err); alert('Retail import failed. Check the console for details.'); return false; }
  finally{ hideProgress(); }
}

function normalizePhoneLoginId(value){
  return String(value??'').trim().replace(/\.0+$/,'').replace(/[^0-9A-Za-z]/g,'').toUpperCase();
}
function findItacSheetInWorkbook(wb){
  let best=null;
  (wb.SheetNames||[]).forEach(sheetName=>{
    const aoa=sheetAoaPreview(wb,sheetName,30)||[];
    const scan=Math.min(30,aoa.length);
    for(let r=0;r<scan;r++){
      const headers=(aoa[r]||[]).map(v=>String(v??'').trim());
      const phone=findHeader(headers,['PHONE_LOGINID','Phone Login ID','PHONE LOGINID','Login ID']);
      const offered=findHeader(headers,['Offered ITAC','ITAC Offered','Offered_ITAC']);
      const accepted=findHeader(headers,['Accepted ITAC','ITAC Accepted','Accepted_ITAC']);
      const score=(phone?5:0)+(offered?3:0)+(accepted?3:0)+(/itac/i.test(sheetName)?2:0);
      if(phone && (offered||accepted) && (!best||score>best.score)) best={sheetName,headerRow:r+1,headers,phone,offered,accepted,score};
    }
  });
  if(best) best.aoa=sheetAoa(wb,best.sheetName);
  return best;
}
function parseItacRows(found){
  if(!found) return [];
  const rows=[];
  const headers=found.headers;
  for(let r=found.headerRow;r<found.aoa.length;r++){
    const arr=found.aoa[r]||[];
    if(!arr.some(v=>String(v??'').trim()!=='')) continue;
    const row={}; headers.forEach((h,i)=>{ if(h) row[h]=arr[i]; });
    const phoneKey=normalizePhoneLoginId(row[found.phone]);
    if(!phoneKey) continue;
    row._sourceKey='referral_itac'; row._phoneLoginId=phoneKey;
    row._offeredITAC=toNum(row[found.offered]);
    row._acceptedITAC=toNum(row[found.accepted]);
    rows.push(row);
  }
  return rows;
}
function attachItacToReferralSv2(sv2Rows,itacRows,sv2Headers){
  const phoneHeader=findHeader(sv2Headers||[],['Phone_ID','Phone ID','PHONE_ID','PhoneID']);
  if(!phoneHeader) return {matched:0,unmatched:itacRows.length,phoneHeader:'',rows:sv2Rows};
  const byPhone=new Map();
  (itacRows||[]).forEach(r=>{
    const key=r._phoneLoginId; if(!key) return;
    if(!byPhone.has(key)) byPhone.set(key,[]);
    byPhone.get(key).push(r);
  });
  let matched=0;
  (sv2Rows||[]).forEach(row=>{
    const key=normalizePhoneLoginId(row[phoneHeader]);
    const hits=byPhone.get(key)||[];
    if(!hits.length) return;
    matched++;
    const offered=hits.reduce((a,r)=>a+(Number.isFinite(r._offeredITAC)?r._offeredITAC:0),0);
    const accepted=hits.reduce((a,r)=>a+(Number.isFinite(r._acceptedITAC)?r._acceptedITAC:0),0);
    row['Offered ITAC']=offered;
    row['Accepted ITAC']=accepted;
    row._itacPhoneLoginId=key;
    row._itacMatched=true;
  });
  return {matched,unmatched:Math.max(0,byPhone.size-matched),phoneHeader,rows:sv2Rows};
}

async function loadReferralFile(file,options={}){
  showProgress('Reading referral file...',3);
  try{
    await yieldToBrowser();
    const wb=options.workbook||await readFileWorkbook(file);
    updateProgress('Preparing referral workbook...',18); await yieldToBrowser();
    const sv2Name=pickBestSheetForSource(wb,'referral_sv2',activeModelForImport(),SOURCE_SHEET_HINTS.referral_sv2);
    const wiperName=pickBestSheetForSource(wb,'referral_wiper',activeModelForImport(),SOURCE_SHEET_HINTS.referral_wiper);
    const itacFound=findItacSheetInWorkbook(wb);
    await storeWorkbookAsync('referral',file,wb,'Preparing referral workbook',12,24,{sheetNames:workbookSheetsNeededForImport('referral',wb,[sv2Name,wiperName,itacFound?.sheetName])});
    const m=activeModelForImport(); ensureSourceSettings(m); m.sourceSettings.referral_sv2.sheetName=sv2Name; m.sourceSettings.referral_wiper.sheetName=wiperName;
    const sv2Aoa=sheetAoa(wb,sv2Name), wiperAoa=sheetAoa(wb,wiperName), itacAoa=itacFound?.aoa||[];
    state.data.referral.sv2Aoa=sv2Aoa; state.data.referral.wiperAoa=wiperAoa; state.data.referral.itacAoa=itacAoa;
    state.books.referral.selectedSheets.referral_sv2=sv2Name; state.books.referral.selectedSheets.referral_wiper=wiperName; if(itacFound) state.books.referral.selectedSheets.referral_itac=itacFound.sheetName;
    const controlRoster=await buildControlRosterFromWorkbookAsync('referral',wb,'Building referral Control roster',24,32);
    const teamTotals=await buildTeamTotalsFromWorkbook('referral',wb,'Referral Team Totals.xlsx',32,38);
    updateProgress('Normalizing referral rows...',38); await yieldToBrowser();
    const sv2=await sourceRowsFromStoredAoaAsync('referral_sv2',m,true,'Building referral SV2 dataset',28,40);
    const wip=await sourceRowsFromStoredAoaAsync('referral_wiper',m,true,'Building referral wiper dataset',40,47);
    const sv2Rows=await mapRowsChunked(sv2.rows,r=>normalizeStatRow(r,'referral','sv2',getSourceSetting(m,'referral_sv2').columns,sv2.headers),null,'Normalizing referral SV2 rows',40,47);
    const wiperRows=await mapRowsChunked(wip.rows,r=>normalizeStatRow(r,'referral','wiper',getSourceSetting(m,'referral_wiper').columns,wip.headers),null,'Normalizing referral wiper rows',47,51);
    updateProgress('Matching ITAC to referral SV2 Phone_ID...',52); await yieldToBrowser();
    const itacRows=parseItacRows(itacFound);
    const itacMatch=attachItacToReferralSv2(sv2Rows,itacRows,sv2.headers);
    const mergedSv2Headers=[...sv2.headers]; ['Offered ITAC','Accepted ITAC'].forEach(h=>{if(!mergedSv2Headers.includes(h)) mergedSv2Headers.push(h);});
    state.data.referral={...state.data.referral,fileName:file.name,sv2:sv2Rows,wiper:wiperRows,itac:itacRows,itacAoa,controlRoster,teamTotals,headers:{sv2:mergedSv2Headers,wiper:wip.headers,itac:itacFound?.headers||[]},itacSheetName:itacFound?.sheetName||''}; bumpVersion('roster'); invalidateRosterIndex('referral control roster imported'); ensureRosterIndex();
    const itacStatus=itacFound?` · ITAC ${itacMatch.matched.toLocaleString()} SV2 rows matched via ${itacMatch.phoneHeader||'Phone_ID missing'}`:' · no ITAC sheet detected';
    els.referralFileName.textContent=`${file.name}${controlRoster.length?` · ${controlRoster.length.toLocaleString()} Control reps`:''}${itacStatus} · ${teamTotalsSummaryText('referral')}`;
    renderTeamTotalsImportControls();
    markReferralPersistenceDirty('referral import complete');
    await finishDataChanged('referral import',55);
    updateProgress('Saving referral import to IndexedDB...',97,{force:true});
    await flushImportCacheSave('referral import complete');
    if(!options.fromCentral) await saveAllStarWorkbookToCoachTools('monthlyReferral',file,wb,'allstar-referral');
    return true;
  }catch(err){ console.error(err); alert('Referral import failed. Check the console for details.'); return false; }
  finally{ hideProgress(); }
}
function findHeaderFromExpected(headers, preferred, fallbacks){
  const names=[];
  if(plainHeaderName(preferred)) names.push(plainHeaderName(preferred));
  (fallbacks||[]).forEach(x=>{ if(plainHeaderName(x) && !names.some(n=>norm(n)===norm(x))) names.push(x); });
  return findHeader(headers,names);
}
function normalizeQARow(row, headers, qaColumns){
  const q={...(SOURCE_SETTING_DEFAULTS.qa.columns||{}),...(qaColumns||{})};
  const agentH=findHeaderFromExpected(headers,q.agent,['Agent Name','AgentName']);
  let teamH=findHeaderFromExpected(headers,q.team,['Team']);
  const trueTeamH=findHeader(headers,['Team']);
  if(trueTeamH && /evaluator/i.test(String(teamH||''))) teamH=trueTeamH;
  const scoreH=findHeaderFromExpected(headers,q.score,['Score %','Score%','Score Percent','Evaluation Score']);
  const interactionH=findHeaderFromExpected(headers,q.interactionDate,['Interaction start Time','Interaction Start Time','Interaction Start','Start Time','Date']);
  const assignedH=findHeaderFromExpected(headers,q.assignedDate,['Assigned Date','Date Assigned','Assignment Date']);
  const dateH=selectedDateHeaderForSource('qa',headers,q);
  const rep=repNameFromColumns(row,headers,{...q,nameMode:q.nameMode||'full',fullName:q.fullName||q.agent,convertLastFirst:!!q.convertLastFirst},['Agent Name','AgentName']);
  const interactionDate=parseDateOnly(row[interactionH]);
  const assignedDate=parseDateOnly(row[assignedH]);
  const selectedDate=dateH ? parseDateOnly(row[dateH]) : null;
  const qaTeam=canonicalCoachName(row[teamH]??'');
  const team=q.skipTeamBuild ? '' : qaTeam;
  return {...row,_sourceKey:'qa',_sourceArea:'',_rep:rep,_repKey:nameKey(rep),_team:team,_qaTeam:qaTeam,_qaTeamKey:coachNameKey(qaTeam),_score:normalizeScore(row[scoreH]),_interactionDate:interactionDate,_assignedDate:assignedDate,_date:selectedDate||interactionDate};
}
function normalizeScore(v){ const n=toNum(v); if(!Number.isFinite(n)) return NaN; return n<=1?n*100:n; }
async function loadQAFile(file){
  return processImportedSource('qa',file,{label:'QA Stats',bookKey:'qa'});
}
function normalizeChecklistRow(row, headers, columns, source='checklist'){
  const defaults=SOURCE_SETTING_DEFAULTS[source]?.columns||SOURCE_SETTING_DEFAULTS.checklist.columns||{};
  const c={...defaults,...(columns||{})};
  const repFallbacks=source==='comp_calls'
    ? ['CSR/SSR Name (This is the person being complimented)','CSR/SSR Name','Representative','Associate Name','Associate','Agent Name','Rep']
    : (source==='documented_coaching' ? ['Associate name','Associate Name','Associate','Agent Name','Rep'] : ['Associate Name','Associate','Agent Name','Rep']);
  const teamFallbacks=source==='comp_calls'
    ? ['CSR Team/Coach','Coach Assigned','Coach','Team','Job Coach']
    : (source==='documented_coaching' ? ['Job Coach','Coach Assigned','Coach','Team'] : ['Coach Assigned','Coach','Team','Job Coach']);
  const coachH=findHeaderFromExpected(headers,c.team,teamFallbacks);
  const dateH=selectedDateHeaderForSource(source,headers,c);
  const textH=findHeaderFromExpected(headers,c.text,source==='comp_calls'?['Compliment','Comment','Comments','Notes']:['Notes','Comment','Description','Item']);
  const rep=repNameFromColumns(row,headers,{...c,nameMode:c.nameMode||'full',fullName:c.fullName||c.rep,convertLastFirst:!!c.convertLastFirst},repFallbacks);
  const team=c.skipTeamBuild ? '' : canonicalCoachName(row[coachH]??'');
  return {...row,_sourceKey:source,_sourceArea:sourceAreaForSource(source),_rep:rep,_repKey:nameKey(rep),_team:team,_date:dateH?row[dateH]:'',_text:textH?String(row[textH]??''):''};
}

async function clearDirectQAFile(){
  state.data.qa_direct={fileName:'',rows:[],headers:[],aoa:[],sheetName:''};
  if(els.qaDirectFile) els.qaDirectFile.value='';
  restoreImportFileLabels();
  markDataIndexDirty('direct QA team-score override cleared');
  markSourceCacheDirty(QA_DIRECT_SOURCE,'direct QA team-score override cleared'); scheduleImportedDataSave('direct QA team-score override cleared',{delay:250});
  alert('Direct QA override cleared. Direct mode will use the main QA Stats upload.');
}
async function loadDirectQAFile(file){
  return processImportedSource(QA_DIRECT_SOURCE,file,{label:'Direct QA Team Score Override',bookKey:QA_DIRECT_SOURCE});
}
async function loadChecklistLikeFile(file, source){
  return processImportedSource(source,file,{label:labelSource(source),bookKey:source});
}
async function loadChecklistFile(file){ return loadChecklistLikeFile(file,'checklist'); }




function slugSourceName(name){ return String(name||'custom').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,40)||'custom'; }
function uniqueCustomSourceKey(name){ let base='custom_'+slugSourceName(name), key=base+'_'+Date.now().toString(36).slice(-5), i=1; while(allSourceKeys().includes(key)) key=base+'_'+(i++); return key; }
function customSourceWarnings(source){
  const c=customSource(source)||{}, cfg=getSourceSetting(activeModelForImport(),source), cols=cfg.columns||c.columns||{}, headers=c.headers||[], warnings=[];
  relevantMappingKeys(source,cfg.framework||c.framework||'generic_table').forEach(k=>{ if(cols[k] && !findHeader(headers,[cols[k]])) warnings.push(`Missing mapped ${SOURCE_MAPPING_LABELS[k]||k}: ${cols[k]}`); });
  if(!(c.rows||[]).length) warnings.push('No rows imported. Check sheet/header layout.');
  if(!headers.length) warnings.push('No headers detected. Use Preview / Headers to set the header row or manual headers.');
  if(isCustomWeeklyStatSource(source) && !cols.week && !cols.date) warnings.push('Weekly source needs a mapped Week or Date column for weekly grouping.');
  return warnings;
}
function renderCustomSourcesList(){
  if(!els.customSourcesList) return;
  els.customSourcesList.innerHTML=(state.customSources||[]).map(c=>`<div class="checkResultRow"><strong>${esc(c.name)}</strong><div class="checkResultMeta">${esc(c.fileName||'No file')} · ${esc(c.sheetName||'No sheet')} · ${(c.rows||[]).length.toLocaleString()} rows · ${(c.headers||[]).length} headers · ${esc(frameworkDef(c.framework||'generic_table').label)} · key ${esc(c.sourceKey)}</div><div class="row"><button class="smallBtn" data-custom-trouble="${esc(c.sourceKey)}" type="button">Preview / Headers</button><button class="smallBtn" data-custom-rename="${esc(c.sourceKey)}" type="button">Rename</button><button class="smallBtn" data-custom-duplicate="${esc(c.sourceKey)}" type="button">Duplicate Config</button><button class="smallBtn red" data-custom-delete="${esc(c.sourceKey)}" type="button">Delete</button></div></div>`).join('') || '<div class="checkResultMeta">No custom sources imported yet.</div>';
  els.customSourcesList.querySelectorAll('[data-custom-trouble]').forEach(b=>b.onclick=()=>openTroubleshoot(b.dataset.customTrouble));
  els.customSourcesList.querySelectorAll('[data-custom-rename]').forEach(b=>b.onclick=()=>{ const c=customSource(b.dataset.customRename); if(!c) return; const name=(prompt('Rename custom source',c.name)||'').trim(); if(name){ c.name=name; markImportCacheDirty('misc','customSources','custom source renamed'); scheduleImportedDataSave('custom source renamed',{delay:500}); renderCustomSourcesList(); renderEditModelSafe(); }});
  els.customSourcesList.querySelectorAll('[data-custom-duplicate]').forEach(b=>b.onclick=()=>{ const c=customSource(b.dataset.customDuplicate); if(!c) return; const cp=clonePlain(c); cp.id=id(); cp.name=c.name+' Copy'; cp.sourceKey=uniqueCustomSourceKey(cp.name); state.customSources.push(cp); state.books[cp.sourceKey]={fileName:cp.fileName,sheetNames:cp.sheetNames||[],aoaBySheet:cp.aoaBySheet||{},selectedSheets:{[cp.sourceKey]:cp.sheetName||''}}; markImportCacheDirty('misc','customSources','custom source duplicated'); markBookCacheDirty(cp.sourceKey,'custom source duplicated'); scheduleImportedDataSave('custom source duplicated',{delay:500}); renderCustomSourcesList(); renderEditModelSafe(); });
  els.customSourcesList.querySelectorAll('[data-custom-delete]').forEach(b=>b.onclick=()=>{ const c=customSource(b.dataset.customDelete); if(c&&confirm(`Delete custom source "${c.name}"?`)){ state.customSources=state.customSources.filter(x=>x.sourceKey!==c.sourceKey); delete state.books[c.sourceKey]; (state.models||[]).forEach(m=>{ if(m.sourceSettings) delete m.sourceSettings[c.sourceKey]; }); markImportCacheDirty('misc','customSources','custom source deleted'); markImportCacheDirty('deletedBook',c.sourceKey,'custom source deleted'); markDataIndexDirty('custom source deleted'); scheduleImportedDataSave('custom source deleted',{delay:500}); renderCustomSourcesList(); renderEditModelSafe(); }});
}
async function loadCustomSourceFile(file,name){
  showProgress(`Reading ${name}...`,3);
  try{
    const wb=await readFileWorkbook(file); await yieldToBrowser();
    const sourceKey=uniqueCustomSourceKey(name);
    const sn=(wb.SheetNames||[])[0]||'';
    const aoaBySheet=sn?{[sn]:sheetAoa(wb,sn)}:{};
    const custom={id:id(),name,sourceKey,sourceType:'custom',fileName:file.name,rows:[],headers:[],aoa:aoaBySheet[sn]||[],sheetNames:wb.SheetNames||[],aoaBySheet,sheetName:sn,headerRow:1,startCol:1,manualHeaders:[],framework:'generic_table',columns:{nameMode:'auto',fullName:'',firstName:'',lastName:'',convertLastFirst:false,useDateColumn:null,skipTeamBuild:false,rep:'',team:'',coach:'',date:'',week:'',month:'',score:'',numerator:'',denominator:'',text:'',category:'',uniqueId:'',statPeriod:'week',weekStart:'sunday',dateBasis:'date'},aggregation:{}};
    state.customSources.push(custom); state.books[sourceKey]={fileName:file.name,sheetNames:custom.sheetNames,aoaBySheet,selectedSheets:{[sourceKey]:sn}};
    const m=activeModelForImport(); ensureSourceSettings(m); m.sourceSettings[sourceKey]=customSourceDefaultSettings(sourceKey);
    hideProgress();
    await processImportedSource(sourceKey,file,{label:name,workbook:wb,workbookAlreadyStored:true,sheetName:sn,aoa:aoaBySheet[sn],bookKey:sourceKey});
  }catch(err){ console.error(err); alert('Custom source import failed. Check the console for details.'); }
  finally{ hideProgress(); }
}

function availableTroubleSources(){ return allSourceKeys(); }
function openTroubleshoot(source='qa'){
  const src = sourceHasImportedData(source) ? source : (availableTroubleSources().find(sourceHasImportedData) || source);
  state.troubleshoot.source=src;
  const model=activeModelForImport(); ensureSourceSettings(model);
  const cfg=getSourceSetting(model,src);
  const book=bookForSource(src);
  state.troubleshoot.sheetName=preferredRequiredSheetForSource(book.sheetNames||[],src) || cfg.sheetName || book.selectedSheets[src] || book.sheetNames?.[0] || '';
  state.troubleshoot.headerRow=Math.max(1,Number(cfg.headerRow)||1);
  state.troubleshoot.startCol=Math.max(1,Number(cfg.startCol)||1);
  state.troubleshoot.manualHeaders=JSON.parse(JSON.stringify(cfg.manualHeaders||[]));
  state.troubleshoot.selectedCell=null;
  renderTroubleshootControls();
  openModal('troubleshootModal');
  renderTroubleshootPreview();
}
function renderTroubleshootControls(){
  if(!els.troubleSourceSelect) return;
  els.troubleSourceSelect.innerHTML=availableTroubleSources().map(src=>{
    const file=sourceFileName(src); const disabled=file?'':'disabled';
    return `<option value="${src}" ${src===state.troubleshoot.source?'selected':''} ${disabled}>${esc(labelSource(src))}${file?'':' — no file'}</option>`;
  }).join('');
  const src=state.troubleshoot.source;
  const book=bookForSource(src);
  const sheets=book.sheetNames?.length ? book.sheetNames : ['Current Data'];
  const requiredTroubleSheet=preferredRequiredSheetForSource(sheets,state.troubleshoot.source);
  if(requiredTroubleSheet) state.troubleshoot.sheetName=requiredTroubleSheet;
  if(!state.troubleshoot.sheetName || !sheets.includes(state.troubleshoot.sheetName)) state.troubleshoot.sheetName=sheets[0]||'';
  els.troubleSheetSelect.innerHTML=sheets.map(sn=>`<option value="${esc(sn)}" ${sn===state.troubleshoot.sheetName?'selected':''}>${esc(sn)}</option>`).join('');
  els.troubleHeaderRowInput.value=state.troubleshoot.headerRow||1;
  if(els.troubleStartColInput) els.troubleStartColInput.value=state.troubleshoot.startCol||1;
  const cfg=getSourceSetting(activeModelForImport(),src);
  const cols=cfg.columns||{};
  els.troubleNameMode.value=cols.nameMode||'auto';
  els.troubleConvertLastFirst.checked=!!cols.convertLastFirst;
  renderTroubleshootHeaderPreview();
}
function troubleshootAoa(){
  const src=state.troubleshoot.source;
  const book=bookForSource(src);
  const required=preferredRequiredSheetForSource(book.sheetNames||[],src);
  const sn=required || state.troubleshoot.sheetName;
  if(required && state.troubleshoot.sheetName!==required) state.troubleshoot.sheetName=required;
  return (book.aoaBySheet||{})[sn] || getSourceAoa(src) || [];
}
async function ensureTroubleshootSheetLoaded(){
  const src=state.troubleshoot.source, bookKey=sourceBookKey(src), book=bookForSource(src);
  const sn=preferredRequiredSheetForSource(book.sheetNames||[],src) || state.troubleshoot.sheetName;
  if(sn && !(book.aoaBySheet||{})[sn]) await ensureSheetLoaded(bookKey,sn);
}

function selectedTroublePack(){
  const src=state.troubleshoot.source;
  const model=activeModelForImport(); ensureSourceSettings(model);
  const hr=Math.max(0,(Number(state.troubleshoot.headerRow)||1)-1);
  const sc=Math.max(0,(Number(state.troubleshoot.startCol)||1)-1);
  return buildRowsFromLayout(troubleshootAoa(),hr,sc,false,state.troubleshoot.manualHeaders||[]);
}
function renderTroublesheetNameOptions(headers){
  const selected=(val)=>headers.some(h=>norm(h)===norm(val))?(headers.find(h=>norm(h)===norm(val))||''):'';
  const opt=(sel)=>`<option value=""></option>`+headers.map(h=>`<option value="${esc(h)}" ${h===sel?'selected':''}>${esc(h)}</option>`).join('');
  const src=state.troubleshoot.source;
  const cfg=getSourceSetting(activeModelForImport(),src);
  const cols=cfg.columns||{};
  const live=(el, fallback)=>el && el.dataset.source===src ? (el.value || fallback || '') : (fallback || '');
  const dateAuto=defaultDateHeaderForSource(src,headers);
  const savedUseDate=typeof cols.useDateColumn==='boolean' ? cols.useDateColumn : !!dateAuto;
  const liveUseDate=els.troubleUseDateColumn && els.troubleUseDateColumn.dataset.source===src ? els.troubleUseDateColumn.checked : savedUseDate;
  els.troubleFullNameColumn.innerHTML=opt(selected(live(els.troubleFullNameColumn,cols.fullName||cols.agent||cols.rep)));
  els.troubleFirstNameColumn.innerHTML=opt(selected(live(els.troubleFirstNameColumn,cols.firstName)));
  els.troubleLastNameColumn.innerHTML=opt(selected(live(els.troubleLastNameColumn,cols.lastName)));
  if(els.troubleTeamColumn) els.troubleTeamColumn.innerHTML=opt(selected(live(els.troubleTeamColumn,cols.team||cols.coach)));
  if(els.troubleDateColumn) els.troubleDateColumn.innerHTML=opt(selected(live(els.troubleDateColumn,cols.date||dateAuto)));
  [els.troubleFullNameColumn,els.troubleFirstNameColumn,els.troubleLastNameColumn,els.troubleTeamColumn,els.troubleSkipTeamBuild,els.troubleDateColumn,els.troubleUseDateColumn].filter(Boolean).forEach(x=>{ x.dataset.source=src; });
  if(els.troubleSkipTeamBuild) els.troubleSkipTeamBuild.checked=!!cols.skipTeamBuild;
  if(els.troubleUseDateColumn) els.troubleUseDateColumn.checked=liveUseDate;
  if(els.troubleDateColumn) els.troubleDateColumn.disabled=!(els.troubleUseDateColumn?.checked);
}
function renderTroubleshootHeaderPreview(){
  if(!els.troubleHeaderPreview) return;
  const pack=selectedTroublePack();
  const headers=pack.headers||[];
  els.troubleHeaderSummary.textContent=`${headers.length} headers found`;
  els.troubleHeaderPreview.innerHTML=headers.length ? headers.map((h,i)=>`<div class="troubleHeaderPill"><span>${esc(h)}</span><small>Column ${((pack.headerCols||[])[i]??i)+1}</small></div>`).join('') : '<div class="checkResultMeta">No headers found in this row yet.</div>';
  renderTroublesheetNameOptions(headers);
  renderTroubleCustomFrameworkPanel(headers);
  renderManualHeadersList();
}
function renderManualHeadersList(){
  const list=state.troubleshoot.manualHeaders||[];
  els.troubleManualHeaders.innerHTML=list.length ? list.map((m,i)=>`<div class="troubleManualItem"><span>${esc(m.name)} <small>(R${Number(m.row)+1}, C${Number(m.col)+1})</small></span><button class="smallBtn red" data-remove-manual-header="${i}" type="button">Remove</button></div>`).join('') : '<div class="checkResultMeta">No manually declared headers.</div>';
  els.troubleManualHeaders.querySelectorAll('[data-remove-manual-header]').forEach(b=>b.onclick=()=>{state.troubleshoot.manualHeaders.splice(Number(b.dataset.removeManualHeader),1); renderTroubleshootPreview(false); renderTroubleshootHeaderPreview();});
}
function renderTroubleshootPreview(resetCell=true){
  if(!els.troubleSheetPreview) return;
  const src=state.troubleshoot.source, book=bookForSource(src), sn=preferredRequiredSheetForSource(book.sheetNames||[],src) || state.troubleshoot.sheetName;
  if(sn && !(book.aoaBySheet||{})[sn] && (book.sheetNames||[]).includes(sn)){
    els.troubleSheetPreview.innerHTML='<div class="checkResultMeta">Loading worksheet from local IndexedDB...</div>';
    ensureSheetLoaded(sourceBookKey(src),sn).then(()=>renderTroubleshootPreview(resetCell)).catch(err=>{ console.error(err); els.troubleSheetPreview.innerHTML='<div class="checkResultMeta">Could not load worksheet from local IndexedDB.</div>'; });
    return;
  }
  const aoa=troubleshootAoa();
  const hr=Math.max(0,(Number(state.troubleshoot.headerRow)||1)-1);
  const maxRows=Math.min(60,aoa.length);
  const maxCols=Math.min(35,Math.max(0,...aoa.slice(0,maxRows).map(r=>(r||[]).length)));
  let html='<table class="troublePreviewTable"><thead><tr><th class="rowPick">Row</th>';
  for(let c=0;c<maxCols;c++) html+=`<th>C${c+1}</th>`;
  html+='</tr></thead><tbody>';
  for(let r=0;r<maxRows;r++){
    const row=aoa[r]||[];
    html+=`<tr class="${r===hr?'headerCandidate':''}"><td class="rowPick"><button class="smallBtn ${r===hr?'green':'gray'}" data-use-header-row="${r}" type="button">Use Row ${r+1}</button></td>`;
    for(let c=0;c<maxCols;c++){
      const selected=state.troubleshoot.selectedCell && state.troubleshoot.selectedCell.row===r && state.troubleshoot.selectedCell.col===c;
      html+=`<td class="${selected?'cellSelected':''}" data-trouble-cell="1" data-row="${r}" data-col="${c}" title="Row ${r+1}, Column ${c+1}">${esc(row[c]??'')}</td>`;
    }
    html+='</tr>';
  }
  html+='</tbody></table>';
  els.troubleSheetPreview.innerHTML=html || '<div class="checkResultMeta">No preview available.</div>';
  els.troubleSheetPreview.querySelectorAll('[data-use-header-row]').forEach(b=>b.onclick=()=>{ state.troubleshoot.headerRow=Number(b.dataset.useHeaderRow)+1; els.troubleHeaderRowInput.value=state.troubleshoot.headerRow; renderTroubleshootPreview(false); renderTroubleshootHeaderPreview(); });
  els.troubleSheetPreview.querySelectorAll('[data-trouble-cell]').forEach(td=>td.onclick=()=>{
    const row=Number(td.dataset.row), col=Number(td.dataset.col);
    state.troubleshoot.selectedCell={row,col,value:td.textContent||''};
    els.troubleSelectedCell.value=`Row ${row+1}, Column ${col+1}`;
    els.troubleManualHeaderName.value=(td.textContent||'').trim();
    renderTroubleshootPreview(false);
  });
  if(resetCell){ els.troubleSelectedCell.value=''; els.troubleManualHeaderName.value=''; }
  renderTroubleshootHeaderPreview();
}
function declareTroubleHeader(){
  const cell=state.troubleshoot.selectedCell;
  if(!cell){ alert('Click a cell in the preview first.'); return; }
  const name=plainHeaderName(els.troubleManualHeaderName.value || cell.value);
  if(!name){ alert('Type a header name to use for this column.'); return; }
  const list=state.troubleshoot.manualHeaders||[];
  const existing=list.find(m=>Number(m.col)===cell.col);
  if(existing){ existing.name=name; existing.row=cell.row; }
  else list.push({row:cell.row,col:cell.col,name});
  state.troubleshoot.manualHeaders=list;
  renderTroubleshootPreview(false);
  renderTroubleshootHeaderPreview();
}
function currentTroubleNameSettings(){
  return {
    nameMode:els.troubleNameMode.value||'auto',
    fullName:els.troubleFullNameColumn.value||'',
    firstName:els.troubleFirstNameColumn.value||'',
    lastName:els.troubleLastNameColumn.value||'',
    convertLastFirst:!!els.troubleConvertLastFirst.checked,
    team:els.troubleTeamColumn?.value||'',
    skipTeamBuild:!!els.troubleSkipTeamBuild?.checked,
    date:els.troubleUseDateColumn?.checked ? (els.troubleDateColumn?.value||'') : '',
    useDateColumn:!!els.troubleUseDateColumn?.checked
  };
}
function updateAllModelsForSource(source, updater){
  (state.models||[]).forEach(m=>{ ensureSourceSettings(m); updater(m.sourceSettings[source]); });
  if(state.editModel){ ensureSourceSettings(state.editModel); updater(state.editModel.sourceSettings[source]); }
}
async function applyTroubleshootSelection(){
  const src=state.troubleshoot.source;
  const book=bookForSource(src);
  const required=preferredRequiredSheetForSource(book.sheetNames||[],src);
  const sn=required || els.troubleSheetSelect.value || state.troubleshoot.sheetName;
  const hr=Math.max(1,Number(els.troubleHeaderRowInput.value)||state.troubleshoot.headerRow||1);
  const sc=Math.max(1,Number(els.troubleStartColInput?.value)||state.troubleshoot.startCol||1);
  showProgress(`Updating ${labelSource(src)} headers...`,8);
  try{
    await yieldToBrowser();
    state.troubleshoot.sheetName=sn; state.troubleshoot.headerRow=hr; state.troubleshoot.startCol=sc;
    await ensureSheetLoaded(sourceBookKey(src),sn);
    const aoa=applySourceSheetChoice(src,sn);
    const nameCols=currentTroubleNameSettings();
    if(isCustomSource(src)){ const fw=els.troubleCustomFrameworkPanel?.querySelector('#troubleSourceFramework')?.value||sourceFramework(src)||'generic_table'; const c=customSource(src); if(c) c.framework=fw; updateAllModelsForSource(src,cfg=>{ cfg.framework=fw; cfg.columns=cfg.columns||{}; }); }
    updateAllModelsForSource(src,cfg=>{
      cfg.sheetName=sn; cfg.headerRow=hr; cfg.startCol=sc; cfg.manualHeaders=JSON.parse(JSON.stringify(state.troubleshoot.manualHeaders||[]));
      cfg.columns={...(cfg.columns||{}),...nameCols};
      if(src==='qa'){
        cfg.columns.agent=els.troubleFullNameColumn.value || cfg.columns.agent || 'Agent Name';
      }
      if(isChecklistLikeSource(src)){
        const baseCols=SOURCE_SETTING_DEFAULTS[src]?.columns || SOURCE_SETTING_DEFAULTS.checklist.columns || {};
        cfg.columns.rep=els.troubleFullNameColumn.value || cfg.columns.rep || baseCols.rep || baseCols.fullName || 'Associate Name';
      }
    });
    const model=activeModelForImport(); ensureSourceSettings(model);
    const cfg=getSourceSetting(model,src);
    updateProgress(`Rebuilding ${labelSource(src)} rows...`,36); await yieldToBrowser();
    const pack=sheetRowsFromAoa(aoa,hr-1,sc-1,true,expectedHeadersForSource(src,model),src,model,cfg.manualHeaders||[]);
    setSourceRowsAndHeaders(src,pack.headers,pack.rows,model);
    saveModels();
    await finishDataChanged(`${labelSource(src)} troubleshoot update`,58);
    els.troubleStatus.textContent=`Updated ${labelSource(src)} from sheet “${sn}”, row ${hr}, column ${sc}.`;
  }catch(err){ console.error(err); alert('Troubleshoot update failed. Check the console for details.'); }
  finally{ hideProgress(); }
}
function renderEditModelSafe(){ if(state.editModel) renderEditModel(); populateRunModels(); }
