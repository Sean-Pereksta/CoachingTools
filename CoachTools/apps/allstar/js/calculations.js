/* Model filters, scoring inputs, QA modes, Display Column, and criterion calculations.
 * Behavior-preserving extraction from the definitive All-Star application.
 */
'use strict';

function qaDateFromRow(row, mode){
  if(!row) return '';
  const q=getSourceSetting(activeModelForImport(),'qa').columns||{};
  const headers=getHeaders('qa')||[];
  const assignedH=findHeaderFromExpected(headers,q.assignedDate,['Assigned Date','Date Assigned','Assignment Date']);
  const interactionH=findHeaderFromExpected(headers,q.interactionDate,['Interaction Start Time','Interaction start Time','Interaction Start','Start Time']);
  // Resolve the selected worksheet column at report time. This avoids stale normalized
  // dates after a header mapping is changed or a packaged/cache dataset is reloaded.
  if(mode==='assigned') return (assignedH ? row[assignedH] : '') || row._assignedDate || '';
  return (interactionH ? row[interactionH] : '') || row._interactionDate || row._date || '';
}
function filterQARowsByDate(rows,start,end,mode){
  if(!start&&!end) return rows||[];
  return (rows||[]).filter(r=>inRange(qaDateFromRow(r,mode),start,end));
}
function filterChecklistRowsByDate(source, rows,start,end,dateCol){
  if(!start&&!end) return rows||[];
  const data=checklistLikeRowsState(source);
  const col=resolveColumn(source, dateCol || sourceDateHeader(source,data.headers));
  return (rows||[]).filter(r=>inRange((col?r[col]:'')||r._date,start,end));
}
function resolveColumn(source, expected){
  expected=plainHeaderName(expected);
  if(!expected) return '';
  const headers=getHeaders(source)||[];
  return findHeader(headers,[expected]) || expected;
}

function escapeRegExp(s){ return String(s||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }

function expressionNormalizeText(expr){ return String(expr??'').replace(/\r\n?/g,'\n').trim().replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/\s+/g,' '); }
function expressionHeadersKey(headers){ return (headers||[]).map(plainHeaderName).filter(Boolean).sort((a,b)=>a.localeCompare(b)).join('\u001f'); }
function expressionCacheKey(source,expr,headers){ return [source||'',expressionNormalizeText(expr),expressionHeadersKey(headers)].join('\u001e'); }
function expressionRunStats(){ return state.expressionStats || (state.expressionStats={evaluated:0,cacheHits:0,compiled:0,errors:[],missingHeaders:new Set(),rowCache:new WeakMap()}); }
function resetExpressionRunStats(){ state.expressionStats={evaluated:0,cacheHits:0,compiled:0,errors:[],missingHeaders:new Set(),rowCache:new WeakMap()}; return state.expressionStats; }
function expressionLogError(ctx,msg){ const st=expressionRunStats(); const text=String(msg||'Expression error'); if(st.errors.length<20) st.errors.push({source:ctx.source||'',context:ctx.context||'',row:ctx.rowLabel||ctx.row?._rep||ctx.row?._team||'',message:text}); }
function expressionRowKey(row,source,expr,context){ const st=expressionRunStats(); const target=(row&&typeof row==='object')?row:st; let m=st.rowCache.get(target); if(!m){ m=new Map(); st.rowCache.set(target,m); } return {m,k:[source||'',expressionNormalizeText(expr),context||''].join('\u001e')}; }
function expressionReferences(expr,source){ const refs=[]; expressionRefsForSource(expr,source).forEach(r=>refs.push(r)); String(expr||'').replace(/\brow\s*\[\s*["']([^"']+)["']\s*\]/gi,(m,col)=>{ refs.push({source,column:col,cross:false}); return m; }); return refs; }
function expressionDiagnostics(expr,source,mode='display'){
  const raw=String(expr||'').trim(), headers=getHeaders(source)||[], used=[], missing=[];
  if(!raw) return {used,missing,html:''};
  expressionReferences(raw,source).forEach(ref=>{ if(ref.missingSource){ const label=`Missing source: ${ref.sourceLabel}`; missing.push(label); expressionRunStats().missingHeaders.add(label); return; } const src=ref.source||source, actual=ref.field||resolveColumn(src,ref.column); const label=ref.cross?`${labelSource(src)||src}.${ref.column}`:ref.column; if(actual && (getHeaders(src)||[]).includes(actual)){ if(!used.includes(label)) used.push(label); } else { const miss=ref.cross?`Missing header in ${labelSource(src)||src}: ${ref.column}`:label; missing.push(miss); expressionRunStats().missingHeaders.add(miss); } });
  const note=used.length?`Uses: ${used.slice(0,8).join(', ')}${used.length>8?'…':''}`:'Uses: no column headers detected';
  const warn=missing.length?`Missing header${missing.length>1?'s':''}: ${missing.join(', ')}`:'';
  return {used,missing,html:`<div class="exprNote ${warn?'bad':''}">${esc(note)}${warn?`<br>${esc(warn)}`:''}</div>`};
}
function expressionDiagnosticHtml(expr,source,mode){ return expressionDiagnostics(expr,source,mode).html; }
function expressionSummaryPanel(title='Expression diagnostics'){
  const st=state.expressionStats; if(!st) return '';
  const miss=[...(st.missingHeaders||new Set())];
  const errs=(st.errors||[]).slice(0,20);
  if(!st.evaluated && !st.compiled && !errs.length && !miss.length) return '';
  return `<div class="exprDiagPanel"><strong>${esc(title)}</strong><div>Expressions evaluated: ${st.evaluated||0} · Served from cache: ${st.cacheHits||0} · Compiled this run: ${st.compiled||0} · Compile cache size: ${state.expressionCache?.size||0} · Expression errors: ${errs.length}</div>${miss.length?`<div class="exprDiagMissing">Missing headers: ${esc(miss.join(', '))}</div>`:''}${errs.length?`<div>${errs.map(e=>`<div class="exprDiagError">${esc([e.source,e.context,e.row].filter(Boolean).join(' / '))}: ${esc(e.message)}</div>`).join('')}</div>`:''}</div>`;
}
function compileCachedExpression(source,expr,headers,bodyBuilder,ctx={}){
  const raw=expressionNormalizeText(expr); if(!raw) return null;
  const key=expressionCacheKey(source,raw,headers||getHeaders(source)||[]);
  if(state.expressionCache.has(key)){ expressionRunStats().cacheHits++; return state.expressionCache.get(key); }
  try{ const compiled=bodyBuilder(raw); state.expressionCache.set(key,compiled); expressionRunStats().compiled++; return compiled; }
  catch(e){ expressionLogError({...ctx,source},e.message); const failed=()=>''; state.expressionCache.set(key,failed); return failed; }
}
function evaluateCompiledExpression(compiled,args,ctx={}){ const st=expressionRunStats(); st.evaluated++; try{ return compiled(...(args||[])); }catch(e){ expressionLogError(ctx,e.message); return ''; } }
function warnIfNumericText(v,warnings,ctx={}){ if(typeof v==='string' && v.trim()!=='' && !Number.isFinite(toNum(v))){ const msg='This expression returned text but this mode requires a number.'; researchExpressionAddWarning(warnings||[],msg); expressionLogError(ctx,msg); } }

function expressionColumnsForSource(expr, source){
  const headers=[...(getHeaders(source)||[]).map(plainHeaderName).filter(Boolean),...(state.metrics||[]).map(m=>m.name).filter(Boolean),...(state.models||[]).flatMap(m=>(m.criteria||[]).map(c=>`${m.name||m.id}.${c.name||c.id}`))];
  const found=[]; const seen=new Set();
  splitExpressionColumns(expr).forEach(col=>{ const hit=resolveColumn(source,col); if(hit&&!seen.has(hit)){seen.add(hit); found.push(hit);} });
  let probe=replaceResearchSourceFieldRefs(expr,()=> ' ').replace(/\[[^\]]+\]/g,' ');
  headers.slice().sort((a,b)=>b.length-a.length).forEach(h=>{
    const re=new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(h)}(?=$|[^A-Za-z0-9_])`,'gi');
    if(re.test(probe) && !seen.has(h)){ seen.add(h); found.push(h); }
  });
  return found;
}
function sumRowsColumn(source, col, rows){
  const actual=resolveColumn(source,col);
  let total=0, found=false;
  (rows||[]).forEach(r=>{ const n=toNum(r[actual]); if(Number.isFinite(n)){ total+=n; found=true; } });
  return found ? total : NaN;
}
function crossRowsForRow(source, row, opts={}){
  const key=row?._repKey||nameKey(row?._rep||'');
  if(!key) return [];
  const idx=sourceIndex(source);
  const raw=idx ? (idx.byRep.get(key)||[]) : getRowsRaw(source).filter(r=>r._repKey===key);
  return filterRowsForSource(source, raw, opts);
}
function evaluateRowExpression(expr, row, source, opts={}){
  expr=String(expr||'').trim(); if(!expr) return NaN;
  let out=replaceResearchSourceFieldRefs(expr,(m,ref)=>{ if(!ref || ref.missingSource || ref.missingField) return 'NaN'; const n=sumRowsColumn(ref.source,ref.field,crossRowsForRow(ref.source,row,opts)); return Number.isFinite(n)?String(n):'NaN'; });
  out=out.replace(/(^|[^!])\[([^\]]+)\](?!\s*\.\s*\[)/g,(m,prefix,col)=>{ const actual=resolveColumn(source,col); const n=toNum(row[actual]); return prefix+(Number.isFinite(n)?String(n):'NaN'); });
  const headers=(getHeaders(source)||[]).map(plainHeaderName).filter(Boolean).sort((a,b)=>b.length-a.length);
  headers.forEach(h=>{
    const actual=resolveColumn(source,h); const n=toNum(row[actual]);
    const re=new RegExp(`(^|[^A-Za-z0-9_!\]])${escapeRegExp(h)}(?=$|[^A-Za-z0-9_])`,'gi');
    out=out.replace(re,(m,prefix)=>prefix+(Number.isFinite(n)?String(n):'NaN'));
  });
  if(!/^[0-9+\-*/().\sNa]+$/.test(out)) return NaN;
  try{ const v=Function(`return (${out})`)(); return Number.isFinite(v)?v:NaN; }catch(e){ return NaN; }
}

function filterRowsForSamePerson(source, row, rowSource, opts={}){
  const key=row?._repKey||nameKey(row?._rep||'');
  if(!key) return [];
  const idx=sourceIndex(source);
  const raw=idx ? (idx.byRep.get(key)||[]) : getRowsRaw(source).filter(r=>r._repKey===key);
  const filterOpts = source===NONDATED_SOURCE ? {...opts,start:null,end:null} : opts;
  return filterRowsForSource(source, raw, filterOpts);
}
function evaluateAggregateExpressionForPerson(expr, row, source, rowSource, opts={}){
  expr=String(expr||'').trim(); if(!expr) return NaN;
  const rowsFor=(src)=>filterRowsForSamePerson(src,row,rowSource,opts);
  let out=replaceResearchSourceFieldRefs(expr,(m,ref)=>{ if(!ref || ref.missingSource || ref.missingField) return 'NaN'; const n=sumRowsColumn(ref.source,ref.field,rowsFor(ref.source)); return Number.isFinite(n)?String(n):'NaN'; });
  out=out.replace(/(^|[^!])\[([^\]]+)\](?!\s*\.\s*\[)/g,(m,prefix,col)=>{ const n=sumRowsColumn(source,col,rowsFor(source)); return prefix+(Number.isFinite(n)?String(n):'NaN'); });
  const headers=(getHeaders(source)||[]).map(plainHeaderName).filter(Boolean).sort((a,b)=>b.length-a.length);
  headers.forEach(h=>{ const n=sumRowsColumn(source,h,rowsFor(source)); const re=new RegExp(`(^|[^A-Za-z0-9_!\]])${escapeRegExp(h)}(?=$|[^A-Za-z0-9_])`,'gi'); out=out.replace(re,(m,prefix)=>prefix+(Number.isFinite(n)?String(n):'NaN')); });
  if(!/^[0-9+\-*/().\sNa]+$/.test(out)) return NaN;
  try{ const v=Function(`return (${out})`)(); return Number.isFinite(v)?v:NaN; }catch(e){ return NaN; }
}
function evaluateFilterNumericExpression(expr, row, source, rowSource, opts={}){
  if(source!==rowSource) return evaluateAggregateExpressionForPerson(expr,row,source,rowSource,opts);
  return evaluateRowExpression(expr,row,source,opts);
}
function filterColumnValueForRow(f, row, rowSource, opts={}){
  const source=f.source||rowSource;
  if(f.dynamicColumn) return evaluateFilterNumericExpression(f.columnExpression,row,source,rowSource,opts);
  const col=resolveColumn(source,f.column);
  if(source!==rowSource){
    const rows=filterRowsForSamePerson(source,row,rowSource,opts);
    const n=sumRowsColumn(source,col,rows);
    return Number.isFinite(n)?n:'';
  }
  return row[col];
}
function textFilterPass(value, f){
  const op=f.operator==='notContains'?'does not contain':f.operator;
  const phrases=filterPhrases({value:f.value,values:f.values,op});
  if(isMultiPhraseTextOperator(op) && phrases.length) return evaluateMultiPhraseTextCondition(value,op,phrases,true);
  if(f.operator==='contains') return compareFilter(value,'contains',f.value||'');
  if(f.operator==='notContains') return compareFilter(value,'does not contain',f.value||'');
  const val=String(value??'').trim();
  const set=new Set((f.values||[]).map(String));
  if(set.size){ const isHit=set.has(val); return f.operator==='isNot' ? !isHit : isHit; }
  return compareFilter(value,f.operator==='isNot'?'is not':'is',f.value||'');
}
function modelAnchorDate(row, source, opts={}){
  if(!row) return '';
  if(source==='qa') return opts.qaDateMode==='assigned' ? row._assignedDate : (row._interactionDate||row._date);
  if(isChecklistLikeSource(source)){
    const h=resolveColumn(source, opts.dateColumn || findHeader(getHeaders(source),checklistLikeDefaultDateHeaders(source)) || '');
    return h ? row[h] : row._date || '';
  }
  const h=findHeader(getHeaders(source),['Date','Interaction Start Time','Assigned Date','Created Date','Completed Date']);
  return h ? row[h] : row._date || '';
}
function dateAwareModelFilterMatch(row,rowSource,f,opts={}){
  const src=f.targetSource||'qa', idx=sourceIndex(src);
  const byRep=personKeyFromRow(row), byTeam=researchRowTeam(row)||rowTeam(row);
  const candidates=idx ? [...(idx.byRep.get(byRep)||[]),...(idx.byTeam.get(byTeam)||[])] : getRowsRaw(src);
  const seen=new Set();
  const anchor=modelAnchorDate(row,rowSource,opts);
  const targetDateCol=resolveColumn(src,f.targetDateColumn)||f.targetDateColumn;
  const targetValueCol=resolveColumn(src,f.targetValueColumn)||f.targetValueColumn;
  return candidates.some(tr=>{
    if(seen.has(tr)) return false; seen.add(tr);
    const personOk=byRep&&personKeyFromRow(tr)&&byRep===personKeyFromRow(tr);
    const teamOk=byTeam&&researchRowTeam(tr)&&byTeam===researchRowTeam(tr);
    if(!personOk&&!teamOk) return false;
    if(!dateWindowPass(anchor, tr[targetDateCol], f)) return false;
    return compareFilter(researchFieldValue(tr,targetValueCol,src), f.targetOp||'contains', f.targetValue||'');
  });
}
function applyFilters(rows, filters, rowSource, opts={}){
  let out=rows||[];
  (filters||[]).forEach(raw=>{
    const f=normalizeFilterForStorage(raw,rowSource);
    const action=f.action||f.mode||'exclude';
    if(action==='includeWithin'||action==='excludeWithin'){
      out=out.filter(r=>{
        const hit=dateAwareModelFilterMatch(r,rowSource,f,opts);
        return action==='includeWithin'?hit:!hit;
      });
      return;
    }
    if(!f.dynamicColumn && !f.column && !isFreeTextFilterOperator(f.operator)) return;
    if(f.dynamicColumn && !String(f.columnExpression||'').trim()) return;
    const numeric=isNumericFilterOperator(f.operator);
    if(numeric){
      const fixedTarget=toNum(f.value), fixedTarget2=toNum(f.value2);
      if(!f.dynamic && !Number.isFinite(fixedTarget)) return;
      if(f.operator==='between' && !Number.isFinite(fixedTarget2)) return;
      out=out.filter(r=>{
        const target=f.dynamic ? evaluateFilterNumericExpression(f.expression,r,f.source||rowSource,rowSource,opts) : fixedTarget;
        const target2=f.operator==='between' ? fixedTarget2 : undefined;
        const leftRaw=filterColumnValueForRow(f,r,rowSource,opts);
        const left=typeof leftRaw==='number'?leftRaw:toNum(leftRaw);
        const hit=numericComparisonPass(left,f.operator,target,target2);
        return action==='include'?hit:!hit;
      });
      return;
    }
    out=out.filter(r=>{
      const left=filterColumnValueForRow(f,r,rowSource,opts);
      const hit=textFilterPass(left,f);
      return action==='include'?hit:!hit;
    });
  });
  return out;
}
function sourceAreaForSource(source){
  if(/^referral/.test(String(source||''))) return 'referral';
  if(/^retail/.test(String(source||''))) return 'retail';
  return '';
}
function rowMatchesTrustedEntry(row,entry,source=''){
  if(!hasTrustedControlRoster() || !entry || entry.kind!=='rep') return true;
  const key=row?._repKey||repKeyFromAnyRow(row); if(!key || key!==entry.key) return false;
  const rt=trustedTeamForRepKey(key,sourceAreaForSource(source)||row?._sourceArea||'');
  return rt ? coachNameKey(rt)===coachNameKey(entry.team||'') : false;
}
function rowsForEntry(source, entry, opts={}){
  const cached=cachedRowsForEntry(source, entry, opts);
  if(cached) return cached;
  const idx=sourceIndex(source);
  let rows;
  if(idx && entry.kind==='team'){
    rows=(idx.byTeamKey?.get(coachNameKey(entry.name)) || idx.byTeam?.get(canonicalCoachName(entry.name)) || []).slice();
    if(!rows.length) rows=cachedRowsForSource(source, opts).filter(r=>coachNameKey(rowTeam(r)||state.repTeams.get(r._repKey)||'')===coachNameKey(entry.name));
    else rows=filterRowsForSource(source,rows,opts);
  }else if(idx && entry.kind!=='team' && entry.key){
    rows=(idx.byRep?.get(entry.key)||[]).filter(r=>rowMatchesTrustedEntry(r,entry,source));
    rows=filterRowsForSource(source,rows,opts);
  }else{
    rows=cachedRowsForSource(source, opts);
    if(entry.kind==='team') rows=rows.filter(r=>coachNameKey(rowTeam(r)||state.repTeams.get(r._repKey)||'')===coachNameKey(entry.name));
    else rows=rows.filter(r=>r._repKey===entry.key && rowMatchesTrustedEntry(r,entry,source));
  }
  return rows;
}
function withinModeKind(mode){
  if(['value_within','value_percent_within','valueWithin','valueWithinPercent'].includes(mode)) return 'value';
  return 'date';
}
function withinModeIsPercent(mode){ return ['percent_within','date_percent_within','value_percent_within','dateWithinPercent','valueWithinPercent'].includes(mode); }
function withinRangePass(diff, low, high){
  if(!Number.isFinite(diff)) return false;
  const abs=Math.abs(diff), lo=toNum(low), hi=toNum(high);
  if(Number.isFinite(lo) && Number.isFinite(hi)) return abs>=Math.min(Math.abs(lo),Math.abs(hi)) && abs<=Math.max(Math.abs(lo),Math.abs(hi));
  if(Number.isFinite(hi)) return abs<=Math.abs(hi);
  if(Number.isFinite(lo)) return abs<=Math.abs(lo);
  return false;
}
function withinBoundsForConfig(cfg={}){
  return cfg.withinUseRange ? {low:cfg.withinRangeMin,high:cfg.withinRangeMax} : {low:cfg.withinDays,high:cfg.withinDays};
}
function withinStatsForRows(rows, source, leftField, rightField, kind='date', low='', high='', warnings=[]){
  const left=resolveColumn(source,leftField)||leftField, right=resolveColumn(source,rightField)||rightField;
  let compared=0, within=0, skipped=0;
  (rows||[]).forEach(r=>{
    let diff=NaN;
    if(kind==='value'){
      const a=toNum(researchFieldValue(r,left,source)), b=toNum(researchFieldValue(r,right,source));
      if(Number.isFinite(a) && Number.isFinite(b)) diff=b-a;
    }else{
      diff=calendarDiffDays(researchFieldValue(r,left,source), researchFieldValue(r,right,source));
    }
    if(!Number.isFinite(diff)){ skipped++; return; }
    compared++;
    if(withinRangePass(diff,low,high)) within++;
  });
  if(skipped && warnings && !warnings.includes('Some rows were skipped because within mode requires both compared fields.')) warnings.push('Some rows were skipped because within mode requires both compared fields.');
  return {within,compared,skipped,percent:compared?within/compared*100:0};
}
function criterionRowsForEntry(c,entry,opts={}){
  const extra=isCustomWeeklyStatSource(c.source)?(customSource(c.source)?.columns||{}):{};
  const ctx={...opts,dateBasis:extra.dateBasis,weekStart:extra.weekStart};
  const entryKey=entry?.kind==='team'?'team:'+coachNameKey(entry.name):'rep:'+(entry?.key||'');
  const key=stableSerialize({run:opts.runId||opts._runId||'',source:c.source,version:state.dataIndex?.version||0,entryKey,start:ymd(ctx.start),end:ymd(ctx.end),dateColumn:ctx.dateColumn||'',qaDateMode:ctx.qaDateMode||'',filters:(c.filters||[]).map(f=>normalizeFilterForStorage(f,c.source)),mapping:state.versions?.mappings||0,aliases:state.versions?.aliases||0});
  state.criterionInputCache=state.criterionInputCache||new Map();
  if(state.criterionInputCache.has(key)){ state.perfCounters.criterionInputCacheHits++; const v=state.criterionInputCache.get(key); state.criterionInputCache.delete(key); state.criterionInputCache.set(key,v); return v; }
  let rows=rowsForEntry(c.source, entry, ctx);
  if((c.filters||[]).length){ const predicate=getCompiledFilterPredicate(c.source,c.filters,ctx); rows=rows.filter(predicate); }
  return boundedMapSet(state.criterionInputCache,key,rows,500);
}
function valueSingle(c, entry, opts){
  const extra=isCustomWeeklyStatSource(c.source)?(customSource(c.source)?.columns||{}):{};
  let rows=criterionRowsForEntry(c,entry,opts);
  const col=resolveColumn(c.source,c.column), mode=c.aggregate||'sum';
  if(['dateWithin','dateWithinPercent','valueWithin','valueWithinPercent'].includes(mode)){
    const {low,high}=withinBoundsForConfig(c);
    const stats=withinStatsForRows(rows,c.source,col,c.withinCompareColumn,withinModeKind(mode),low,high,[]);
    return withinModeIsPercent(mode) ? stats.percent : stats.within;
  }
  if(mode==='count') return rows.filter(r=>!col || String(r[col]??'').trim()!=='').length;
  if(mode==='uniqueReps') return new Set(rows.map(r=>r._repKey).filter(Boolean)).size;
  if(mode==='uniqueWeeks') return new Set(rows.map(r=>weeklyRowWeekKey(c.source,r,{weekStart:extra.weekStart})).filter(Boolean)).size;
  if(['percent','weightedPercent','avgWeeklyPercent'].includes(mode)){
    const ncol=resolveColumn(c.source,extra.numerator||''), dcol=resolveColumn(c.source,extra.denominator||'');
    if(ncol&&dcol){
      if(mode==='avgWeeklyPercent'){
        const vals=[]; rows.forEach(r=>{ const den=toNum(r[dcol]); if(den){ const num=toNum(r[ncol]); vals.push((Number.isFinite(num)?num:0)/den*(c.format==='pct'?100:1)); } });
        return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:NaN;
      }
      const num=rows.reduce((s,r)=>s+(Number.isFinite(toNum(r[ncol]))?toNum(r[ncol]):0),0), den=rows.reduce((s,r)=>s+(Number.isFinite(toNum(r[dcol]))?toNum(r[dcol]):0),0);
      return den?num/den*(c.format==='pct'?100:1):NaN;
    }
  }
  if(isCustomWeeklyStatSource(c.source) && c.format==='pct' && extra.numerator && extra.denominator){ c={...c,aggregate:'weightedPercent'}; return valueSingle(c,entry,opts); }
  let pairs=rows.map((r,i)=>({r,i,n:toNum(r[col]),t:rowDateMillisForSource(c.source,r)})).filter(x=>Number.isFinite(x.n));
  if(!pairs.length) return NaN;
  if(mode==='latest'){ let best=pairs[0]; for(const p of pairs){ if(((p.t||0)>(best.t||0)) || ((p.t||0)===(best.t||0) && p.i>best.i)) best=p; } return best.n; }
  if(mode==='first'){ let best=pairs[0]; for(const p of pairs){ if(((p.t||0)<(best.t||0)) || ((p.t||0)===(best.t||0) && p.i<best.i)) best=p; } return best.n; }
  if(mode==='avg') return pairs.reduce((a,b)=>a+b.n,0)/pairs.length;
  if(mode==='max') return Math.max(...pairs.map(x=>x.n));
  if(mode==='min') return Math.min(...pairs.map(x=>x.n));
  return pairs.reduce((a,b)=>a+b.n,0);
}
function sumColumn(source, col, entry, opts, filters){
  let rows=rowsForEntry(source, entry, opts); if((filters||[]).length){ const predicate=getCompiledFilterPredicate(source,filters,opts); rows=rows.filter(predicate); }
  const actualCol=resolveColumn(source,col);
  return rows.reduce((s,r)=>{const n=toNum(r[actualCol]); return s+(Number.isFinite(n)?n:0);},0);
}
function valueMulti(c, entry, opts){
  const l=sumColumn(c.leftSource,c.leftColumn,entry,opts,c.filters);
  const r=sumColumn(c.rightSource,c.rightColumn,entry,opts,c.filters);
  if(c.operator==='divide') return r?l/r*(c.format==='pct'?100:1):NaN;
  if(c.operator==='multiply') return l*r;
  if(c.operator==='plus') return l+r;
  if(c.operator==='minus') return l-r;
  if(c.operator==='greaterThan') return l>r?1:0;
  if(c.operator==='lessThan') return l<r?1:0;
  return NaN;
}
function valueCustom(c, entry, opts){
  const src=c.customSource||c.source; const expr=String(c.expression||''); if(!expr.trim()) return NaN;
  const ctx={source:src,context:`Model criteria: ${c.name||'Custom expression'}`,rowLabel:entry?.name||entry?.team||''};
  const rowObj=entry; const rk=expressionRowKey(rowObj,src,expr,ctx.context); if(rk.m.has(rk.k)){ expressionRunStats().cacheHits++; return rk.m.get(rk.k); }
  let replaced=replaceResearchSourceFieldRefs(expr,(m,ref)=>ref && !ref.missingSource && !ref.missingField ? String(sumColumn(ref.source,ref.field,entry,opts,[])) : 'NaN');
  replaced=replaced.replace(/(^|[^!])\[([^\]]+)\](?!\s*\.\s*\[)/g,(m,prefix,col)=>prefix+String(sumColumn(src,col,entry,opts,c.filters)));
  if(!/^[0-9+\-*/().\sNa]+$/.test(replaced)){ expressionLogError(ctx,'Expression could not be calculated. Check headers and operators.'); rk.m.set(rk.k,NaN); return NaN; }
  const fn=compileCachedExpression(src,replaced,getHeaders(src),raw=>Function(`return (${raw})`),ctx);
  const v=evaluateCompiledExpression(fn,[],ctx); const out=Number.isFinite(v)?v*(c.format==='pct'?100:1):NaN; rk.m.set(rk.k,out); return out;
}
function isQADirectRawSource(source){ return source==='qa' || source===QA_DIRECT_SOURCE; }
function activeDirectQASource(){
  // Direct QA team-score mode must never read the categorized dated database.
  // If the override upload has rows, use it. Otherwise use the raw QA Stats upload.
  return (state.data.qa_direct?.rows||[]).length ? QA_DIRECT_SOURCE : 'qa';
}
function activeDirectQASourceLabel(){
  const src=activeDirectQASource();
  const d=src===QA_DIRECT_SOURCE ? state.data.qa_direct : state.data.qa;
  return `${labelSource(src)}${d?.fileName?' — '+d.fileName:''}${d?.sheetName?' · '+d.sheetName:''}`;
}
function qaLiteralTeamColumn(source){
  const headers=getHeaders(source)||[];
  // Sheet-team QA mode must use the worksheet's actual Team header first. This
  // prevents accidental matching against Evaluator, roster assignments, or the
  // normalized _team value created during import.
  return findHeader(headers,['Team']) || resolveColumn(source,'Team') || '';
}
function qaLiteralAssignedDateColumn(source){
  const headers=getHeaders(source)||[];
  if(isQADirectRawSource(source)){
    const q=getSourceSetting(activeModelForImport(),'qa').columns||{};
    return findHeaderFromExpected(headers,q.assignedDate||'Assigned Date',['Assigned Date','Date Assigned','Assignment Date']) || findHeader(headers,['Assigned Date']) || '';
  }
  const cfg=isCustomSource(source)?(customSource(source)?.columns||{}):{};
  return findHeaderFromExpected(headers,cfg.assignedDate||cfg.date||'Assigned Date',['Assigned Date','Date Assigned','Assignment Date','Date']) || '';
}
function qaScoreColumnForCriterion(source,c={}){
  const cols=isCustomSource(source)?(customSource(source)?.columns||{}):(isQADirectRawSource(source)?(getSourceSetting(activeModelForImport(),'qa').columns||{}):(getSourceSetting(activeModelForImport(),source).columns||{}));
  return resolveColumn(source,c.qaColumns?.score||cols.score||'Score %') || '';
}
function qaTeamColumnForCriterion(source,c={}){
  if(isQADirectRawSource(source)) return qaLiteralTeamColumn(source);
  const cols=isCustomSource(source)?(customSource(source)?.columns||{}):getSourceSetting(activeModelForImport(),source).columns||{};
  return resolveColumn(source,c.qaColumns?.team||cols.team||cols.coach||'Team') || '';
}
function qaAssignedDateValueForRow(source,row,c={}){
  if(!row) return '';
  const assignedCol=qaLiteralAssignedDateColumn(source);
  if(assignedCol) return row[assignedCol] || row._assignedDate || row._date || '';
  return row._assignedDate || row['Assigned Date'] || row._date || '';
}
function qaSheetTeamForRow(source,row,c={}){
  if(!row) return '';
  const teamCol=qaTeamColumnForCriterion(source,c);
  return canonicalCoachName(teamCol ? row[teamCol] : (row._qaTeam||row._team||''));
}
function qaCoachMatchKeys(value){
  const clean=canonicalCoachName(value||'');
  const keys=new Set([coachNameKey(clean),normalizeIdentityName(clean)].filter(Boolean));
  const parts=clean.split(/\s+/).filter(Boolean);
  if(parts.length) keys.add(normalizeIdentityName(parts[parts.length-1]));
  return [...keys];
}
function directQATeamScoreMode(c,entry,opts){
  return !!(entry && entry.kind==='team' && (opts?.qaTeamScoreMode||'assignedReps')==='sheetTeam' && (c?.calcType==='qaScore' || c?.source==='qa' || isCustomQAStyleSource(c?.source)));
}
function qaDirectAssignedTeamRowsIndex(source,c,qaOpts){
  // Special QA team search requested for 90-day evals:
  //   1) ignore roster/representative membership completely,
  //   2) filter rows only by the worksheet Assigned Date column,
  //   3) group rows only by the worksheet Team column,
  //   4) average only numeric values from the configured Score column.
  const cache=qaOpts?._qaSheetTeamRowsCache;
  const teamColumn=qaTeamColumnForCriterion(source,c);
  const assignedColumn=qaLiteralAssignedDateColumn(source);
  const scoreColumn=qaScoreColumnForCriterion(source,c);
  const cacheKey=[source,ymd(qaOpts?.start),ymd(qaOpts?.end),teamColumn,assignedColumn,scoreColumn,'assigned-date-team-score-v1'].join('|qaDirectTeam|');
  if(cache && cache.has(cacheKey)) return cache.get(cacheKey);
  const rawRows=(getRowsRaw(source)||[]);
  const byTeam=new Map();
  for(const row of rawRows){
    if((qaOpts?.start||qaOpts?.end) && !inRange(qaAssignedDateValueForRow(source,row,c),qaOpts.start,qaOpts.end)) continue;
    const score=scoreColumn ? normalizeScore(scoreColumn==='_score'?row._score:row[scoreColumn]) : (Number.isFinite(row._score)?row._score:NaN);
    if(!Number.isFinite(score)) continue;
    const rawTeam=teamColumn ? row[teamColumn] : (row._qaTeam||row._team||'');
    const keys=qaCoachMatchKeys(rawTeam);
    if(!keys.length) continue;
    for(const key of keys){
      let bucket=byTeam.get(key);
      if(!bucket){ bucket=[]; byTeam.set(key,bucket); }
      bucket.push(row);
    }
  }
  if(cache) cache.set(cacheKey,byTeam);
  return byTeam;
}
function qaSheetTeamRowsIndex(source,c,qaOpts){
  return qaDirectAssignedTeamRowsIndex(source,c,qaOpts);
}
function qaRowsForEntry(c, entry, opts){
  const requestedSource=c.source||'qa';
  const qaCols=c.qaColumns||{};
  const directTeamMode=directQATeamScoreMode(c,entry,opts);
  const source=directTeamMode ? activeDirectQASource() : requestedSource;
  const qaOpts=directTeamMode
    ? {...opts,qaDateMode:'assigned',dateColumn:qaLiteralAssignedDateColumn(source)}
    : (qaCols.date ? {...opts,dateColumn:qaCols.date} : opts);
  let rows;
  if(directTeamMode){
    const idx=qaDirectAssignedTeamRowsIndex(source,c,qaOpts);
    const matched=new Set();
    qaCoachMatchKeys(entry.name).forEach(k=>(idx.get(k)||[]).forEach(r=>matched.add(r)));
    rows=[...matched];
  }else{
    rows=rowsForEntry(source, entry, qaOpts);
  }
  return applyFilters(rows,c.filters,source,qaOpts);
}
function valueQA(c, entry, opts){
  const directTeamMode=directQATeamScoreMode(c,entry,opts);
  const source=directTeamMode ? activeDirectQASource() : (c.source||'qa');
  let rows=qaRowsForEntry(c,entry,opts);
  const scoreCol=qaScoreColumnForCriterion(source,c);
  const nums=rows.map(r=>scoreCol?normalizeScore(scoreCol==='_score'?r._score:r[scoreCol]):(Number.isFinite(r._score)?r._score:NaN)).filter(Number.isFinite);
  const minMonitors=Math.max(0,Math.floor(Number(c.minimumMonitors)||0));
  if(minMonitors && nums.length<minMonitors) return NaN;
  if(!nums.length) return NaN;
  return nums.reduce((a,b)=>a+b,0)/nums.length;
}
function valueChecklist(c, entry, opts){
  const source=rowPullSourceForCriterion(c);
  const rowPullOpts={...opts,dateColumn:c.checkDateColumn,checkValueType:c.checkValueType||'text'};
  let rows=rowsForEntry(source, entry, rowPullOpts); rows=applyFilters(rows,c.filters,source,rowPullOpts);
  const conditions=ensureRowPullConditions(c).map(cond=>({...cond,column:resolveColumn(source,cond.column),dateColumn:resolveColumn(source,cond.dateColumn||c.checkDateColumn)})).filter(cond=>cond.column && String(cond.phrasesText||'').trim());
  if(conditions.length) rows=rows.filter(r=>checklistRowPassesConditions(source,r,entry,rowPullOpts,conditions));
  return rows.length;
}

function rawDisplayCellValue(v){
  if(v===null||v===undefined) return null;
  if(v instanceof Date) return isNaN(v)?null:ymd(v);
  if(typeof v==='string') return v.trim()===''?null:v;
  if(typeof v==='number'||typeof v==='boolean') return v;
  const text=String(v??'').trim(); return text===''?null:text;
}
function lookupIdentityKeys(value){
  const raw=String(value??'').trim(); if(!raw) return [];
  return [...new Set([normalizeIdentityName(raw),fullNameIdentityKey(raw),coachNameKey(raw),normalizeResearchText(raw)].filter(Boolean))];
}
function lookupTargetValue(c,entry){
  if(c.lookupMatchEntity==='custom') return c.lookupCustomValue||'';
  if(c.lookupMatchEntity==='representative') return entry.kind==='rep'?(entry.name||entry.key||''):(entry.representative||'');
  if(c.lookupMatchEntity==='coach') return entry.kind==='team'?(entry.name||entry.team||entry.key||''):(entry.team||state.repTeams.get(entry.key)||'');
  return entry.team||entry.name||entry.key||'';
}
function lookupDisplayIndex(c,source,matchCol,opts){
  opts._lookupDisplayCache=opts._lookupDisplayCache||new Map();
  const version=state.sourceMeta?.[source]?.sourceVersion||state.versions?.data||0, key=[c.id||c.name,source,matchCol,version].join('\u001f');
  if(opts._lookupDisplayCache.has(key)) return opts._lookupDisplayCache.get(key);
  const byKey=new Map(), rows=getRowsRaw(source)||[];
  rows.forEach((row,i)=>lookupIdentityKeys(row?.[matchCol]).forEach(k=>{ if(!byKey.has(k)) byKey.set(k,[]); byKey.get(k).push({row,i}); }));
  const out={rows,byKey}; opts._lookupDisplayCache.set(key,out); return out;
}
function lookupRowsForDisplay(c,entry,source,matchCol,opts){
  const target=lookupTargetValue(c,entry), targetKeys=lookupIdentityKeys(target); if(!targetKeys.length) return [];
  const idx=lookupDisplayIndex(c,source,matchCol,opts), found=new Map();
  targetKeys.forEach(k=>(idx.byKey.get(k)||[]).forEach(x=>found.set(x.i,x)));
  if(!found.size){
    const targetText=normalizeResearchText(target);
    if(targetText.length>=4) idx.byKey.forEach((list,key)=>{ if(key.length>=4&&(key.includes(targetText)||targetText.includes(key))) list.forEach(x=>found.set(x.i,x)); });
  }
  return [...found.values()].sort((a,b)=>a.i-b.i).map(x=>x.row);
}
function lookupRecordDate(c,source,row,index){
  if(c.lookupDateColumn){ const actual=resolveColumn(source,c.lookupDateColumn)||c.lookupDateColumn, d=parseDateOnly(row?.[actual])||parseWeekLabel(row?.[actual]); if(d) return d.getTime(); }
  const detected=rowDateMillisForSource(source,row); return Number.isFinite(detected)?detected:index;
}
function compareLookupValues(a,b){
  const an=toNum(a.value), bn=toNum(b.value); if(Number.isFinite(an)&&Number.isFinite(bn)) return an-bn;
  const ad=parseDateOnly(a.value), bd=parseDateOnly(b.value); if(ad&&bd) return ad-bd;
  return String(a.value).localeCompare(String(b.value),undefined,{numeric:true,sensitivity:'base'});
}
function selectLookupDisplayValue(c,source,rows,col){
  const candidates=(rows||[]).map((row,i)=>({row,i,value:rawDisplayCellValue(row?.[col]),date:lookupRecordDate(c,source,row,i)})).filter(x=>x.value!==null);
  if(c.displayCalculation==='count') return (rows||[]).length;
  if(!candidates.length) return null;
  if(c.lookupSelection==='first') return candidates[0].value;
  if(c.lookupSelection==='last') return candidates[candidates.length-1].value;
  if(c.lookupSelection==='latest') return candidates.slice().sort((a,b)=>b.date-a.date||b.i-a.i)[0].value;
  if(c.lookupSelection==='earliest') return candidates.slice().sort((a,b)=>a.date-b.date||a.i-b.i)[0].value;
  if(c.lookupSelection==='mostCommon'){
    const counts=new Map(); candidates.forEach((x,i)=>{ const k=normalizeResearchText(x.value), prior=counts.get(k)||{count:0,first:i,value:x.value}; prior.count++; counts.set(k,prior); });
    return [...counts.values()].sort((a,b)=>b.count-a.count||a.first-b.first)[0].value;
  }
  if(c.lookupSelection==='highest') return candidates.slice().sort(compareLookupValues).at(-1).value;
  if(c.lookupSelection==='lowest') return candidates.slice().sort(compareLookupValues)[0].value;
  if(c.lookupSelection==='joinUnique'){ const seen=new Set(), values=[]; candidates.forEach(x=>{ const k=normalizeResearchText(x.value); if(!seen.has(k)){seen.add(k);values.push(x.value);} }); return values.join(', '); }
  return candidates[0].value;
}
function calculateDisplayValue(c,value){
  if(value===null || value===undefined || c.displayCalculation==='raw' || c.displayCalculation==='count') return value;
  const date=parseDateOnly(value)||parseWeekLabel(value); if(!date) return null;
  const days=Math.max(0,(Date.now()-date.getTime())/86400000);
  if(c.displayCalculation==='daysSince') return Math.floor(days);
  if(c.displayCalculation==='monthsSince') return Math.floor(days/30.4375);
  if(c.displayCalculation==='yearsSince') return Math.round(days/365.25*10)/10;
  return value;
}
function displayColumnValue(c, entry, opts={}){
  const source=c.source||'retail_sv2', col=resolveColumn(source,c.column)||c.column;
  const modern=Number(c.lookupVersion)>=2 || c.lookupMatchColumn || c.lookupReturnColumn || c.audience==='coach';
  const returnCol=resolveColumn(source,c.lookupReturnColumn||c.column)||c.lookupReturnColumn||c.column;
  if(modern){
    const matchCol=resolveColumn(source,c.lookupMatchColumn)||c.lookupMatchColumn;
    if(!matchCol || (c.displayCalculation!=='count'&&!returnCol)) return null;
    opts._lookupDisplayCache=opts._lookupDisplayCache||new Map();
    const displayOpts={...opts,start:null,end:null,dateColumn:''};
    let rows=lookupRowsForDisplay(c,entry,source,matchCol,displayOpts);
    if((c.filters||[]).length) rows=applyFilters(rows,c.filters,source,displayOpts);
    return calculateDisplayValue(c,selectLookupDisplayValue(c,source,rows,returnCol));
  }
  if(!col) return null;
  if(entry.kind==='team'){
    if(!TEAM_TOTAL_SOURCE_KEYS.includes(source)) return null;
    const ds=teamTotalsDataset(source), row=teamTotalsRowForTeam(ds,entry.team||entry.name||entry.key||'');
    return row ? rawDisplayCellValue(row[col]) : null;
  }
  if(TEAM_TOTAL_SOURCE_KEYS.includes(source)) return null;
  const displayOpts={...opts,start:null,end:null,dateColumn:''};
  let rows=rowsForEntry(source,entry,displayOpts);
  if((c.filters||[]).length) rows=applyFilters(rows,c.filters,source,displayOpts);
  const candidates=rows.map((row,i)=>({row,i,value:rawDisplayCellValue(row[col]),date:rowDateMillisForSource(source,row)})).filter(x=>x.value!==null);
  if(!candidates.length) return null;
  candidates.sort((a,b)=>((Number.isFinite(b.date)?b.date:-Infinity)-(Number.isFinite(a.date)?a.date:-Infinity))||b.i-a.i);
  return candidates[0].value;
}

function trueTeamCriterionValue(c, entry, opts={}){
  state.perfCounters.trueTeamValueLookups=(state.perfCounters.trueTeamValueLookups||0)+1;
  const ds=teamTotalsDataset(c.trueValueSource);
  const team=canonicalCoachName(entry.team||entry.name||entry.key||''), match=teamTotalsRowMatch(ds,team), row=match.row;
  opts.trueValueDiagnostics=opts.trueValueDiagnostics||[];
  if(!row){ opts.trueValueDiagnostics.push({criterion:c.name||'',team,source:c.trueValueSource,reason:'Missing Team Totals row'}); return NaN; }
  const col=resolveColumn(c.trueValueSource,c.trueValueColumn)||c.trueValueColumn;
  if(!col || !(col in row)){ opts.trueValueDiagnostics.push({criterion:c.name||'',team,source:c.trueValueSource,column:c.trueValueColumn,reason:'Missing True Value column'}); return NaN; }
  const raw=row[col];
  if(String(raw??'').trim()===''){ opts.trueValueDiagnostics.push({criterion:c.name||'',team,source:c.trueValueSource,column:col,reason:'Blank True Value'}); return NaN; }
  const value=c.format==='pct' ? normalizeScore(raw) : toNum(raw);
  opts.trueValueDiagnostics.push({criterion:c.name||'',team,source:c.trueValueSource,column:col,controlTab:row._controlTab,summaryLookupKey:row._summaryLookupKey,originalSummaryName:row._summaryDisplayName,summarySheet:row._summarySheet,summaryRow:row._summaryRowNumber,rawValue:raw,parsedValue:value,matchMode:match.matchMode,note:`Matched through ${match.matchMode}; no representative aggregation was performed.`});
  return value;
}

function criterionValue(c, entry, opts){
  if(c.calcType==='displayColumn') return displayColumnValue(c,entry,opts);
  if(entry.kind === 'team' && c.trueValueEnabled && TEAM_TOTAL_SOURCE_KEYS.includes(c.trueValueSource)) return trueTeamCriterionValue(c, entry, opts);
  if(c.calcType==='qaScore' || c.source==='qa' || isCustomQAStyleSource(c.source)) return valueQA(c,entry,opts);
  if(isRowPullCriterion(c)) return valueChecklist(c,entry,opts);
  if(c.calcType==='multi') return valueMulti(c,entry,opts);
  if(c.calcType==='custom') return valueCustom(c,entry,opts);
  return valueSingle(c,entry,opts);
}
function allRepEntries(model, teams){
  const selected=(teams||[]).map(canonicalCoachName).filter(Boolean), teamSet=new Set(selected.map(coachNameKey));
  if(hasTrustedControlRoster()){
    const out=[];
    selected.forEach(team=>{ repsForTeam(team).forEach(r=>out.push({...r,kind:'rep',key:r.key,rosterId:r.rosterId,team:canonicalCoachName(r.team||team),name:r.name||r.displayName})); });
    return out.sort((a,b)=>(a.team||'').localeCompare(b.team||'')||a.name.localeCompare(b.name));
  }
  if(dataIndexReady()) return (state.dataIndex.reps||[]).filter(r=>!teamSet.size || teamSet.has(coachNameKey(r.team||''))).sort((a,b)=>(a.team||'').localeCompare(b.team||'')||a.name.localeCompare(b.name));
  const compact=currentTeamIndex();
  if(compact?.reps?.length) return (compact.reps||[]).filter(r=>!teamSet.size || teamSet.has(coachNameKey(r.team||''))).sort((a,b)=>(a.team||'').localeCompare(b.team||'')||a.name.localeCompare(b.name));
  const reps=new Map();
  const add=(key,name,team)=>{ if(!key||!name) return; const t=canonicalCoachName(team||state.repTeams.get(key)||''); if(teamSet.size && !teamSet.has(coachNameKey(t))) return; reps.set(key,mergeRepDisplay(reps.get(key),{kind:'rep',key,name:cleanName(name),team:t})); };
  controlRosterRows().forEach(r=>add(r._repKey,r._rep,rowTeam(r)));
  allSourceKeys().flatMap(getRowsRaw).forEach(r=>add(r._repKey,r._rep,r._team));
  return Array.from(reps.values()).sort((a,b)=>(a.team||'').localeCompare(b.team||'')||a.name.localeCompare(b.name));
}
function teamEntries(teams){ return teams.map(t=>({kind:'team',name:t,key:t,team:t})); }
function applyHideNoScoreRepOption(repPack){
  if(hasTrustedControlRoster()) return repPack;
  if(!els.hideNoScoreReps || !els.hideNoScoreReps.checked || !repPack) return repPack;
  const criteria=repPack.criteria||[];
  if(!criteria.length) return repPack;
  const thresholdValue=els.hideNoScoreThreshold ? els.hideNoScoreThreshold.value : 'all';
  const threshold=thresholdValue==='all' ? criteria.length : Math.max(1,Number(thresholdValue)||1);
  const rows=(repPack.rows||[]).filter(r=>{
    const missingCount=criteria.reduce((n,c)=>n+(criterionHasUsableValue(c,r.values?.[c.id])?0:1),0);
    return missingCount < threshold;
  });
  assignOverallRanks(rows,'rep');
  assignVisibleRepMedalRanks(rows);
  return {...repPack,rows};
}
function criterionUsesQA(c){ return c && c.calcType!=='displayColumn' && (c.source==='qa' || c.calcType==='qaScore' || c.leftSource==='qa' || c.rightSource==='qa' || c.customSource==='qa'); }
function modelUsesQA(model){ return !!(model && (model.criteria||[]).some(criterionUsesQA)); }
