(function(root){
'use strict';
const C=root.VerificationAllStarCore,D=root.VerificationAllStarData;
const $=id=>document.getElementById(id);
const state={monthly:null,lane3:null,report:null,uploads:[],charts:[],revision:0,busy:false};
const SETTINGS_KEY='verificationAllStar.scoringOptions.v2', LEGACY_SETTINGS_KEY='verificationAllStar.scoringOptions.v1';
let policyDrafts={},editorLane='1';
const measureNames=Object.fromEntries(C.MEASURES.map(measure=>[measure.id,measure.label]));
const pct=n=>Number.isFinite(n)?(n*100).toFixed(1)+'%':'—';
const number=n=>Number.isFinite(n)?n.toLocaleString('en-US',{maximumFractionDigits:2}):'—';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function readEditorPolicy(){return {requiredMeasures:C.MEASURES.filter(measure=>$('require-'+measure.id).checked).map(measure=>measure.id),rankedMeasures:C.MEASURES.filter(measure=>$('measure-'+measure.id).checked).map(measure=>measure.id),requireAllWiperWeeks:$('require-all-wiper-weeks').checked,correctivePenalty:$('corrective-penalty').value,missingRankedPolicy:'last'};}
function safePolicy(policy){
  const raw=String(policy.correctivePenalty??500),valid=raw.trim()&&Number.isFinite(Number(raw))&&Number(raw)>=0;
  if(policy.rankedMeasures.includes('correctives')&&!valid)throw Error('Enter a nonnegative number of points per corrective.');
  return {...policy,correctivePenalty:valid?Number(raw):500,requireAllWiperWeeks:policy.requiredMeasures.includes('wipers')&&policy.requireAllWiperWeeks};
}
function validatePolicy(policy,lane){try{return C.normalizeLaneSettings(safePolicy(policy));}catch(error){throw Error('Lane '+lane+': '+error.message);}}
function currentSettings(){const lanes={...policyDrafts,[editorLane]:readEditorPolicy()};return C.normalizeSettings({lanes:Object.fromEntries(Object.entries(lanes).map(([lane,policy])=>[lane,validatePolicy(policy,lane)]))});}
function names(ids){return ids.length?ids.map(id=>measureNames[id]).join(', '):'None';}
function formula(policy){return policy.rankedMeasures.map(measure=>measureNames[measure]+' rank').join(' + ')+(policy.rankedMeasures.includes('correctives')&&policy.correctivePenalty?' + '+number(policy.correctivePenalty)+' × known corrective count':'')+' + missing-data adjustment';}
function coverageLabel(policy){return policy.requiredMeasures.includes('wipers')&&policy.requireAllWiperWeeks?'Every available Wiper week is required.':'Available dated Wiper counts; week gaps do not exclude.';}
function loadEditor(){
  const policy=policyDrafts[editorLane];
  C.MEASURES.forEach(measure=>{$('require-'+measure.id).checked=policy.requiredMeasures.includes(measure.id);$('measure-'+measure.id).checked=policy.rankedMeasures.includes(measure.id);});
  $('require-all-wiper-weeks').checked=policy.requireAllWiperWeeks;$('corrective-penalty').value=String(policy.correctivePenalty);syncSettings();
}
function syncSettings(){
  $('corrective-penalty').disabled=!$('measure-correctives').checked;$('require-all-wiper-weeks').disabled=!$('require-wipers').checked;
  try{
    const settings=currentSettings(),policy=settings.lanes[editorLane],same=ids=>[policy.requiredMeasures,policy.rankedMeasures].every(list=>list.length===ids.length&&ids.every(id=>list.includes(id)));
    $('settings-error').hidden=true;$('settings-preview').textContent='Lane '+editorLane+' · Required: '+names(policy.requiredMeasures)+'. Total points = '+formula(policy)+'. Missing optional ranked values receive joint last place.';
    $('preset-performance').setAttribute('aria-pressed',String(same(['wipers','vaph','quality'])));$('preset-all').setAttribute('aria-pressed',String(same(C.MEASURES.map(measure=>measure.id))));return settings;
  }catch(error){$('settings-error').textContent=error.message;$('settings-error').hidden=false;$('settings-preview').textContent='';return null;}
}
function savePreferences(settings){try{root.localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));}catch(error){}}
function settingsChanged(){policyDrafts[editorLane]=readEditorPolicy();const settings=syncSettings();if(settings)savePreferences(settings);invalidate('Lane '+editorLane+' rules changed. Run the report to refresh rankings and exclusion reasons.');}
function preset(ids){policyDrafts[editorLane]=C.normalizeLaneSettings({requiredMeasures:ids,rankedMeasures:ids});loadEditor();settingsChanged();}
function restoreSettings(){
  let settings;try{const saved=root.localStorage.getItem(SETTINGS_KEY),legacy=saved==null?root.localStorage.getItem(LEGACY_SETTINGS_KEY):null;settings=C.normalizeSettings(JSON.parse(saved||legacy||'null'));if(saved==null&&legacy)savePreferences(settings);}catch(error){settings=C.normalizeSettings();}
  policyDrafts=Object.fromEntries(Object.entries(settings.lanes).map(([lane,policy])=>[lane,{...policy,requiredMeasures:[...policy.requiredMeasures],rankedMeasures:[...policy.rankedMeasures]}]));loadEditor();
}
function renderSettings(report){
  $('active-lane-rules').innerHTML=Object.entries(report.settings.lanes).map(([lane,policy])=>'<tr data-lane="'+lane+'"><th scope="row">Lane '+lane+'</th><td>'+esc(names(policy.requiredMeasures))+'</td><td>'+esc(names(policy.rankedMeasures))+'<small>'+esc(formula(policy))+'</small></td><td>'+esc(coverageLabel(policy))+'<small>Missing optional ranked values: joint last place; raw values remain blank.</small></td></tr>').join('');
  $('ranking-note').textContent='Each lane has its own qualifying and points rules above. Missing required measures and unresolved identity or source conflicts can exclude someone. Missing optional ranked measures earn joint last place (known eligible observations + 1). Raw missing values stay blank. Missing optional correctives also add the lane’s largest known corrective penalty separately. Lowest total wins; equal totals share ranks and wins.';
}
function rowPolicy(row){return row.laneSettings||state.report.settings.lanes[String(row.lane)];}
function scored(measure,row){return rowPolicy(row).rankedMeasures.includes(measure);}
function rankNote(rank,measure,row){return scored(measure,row)?(row.missingRankedMeasures?.includes(measure)?'last place '+rankLabel(rank)+' (missing/unusable)':'rank '+rankLabel(rank)):(rowPolicy(row).requiredMeasures.includes(measure)?'required · not ranked':'not ranked');}
function fallbackNote(row){return row.missingRankedMeasures?.length?'Missing/unusable '+names(row.missingRankedMeasures)+' → joint last-place points'+(row.missingPenaltyAdjustment?' · +'+number(row.missingPenaltyAdjustment)+' missing-data adjustment':''):'';}
function presentLanes(reps=state.monthly?.parsed.reps||[]){return [...new Set(reps.map(rep=>String(rep.lane)))];}
function usesMeasure(settings,measure,reps){return presentLanes(reps).some(lane=>{const policy=settings.lanes[lane];return policy&&(policy.requiredMeasures.includes(measure)||policy.rankedMeasures.includes(measure));});}
function needsLane3(settings,reps){return presentLanes(reps).includes('3')&&settings.lanes['3'].requiredMeasures.includes('vaph');}
function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
function invalidate(message){state.revision++;state.report=null;$('results').hidden=true;$('export-report').disabled=true;$('report-setup').open=true;state.charts.forEach(c=>c.destroy());state.charts=[];if(message)status(message);ready();}
function ready(){let settings;try{settings=currentSettings();}catch(error){}const pending=settings&&usesMeasure(settings,'wipers')&&state.uploads.some(upload=>upload.busy||upload.error||upload.parsed?.requiresSelection),lane3Required=settings&&needsLane3(settings);$('run-report').disabled=state.busy||!state.monthly||(lane3Required&&(!state.lane3||!$('lane3-sheet').value))||!$('report-month').value||pending||!settings;}
function monthLabel(month){const [y,m]=month.split('-').map(Number);return new Date(y,m-1,15).toLocaleDateString('en-US',{month:'long',year:'numeric'});}
function selectLane3(){if(!state.lane3)return;const selected=C.selectMonthSheet(state.lane3.SheetNames,$('report-month').value);$('lane3-sheet').value=typeof selected==='string'?selected:selected?.sheetName||selected?.sheet||'';if(!$('lane3-sheet').value&&state.monthly&&policyDrafts['3'].requiredMeasures.includes('vaph'))status('No Lane 3 tab matched this month. Select the correct tab before running.',true);ready();}
async function readWorkbook(input,type){const file=input.files[0],out=$(type==='monthly'?'monthly-status':'lane3-status');state[type]=null;invalidate('Reading workbook…');out.className='file-status';if(!file){out.textContent='No file selected';ready();return;}out.textContent='Reading '+file.name+'…';input.disabled=true;try{const book=root.XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true});if(!book.SheetNames.length)throw Error('No worksheets found.');if(type==='monthly'){const parsed=C.parseMonthly(book,root.XLSX);if(!parsed.reps.length)throw Error('No representatives found in the monthly lane tabs.');state.monthly={book,parsed,fileName:file.name};out.textContent=file.name+' · '+parsed.reps.length+' representatives';}else{state.lane3=book;state.lane3.fileName=file.name;$('lane3-sheet').replaceChildren(...book.SheetNames.map(n=>new Option(n,n)));$('lane3-sheet').disabled=false;selectLane3();out.textContent=file.name+' · '+book.SheetNames.length+' tabs';}out.classList.add('ready');status('Monthly roster ready. A Lane 3 month tab is needed only when Lane 3 VAPH is required to qualify.');}catch(e){out.textContent=e.message;out.classList.add('error');status('Could not read '+file.name+'. '+e.message,true);}finally{input.disabled=false;ready();}}
function rankedRows(report){return report.rankedRows||report.rows.filter(row=>row.eligible);}
function excludedRows(report){return report.excludedRows||report.rows.filter(row=>!row.eligible);}
function rankLabel(rank){return Number.isFinite(rank)?'#'+rank:'—';}
function exclusionReasons(row){return row.exclusionReasons?.length?row.exclusionReasons:['Ranking data is missing or conflicting.'];}
function renderWinners(report){
  const eligible=rankedRows(report);
  $('winners').innerHTML=Array.from({length:5},(_,i)=>{
    const lane=i+1,group=report.rows.filter(row=>Number(row.lane)===lane),winners=eligible.filter(row=>Number(row.lane)===lane&&row.winner);
    const people=winners.map(row=>'<div class="winner-person"><h3>'+esc(row.name)+'</h3><p class="coach">'+esc(row.coach||'Coach unavailable')+'</p>'+
      '<p class="points">'+number(row.total)+'<small>total points</small></p>'+(fallbackNote(row)?'<p class="last-place-note">'+esc(fallbackNote(row))+'</p>':'')+
      '<dl class="winner-stats"><div><dt>Call Quality</dt><dd>'+pct(row.quality)+'<small>'+number(row.qaCount)+' evaluations · '+rankNote(row.ranks.quality,'quality',row)+'</small></dd></div>'+
      '<div><dt>Wipers</dt><dd>'+pct(row.wiperRate)+'<small>'+number(row.accepted)+' accepted / '+number(row.offered)+' offered · '+rankNote(row.ranks.wipers,'wipers',row)+'</small></dd></div>'+
      '<div><dt>'+(lane===3?'Cases / hr Salesforce':'VAPH')+'</dt><dd>'+number(row.vaph)+'<small>'+rankNote(row.ranks.vaph,'vaph',row)+'</small></dd></div></dl>'+
      '<p class="winner-counts">Attendance: '+number(row.attendance)+' ('+rankNote(row.ranks.attendance,'attendance',row)+')<br>Correctives: '+number(row.correctives)+' ('+rankNote(row.ranks.correctives,'correctives',row)+')'+(scored('correctives',row)?' · penalty '+number(row.penalty):'')+'</p></div>').join('');
    return '<article class="winner'+(!winners.length?' no-winner':'')+'" data-lane="'+lane+'"><div class="lane-label"><span>LANE '+lane+'</span><span aria-hidden="true">'+(winners.length?'★':'○')+'</span></div>'+
      (winners.length?'<p class="winner-kind">'+(winners.length>1?'Tied lane winners':'Lane winner')+'</p>'+people:'<h3>No eligible representatives</h3><p class="winner-empty">'+(group.length?group.length+' excluded. Review their data coverage below.':'No representatives in this lane.')+'</p>')+'</article>';
  }).join('');
}
function filteredRows(){if(!state.report)return[];const lane=$('lane-filter').value,q=$('rep-search').value.trim().toLowerCase();return rankedRows(state.report).filter(row=>(lane==='all'||String(row.lane)===lane)&&(!q||(row.name+' '+row.coach).toLowerCase().includes(q)));}
function metric(value,rank,format,measure,row){return (format||number)(value)+'<span class="rank-badge">'+rankNote(rank,measure,row)+'</span>';}
function renderTable(){
  const rows=filteredRows();
  $('standings').innerHTML=rows.length?rows.map(row=>'<tr class="'+(row.winner?'winner-row':'')+'"><td>'+number(row.laneRank)+(row.winner?'<br><span class="winner-tag">'+(rankedRows(state.report).filter(other=>other.lane===row.lane&&other.winner).length>1?'TIED WINNER':'LANE WINNER')+'</span>':'')+'</td><td class="rep-name">'+esc(row.name)+'<small>'+esc(row.coach||'Coach unavailable')+'</small></td><td>'+esc(row.lane)+'</td><td>'+metric(row.wiperRate,row.ranks.wipers,pct,'wipers',row)+'<small>'+number(row.accepted)+' accepted / '+number(row.offered)+' offered</small></td><td>'+metric(row.vaph,row.ranks.vaph,number,'vaph',row)+(row.lane===3?'<small>Cases / hr Salesforce</small>':'')+'</td><td>'+metric(row.quality,row.ranks.quality,pct,'quality',row)+'<small>'+number(row.qaCount)+' evaluations</small></td><td>'+metric(row.attendance,row.ranks.attendance,number,'attendance',row)+'</td><td>'+metric(row.correctives,row.ranks.correctives,number,'correctives',row)+'</td><td>'+(scored('correctives',row)?number(row.penalty):'—<small>not ranked</small>')+(row.missingPenaltyAdjustment?'<small>+'+number(row.missingPenaltyAdjustment)+' missing-data adjustment</small>':'')+'</td><td class="score">'+number(row.total)+(fallbackNote(row)?'<small>'+esc(fallbackNote(row))+'</small>':'')+'</td></tr>').join(''):'<tr><td colspan="10">No eligible representatives match your filters.</td></tr>';renderCharts(rows);
}
function renderCoverage(report){
  const excluded=excludedRows(report),warnings=[...new Set([...(report.warnings||[]),...rankedRows(report).flatMap(row=>(row.dataWarnings||[]).map(warning=>row.name+': '+warning.message+' (informational)'))])];
  $('eligibility-period').textContent=monthLabel(report.month)+' · '+report.rows.length+' representatives · '+rankedRows(report).length+' eligible · '+excluded.length+' excluded under the current options.';
  const comparison=report.eligibilityComparison;
  $('eligibility-comparison').textContent=comparison?'Eligible with performance only: '+comparison.threeMetricEligible+'. Eligible with all five measures and every available Wiper week required: '+comparison.strictEligible+'. Performance only includes '+comparison.recoveredByThreeMetrics+' more representative'+(comparison.recoveredByThreeMetrics===1?'':'s')+'.':'';
  $('reason-counts').innerHTML=report.lanes.some(lane=>lane.exclusionSummary?.length)?report.lanes.flatMap(lane=>(lane.exclusionSummary||[]).map(reason=>'<tr><td>'+lane.lane+'</td><td>'+esc(reason.label)+'</td><td>'+esc(measureNames[reason.metric]||'Roster / source')+'</td><td>'+number(reason.count)+'</td></tr>')).join(''):'<tr><td colspan="4">No representatives are excluded under the current options.</td></tr>';
  $('excluded-list').innerHTML=excluded.map(row=>'<li><strong>'+esc(row.name)+'</strong><span>Lane '+esc(row.lane)+' · '+esc(row.coach||'Coach unavailable')+'</span><ul>'+exclusionReasons(row).map(reason=>'<li>'+esc(reason)+'</li>').join('')+'</ul></li>').join('');
  $('excluded-review').hidden=!excluded.length;
  $('review-list').innerHTML=warnings.map(warning=>'<li>'+esc(warning)+'</li>').join('');
  $('review-list').hidden=!warnings.length;
  $('data-review').hidden=!excluded.length&&!warnings.length;
  $('review-title').textContent='Data coverage · '+excluded.length+' excluded'+(warnings.length?' · '+warnings.length+' note'+(warnings.length===1?'':'s'):'');
  $('data-review').open=rankedRows(report).length===0;
}
function renderCharts(rows){state.charts.forEach(c=>c.destroy());state.charts=[];const host=$('charts');host.replaceChildren();const weeks=state.report.weeks||[...new Set(state.report.rows.flatMap(r=>(r.weeklyWipers||[]).map(w=>w.week)))].sort();for(const r of rows){const card=document.createElement('article');card.className='chart-card';card.innerHTML='<div class="chart-head"><div><h3>'+esc(r.name)+'</h3><p>Lane '+esc(r.lane)+' · '+esc(r.coach||'Coach unavailable')+'</p></div><strong class="'+(r.wiperRate>=.23?'good':'bad')+'">'+pct(r.wiperRate)+'</strong></div>';if(!(r.weeklyWipers||[]).some(w=>Number.isFinite(w.rate))){const empty=document.createElement('div');empty.className='chart-empty';empty.textContent='No dated Wiper counts for this month';card.append(empty);}else{const wrap=document.createElement('div');wrap.className='canvas-wrap';const canvas=document.createElement('canvas');canvas.setAttribute('role','img');canvas.setAttribute('aria-label',r.name+' weekly Wiper rates: '+r.weeklyWipers.map(w=>w.week+' '+pct(w.rate)).join(', '));wrap.append(canvas);card.append(wrap);const points=weeks.map(week=>r.weeklyWipers.find(w=>w.week===week)?.rate??null);const chart=new root.Chart(canvas,{type:'line',data:{labels:weeks.map(w=>{const d=new Date(w+'T12:00:00');return Number.isNaN(d.getTime())?w:d.toLocaleDateString('en-US',{month:'short',day:'numeric'});}),datasets:[{label:'Wiper rate',data:points.map(v=>v==null?null:v*100),borderColor:'#2b6ea3',backgroundColor:'#2b6ea310',pointBackgroundColor:points.map(v=>v==null?'#cbd5e1':v>=.23?'#17815d':'#c74448'),pointBorderColor:points.map(v=>v==null?'#cbd5e1':v>=.23?'#17815d':'#c74448'),pointRadius:4,borderWidth:2,tension:.15,spanGaps:false},{label:'Referral goal · 23%',data:weeks.map(()=>23),borderColor:'#a87925',borderDash:[5,4],borderWidth:1.2,pointRadius:0}]},options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>ctx.dataset.label+': '+number(ctx.parsed.y)+'%',afterBody:items=>{const w=r.weeklyWipers.find(w=>w.week===weeks[items[0]?.dataIndex]);return w?number(w.accepted)+' accepted / '+number(w.offered)+' offered':'';}}}},scales:{y:{beginAtZero:true,suggestedMax:Math.max(30,...points.filter(v=>v!=null).map(v=>v*100+5)),ticks:{callback:v=>v+'%',font:{size:10}},grid:{color:'#edf0f3'}},x:{ticks:{font:{size:10}},grid:{display:false}}}}});state.charts.push(chart);}const counts=document.createElement('p');counts.className='chart-counts';counts.textContent=number(r.accepted)+' accepted · '+number(r.offered)+' offered · Goal 23%';card.append(counts);host.append(card);}}
async function run(){
  if($('run-report').disabled)return;
  const revision=state.revision;state.busy=true;ready();status('Connecting stored data and calculating lane rankings…');$('results').hidden=true;
  try{
    await new Promise(resolve=>root.setTimeout(resolve,0));
    const settings=currentSettings(),parsed=C.parseMonthly(state.monthly.book,root.XLSX),lane3=state.lane3&&$('lane3-sheet').value?C.parseLane3(state.lane3,$('lane3-sheet').value,root.XLSX):{values:{},warnings:[]},month=$('report-month').value;
    const data=await D.loadMonth(month,parsed.reps,{uploads:usesMeasure(settings,'wipers',parsed.reps)?state.uploads.map(upload=>upload.parsed):[]});
    if(revision!==state.revision)return;
    const report=C.buildReport({reps:data.reps||parsed.reps,lane3Values:lane3.values,metrics:data.metrics,month,settings});
    report.scopeLabel=data.scopeLabel||'All people';report.weeks=data.weeks;report.sources=data.sources;
    report.files={monthly:state.monthly.fileName,lane3:state.lane3?.fileName||'Not required for selected measures',lane3Sheet:$('lane3-sheet').value};
    report.warnings=[...new Set([...D.filterWarningsForRoster(parsed.warnings,data.reps||parsed.reps,data.scopeApplied),...D.filterWarningsForRoster(lane3.warnings,data.reps||parsed.reps,data.scopeApplied),...(data.diagnostics||[]),...(report.warnings||[])])];
    state.report=report;
    const eligible=rankedRows(report),excluded=excludedRows(report),readyLanes=report.lanes.filter(lane=>lane.ready).length;
    $('report-period').textContent=monthLabel(month).toUpperCase()+' / ALL STAR REPORT';
    $('report-summary').textContent=eligible.length+' representatives ranked · '+readyLanes+' of 5 lanes with winners · '+excluded.length+' excluded';
    renderSettings(report);renderWinners(report);renderCoverage(report);$('results').hidden=false;$('export-report').disabled=false;renderTable();$('report-setup').open=false;
    $('source-status').textContent='Loaded '+(data.weeks?.length||0)+' Wiper weeks for '+monthLabel(month)+', plus available evaluations and checklist records.';
    status(eligible.length?'Report ready. '+eligible.length+' representatives ranked; '+excluded.length+' excluded from rankings.':'No eligible representatives to rank. Review the individual data coverage notes.');
  }catch(error){status('Could not build the report. '+error.message,true);}
  finally{state.busy=false;ready();}
}
function exportReport(){
  const report=state.report;if(!report)return;
  const headers=['Month','Lane','Lane Rank','Representative','Coach','Wipers Accepted','Wipers Offered','Wiper Rate','Wiper Rank','VAPH / Lane 3 Cases per Hour','VAPH Rank','Call Quality','Call Quality Rank','Evaluation Count','Attendance Count','Attendance Rank','Corrective Count','Corrective Rank','Corrective Penalty','Total Points','Winner','Required Measure IDs','Ranked Measure IDs','Missing/Unusable Ranked Measures','Missing Ranked Policy','Missing Penalty Adjustment','Lane Points Formula'];
  const eligible=rankedRows(report),excluded=excludedRows(report);
  const values=rows=>rows.map(row=>{const policy=rowPolicy(row);return [report.month,row.lane,row.laneRank,row.name,row.coach,row.accepted,row.offered,row.wiperRate,row.ranks.wipers,row.vaph,row.ranks.vaph,row.quality,row.ranks.quality,row.qaCount,row.attendance,row.ranks.attendance,row.correctives,row.ranks.correctives,row.penalty,row.total,row.winner?'Yes':'',policy.requiredMeasures.join(', '),policy.rankedMeasures.join(', '),(row.missingRankedMeasures||[]).join(', '),policy.missingRankedPolicy,row.missingPenaltyAdjustment||0,formula(policy)];});
  const book=root.XLSX.utils.book_new();
  function appendTable(name,labels,rows){
    const sheet=root.XLSX.utils.aoa_to_sheet([labels,...rows]);sheet['!cols']=labels.map(label=>({wch:Math.max(14,Math.min(40,label.length+3))}));sheet['!autofilter']={ref:sheet['!ref']};
    labels.forEach((label,column)=>{if(['Wiper Rate','Call Quality','Rate'].includes(label))for(let row=1;row<=rows.length;row++){const cell=sheet[root.XLSX.utils.encode_cell({r:row,c:column})];if(cell)cell.z='0.0%';}});root.XLSX.utils.book_append_sheet(book,sheet,name);
  }
  appendTable('Full Rankings',headers,values(eligible));appendTable('Lane Winners',headers,values(eligible.filter(row=>row.winner)));
  appendTable('Excluded',['Month','Lane','Representative','Coach','Reasons Excluded','Required Measure IDs','Ranked Measure IDs','Wipers Accepted','Wipers Offered','Wiper Rate','VAPH / Lane 3 Cases per Hour','Call Quality','Evaluation Count','Attendance Count','Corrective Count'],excluded.map(row=>[report.month,row.lane,row.name,row.coach,exclusionReasons(row).join('; '),rowPolicy(row).requiredMeasures.join(', '),rowPolicy(row).rankedMeasures.join(', '),row.accepted,row.offered,row.wiperRate,row.vaph,row.quality,row.qaCount,row.attendance,row.correctives]));
  appendTable('Eligibility Review',['Month','Review Type','Code','Measure','Reason','People','Representative','Lane'],[
    ...report.lanes.flatMap(lane=>(lane.exclusionSummary||[]).map(reason=>[report.month,'Reason count',reason.code,measureNames[reason.metric]||'Roster / source',reason.label,reason.count,'',lane.lane])),
    ...excluded.flatMap(row=>(row.exclusionDetails||[]).map(reason=>[report.month,'Excluded person',reason.code,measureNames[reason.metric]||'Roster / source',reason.message,1,row.name,row.lane])),
    ...eligible.flatMap(row=>[...(row.dataWarnings||[]).map(warning=>[report.month,'Informational',warning.code,measureNames[warning.metric]||'Roster / source',warning.message,1,row.name,row.lane]),...(row.missingRankedMeasures||[]).map(measure=>[report.month,'Last-place points','missing-ranked-'+measure,measureNames[measure],'Missing/unusable optional ranked measure: joint last-place rank '+row.ranks[measure]+(measure==='correctives'?'; missing-data penalty adjustment '+(row.missingPenaltyAdjustment||0):''),1,row.name,row.lane])])
  ]);
  appendTable('Settings',['Lane','Required Measure IDs','Ranked Measure IDs','Every Available Wiper Week Required','Corrective Points Configured','Corrective Penalty Applied','Missing Ranked Policy','Points Formula','Policy JSON'],Object.entries(report.settings.lanes).map(([lane,policy])=>[Number(lane),policy.requiredMeasures.join(', '),policy.rankedMeasures.join(', '),policy.requireAllWiperWeeks,policy.correctivePenalty,policy.rankedMeasures.includes('correctives'),policy.missingRankedPolicy,formula(policy),JSON.stringify(policy)]));
  appendTable('Weekly Wipers',['Representative','Lane','Week','Accepted','Offered','Rate'],report.rows.flatMap(row=>(row.weeklyWipers||[]).map(week=>[row.name,row.lane,week.week,week.accepted,week.offered,week.rate])));
  root.XLSX.utils.book_append_sheet(book,root.XLSX.utils.aoa_to_sheet([['Report Month',report.month],['CoachTools Scope',report.scopeLabel||'All people'],['Monthly File',report.files.monthly],['Lane 3 File',report.files.lane3],['Lane 3 Tab',report.files.lane3Sheet],['Ranked Representatives',eligible.length],['Excluded Representatives',excluded.length],['Settings JSON',JSON.stringify(report.settings)],['Ranking','Each lane qualifies people using required measures and computes points using ranked measures. Tied ranks and wins are shared.'],['Missing optional ranked values','Joint last-place rank = known eligible observations + 1; raw values remain blank or flagged unusable.'],['Missing optional correctives','Actual penalty stays blank; a separate missing-data adjustment uses the largest known eligible corrective penalty in the lane.'],['Total Points','Sum of ranked ranks + known actual corrective penalty + missing-data adjustment. Lowest total wins.'],['Reason counts','Counts are unique people per lane/reason; reasons overlap.'],['Wiper month','Publication dates in selected calendar month; sum accepted / sum offered.'],['Added Wiper files',state.uploads.map(upload=>upload.file.name).join('; ')],['Coverage notes'],...report.warnings.map(warning=>[warning])]),'Sources and Notes');
  root.XLSX.writeFile(book,'Verification-All-Star-'+report.month+'.xlsx');
}
const uploadHost=document.createElement('div');$('wiper-status').after(uploadHost);
async function parseUpload(u){u.busy=true;u.error='';ready();try{u.parsed=await D.parseWiperUpload(u.file,u.options);u.error='';}catch(e){u.error=e.message;u.parsed=null;}finally{u.busy=false;renderUploads();ready();}}
function renderUploads(){uploadHost.replaceChildren();for(const u of state.uploads){const row=document.createElement('div');row.style.cssText='border-top:1px solid #dfe5eb;padding:10px 0;display:flex;gap:10px;align-items:center;flex-wrap:wrap';const label=document.createElement('span');label.textContent=u.file.name+(u.busy?' · reading…':u.error?' · '+u.error:' · '+(u.parsed?.rows?.length||0)+' rows');label.style.flex='1 1 220px';if(u.error)label.style.color='#c74448';row.append(label);const makeSelect=(items,key,current)=>{if(!items?.length)return;const select=document.createElement('select');select.setAttribute('aria-label',key+' for '+u.file.name);select.add(new Option('Choose '+key,'',false,!current));for(const item of items){const value=typeof item==='string'?item:item.id??item.key??item.value??item.label;const text=typeof item==='string'?item:item.label??item.name??value;select.add(new Option(text,value,false,value===current));}select.addEventListener('change',()=>{u.options[key]=select.value;invalidate('Wiper selection changed. Run again to refresh.');parseUpload(u);});row.append(select);};if(!u.busy){makeSelect(u.parsed?.sheets,'sheet',u.options.sheet||u.parsed?.selectedSheet);makeSelect(u.parsed?.periods,'period',u.options.period||u.parsed?.selectedPeriod);}const remove=document.createElement('button');remove.textContent='Remove';remove.addEventListener('click',()=>{state.uploads=state.uploads.filter(x=>x!==u);invalidate('Wiper additions changed. Run again to refresh.');renderUploads();});row.append(remove);uploadHost.append(row);}const count=state.uploads.reduce((n,u)=>n+(u.parsed?.rows?.length||0),0);$('wiper-status').textContent=state.uploads.length?count+' added Wiper rows. '+(state.uploads.some(u=>u.parsed?.requiresSelection)?'Choose the source sheet and period to continue.':'Stored data remains unchanged.'):'Using stored Wiper data.';}
$('report-month').value=C.previousMonth(new Date());
restoreSettings();
C.MEASURES.forEach(measure=>{$('measure-'+measure.id).addEventListener('change',settingsChanged);$('require-'+measure.id).addEventListener('change',settingsChanged);});
$('require-all-wiper-weeks').addEventListener('change',settingsChanged);$('corrective-penalty').addEventListener('change',settingsChanged);
$('preset-performance').addEventListener('click',()=>{preset(['wipers','vaph','quality']);});
$('preset-all').addEventListener('click',()=>{preset(C.MEASURES.map(measure=>measure.id));});
$('policy-lane').addEventListener('change',()=>{policyDrafts[editorLane]=readEditorPolicy();editorLane=$('policy-lane').value;loadEditor();ready();});
$('apply-all-lanes').addEventListener('click',()=>{try{const policy=validatePolicy(readEditorPolicy(),editorLane);for(let lane=1;lane<=5;lane++)policyDrafts[String(lane)]={...policy,requiredMeasures:[...policy.requiredMeasures],rankedMeasures:[...policy.rankedMeasures]};loadEditor();settingsChanged();status('This lane’s rules were copied to all five lanes. Run the report to refresh.');}catch(error){$('settings-error').textContent=error.message;$('settings-error').hidden=false;}});
$('edit-settings').addEventListener('click',()=>{$('report-setup').open=true;$('scoring-settings').scrollIntoView?.({block:'center',behavior:'smooth'});});
$('monthly-file').addEventListener('change',e=>readWorkbook(e.target,'monthly'));
$('lane3-file').addEventListener('change',e=>readWorkbook(e.target,'lane3'));
$('report-month').addEventListener('change',()=>{invalidate('Month changed. Run the report to refresh.');selectLane3();});
$('lane3-sheet').addEventListener('change',()=>invalidate('Lane 3 tab changed. Run again to refresh.'));
$('run-report').addEventListener('click',run);
$('lane-filter').addEventListener('change',renderTable);$('rep-search').addEventListener('input',renderTable);
$('export-report').addEventListener('click',exportReport);
$('refresh-data').addEventListener('click',()=>{invalidate('Stored data will be reread on the next run.');});
$('wiper-file').addEventListener('change',async e=>{const files=[...e.target.files];if(!files.length)return;invalidate('Reading additional Wiper data…');for(const file of files){const u={file,options:{publicationDate:$('wiper-date').value},parsed:null,busy:true};state.uploads.push(u);renderUploads();await parseUpload(u);}e.target.value='';status('Wiper additions ready when all source selections are complete.');});
$('wiper-date').addEventListener('change',async()=>{if(!state.uploads.length)return;invalidate('Wiper publication date changed. Run again to refresh.');for(const u of state.uploads){u.options.publicationDate=$('wiper-date').value;await parseUpload(u);}});
$('clear-wipers').addEventListener('click',()=>{state.uploads=[];invalidate('Wiper additions cleared. Using stored data on the next run.');renderUploads();});
if(root.CoachToolsAppData?.subscribeScope)root.CoachToolsAppData.subscribeScope(()=>{invalidate('CoachTools scope changed. Run again to show this scope.');});
if(root.CoachToolsAppData?.subscribe)root.CoachToolsAppData.subscribe(['weeklyReferral','weeklyRetail','qa','checklist'],()=>{invalidate('Stored data changed. Run the report again to refresh rankings.');});
root.addEventListener('beforeunload',()=>state.charts.forEach(c=>c.destroy()));
ready();
})(window);
