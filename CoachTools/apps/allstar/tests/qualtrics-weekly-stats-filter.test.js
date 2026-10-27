#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const workflow=require('../qualtrics/workflow.js');
const html=fs.readFileSync(path.join(__dirname,'../qualtrics/generator.html'),'utf8');
const ui=fs.readFileSync(path.join(__dirname,'../qualtrics/individual-ui.js'),'utf8');

if(!process.argv.includes('--timezone-case')){
  for(const timezone of ['UTC','America/New_York']){
    const result=spawnSync(process.execPath,[__filename,'--timezone-case'],{encoding:'utf8',env:{...process.env,TZ:timezone}});
    assert.equal(result.status,0,`${timezone}\n${result.stdout}\n${result.stderr}`);
    process.stdout.write(result.stdout);
  }
  process.exit(0);
}

function sourceFunction(source,name){
  const match=new RegExp(`^(?:async )?function ${name}\\(`,'m').exec(source);
  assert.ok(match,`Production function ${name} must exist`);
  const rest=source.slice(match.index),next=/\r?\n(?=(?:async )?function |(?:const|let|var) )/.exec(rest);
  return next?rest.slice(0,next.index):rest;
}
const local=(year,month,day,hour=0,minute=0,second=0,ms=0)=>new Date(year,month-1,day,hour,minute,second,ms);
const els={reportDate:{value:'2026-10-27'},globalCoachLookback:{value:'2'},hideRepsWithoutRecentStats:{checked:false},weeklyStatsFilterWeeks:{value:'2',disabled:false},weeklyStatsFilterStatus:{textContent:''}};
const state={weeklyStatsFilter:{enabled:false,weeks:2},weeklyStatsRows:[],indexes:{weeklyByRep:new Map()},qaRows:[],coachingRows:[],checklistRows:[],rules:[],dashboardFiles:[],selectedOtherRuleIds:new Set(),individualDataRevision:1,hireDateSettings:{filterEnabled:false}};
const stored=new Map(),localStorage={getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value)};
const context=vm.createContext({Date,Map,Set,console,els,state,localStorage,QualtricsWorkflow:workflow,rowsForRep:(kind,key)=>state.indexes[kind]?.get(key)||[]});
for(const name of ['parseDate','ymd','normalizeCoachLookbackWeeks','currentCoachLookbackWeeks','coachingDateRange','normalizeWeeklyStatsFilter','currentWeeklyStatsFilter','weeklyStatsActivityKeys','weeklyStatsActivityPasses','renderWeeklyStatsFilter','loadWeeklyStatsFilter','saveWeeklyStatsFilter']){
  vm.runInContext(sourceFunction(html,name),context);
}
const plain=value=>JSON.parse(JSON.stringify(value));
assert.deepEqual(plain(context.normalizeWeeklyStatsFilter()),{enabled:false,weeks:2});
assert.equal(context.normalizeWeeklyStatsFilter({enabled:'false'}).enabled,false,'malformed saved values cannot accidentally enable hiding');
for(const weeks of ['',0,'invalid'])assert.equal(context.normalizeWeeklyStatsFilter({enabled:true,weeks}).weeks,2,'missing or invalid weeks use the simple two-week default');
assert.equal(context.normalizeWeeklyStatsFilter({weeks:1}).weeks,1);
assert.equal(context.normalizeWeeklyStatsFilter({weeks:3}).weeks,3);

function install(rows){
  state.weeklyStatsRows=rows;
  const byRep=new Map();
  for(const row of rows){ if(!byRep.has(row.repKey))byRep.set(row.repKey,[]);byRep.get(row.repKey).push(row); }
  state.indexes={weeklyByRep:byRep};
}
function filter(enabled,weeks=2){els.hideRepsWithoutRecentStats.checked=enabled;els.weeklyStatsFilterWeeks.value=String(weeks);}
const row=(repKey,date,raw={})=>({repKey,key:repKey,name:repKey,date,raw});
const sortedKeys=set=>[...set].sort();

// Presence is based on dated Weekly Stats, including valid zeros; neither QA nor coaching substitutes.
for(const reportDate of [local(2026,10,27),local(2026,11,3)]){
  const {start,end}=context.coachingDateRange(reportDate,2),oneWeek=new Date(reportDate),twentyDays=new Date(reportDate),tomorrow=new Date(reportDate);
  oneWeek.setDate(oneWeek.getDate()-7);twentyDays.setDate(twentyDays.getDate()-20);twentyDays.setHours(12);tomorrow.setDate(tomorrow.getDate()+1);
  const rows=[row('zeros',new Date(end),{Appointments:0,Opportunities:0}),row('boundary',new Date(start)),row('seven-days',oneWeek),row('old',new Date(start.getTime()-1)),row('twenty-days',twentyDays),row('future',tomorrow),row('invalid',new Date(NaN)),row('undated',null),row('mixed',tomorrow),row('mixed',oneWeek)];
  install(rows);
  state.qaRows=[row('qa-only',new Date(reportDate))];state.coachingRows=[row('coaching-only',new Date(reportDate))];
  filter(false);
  for(const key of ['zeros','old','future','invalid','undated','absent','qa-only','coaching-only'])assert.equal(context.weeklyStatsActivityPasses(key,reportDate),true,'disabled activity filtering preserves the original scope');
  filter(true);
  assert.deepEqual(sortedKeys(context.weeklyStatsActivityKeys(reportDate,2)),['boundary','mixed','seven-days','zeros']);
  for(const key of ['zeros','boundary','seven-days','mixed'])assert.equal(context.weeklyStatsActivityPasses(key,reportDate),true,`${key} has a dated stats row in the inclusive window`);
  for(const key of ['old','twenty-days','future','invalid','undated','absent','qa-only','coaching-only'])assert.equal(context.weeklyStatsActivityPasses(key,reportDate),false,`${key} has no qualifying Weekly Stats`);
  filter(true,1);
  assert.equal(context.weeklyStatsActivityPasses('boundary',reportDate),false,'changing the weeks immediately tightens the window');
  assert.equal(context.weeklyStatsActivityPasses('seven-days',reportDate),true,'the selected lower boundary remains inclusive');
  filter(true,3);
  assert.equal(context.weeklyStatsActivityPasses('twenty-days',reportDate),true,'three weeks includes a twenty-day-old stats record');
  assert.equal(context.weeklyStatsActivityPasses('future',reportDate),false,'increasing weeks never includes tomorrow');
  assert.equal(context.weeklyStatsActivityPasses('mixed',reportDate),true,'an eligible row must count even when a future row sorts first');
  assert.equal(context.weeklyStatsActivityPasses('future',tomorrow),true,'changing report date rebuilds the as-of window');
}

// Import replacement and an empty dataset must invalidate any previously eligible cached population.
const reportDate=local(2026,10,27);
filter(true,2);install([row('first-upload',reportDate)]);
assert.equal(context.weeklyStatsActivityPasses('first-upload',reportDate),true);
install([row('second-upload',reportDate)]);
assert.equal(context.weeklyStatsActivityPasses('first-upload',reportDate),false);
assert.equal(context.weeklyStatsActivityPasses('second-upload',reportDate),true);
state.indexes={};state.weeklyStatsRows=[row('unindexed-upload',reportDate)];
assert.equal(context.weeklyStatsActivityPasses('unindexed-upload',reportDate),true,'a replaced source can be evaluated before its weekly index is available');
install([]);
assert.equal(context.weeklyStatsActivityPasses('second-upload',reportDate),false,'an enabled filter with no dated Weekly Stats excludes every representative');
context.renderWeeklyStatsFilter();
assert.match(els.weeklyStatsFilterStatus.textContent,/Weekly Stats/i,'the status explains the relevant source');
filter(false);context.renderWeeklyStatsFilter();
assert.equal(els.weeklyStatsFilterWeeks.disabled,true,'weeks are disabled while the optional filter is off');
assert.equal(context.weeklyStatsActivityPasses('absent',reportDate),true,'turning the filter off restores eligibility without deleting source rows');

// Preferences survive reopening, while corrupt persisted settings safely return to the default.
stored.clear();context.loadWeeklyStatsFilter();
assert.equal(els.hideRepsWithoutRecentStats.checked,false);assert.equal(els.weeklyStatsFilterWeeks.value,'2');
filter(true,3);context.saveWeeklyStatsFilter();
assert.deepEqual(JSON.parse(stored.get('coachingEmailGeneratorWeeklyStatsFilter.v1')),{enabled:true,weeks:3});
filter(false,1);state.weeklyStatsFilter={enabled:false,weeks:1};context.loadWeeklyStatsFilter();
assert.equal(els.hideRepsWithoutRecentStats.checked,true);assert.equal(els.weeklyStatsFilterWeeks.value,'3');
stored.set('coachingEmailGeneratorWeeklyStatsFilter.v1','invalid JSON');context.loadWeeklyStatsFilter();
assert.equal(els.hideRepsWithoutRecentStats.checked,false);assert.equal(els.weeklyStatsFilterWeeks.value,'2');

// Both asynchronous export signatures must change with activity settings, even if the visible people stay the same.
const selection={allByDefault:true,organizationIds:new Set(),coachKeys:new Set(),includeRepKeys:new Set(),excludeRepKeys:new Set()};
Object.assign(context,{individualScopeSelection:()=>selection,currentReportAudience:()=>({scope:'all',value:'',minPeople:1})});
vm.runInContext(sourceFunction(ui,'individualReviewSignature'),context);
vm.runInContext(sourceFunction(ui,'emailCoachingNeedsSignature'),context);
const people=[{repKey:'person'}],signature=()=>context.individualReviewSignature(people,[],[],{},reportDate);
filter(false,2);const individualOff=signature(),emailOff=context.emailCoachingNeedsSignature();
filter(true,2);const individualOn=signature(),emailOn=context.emailCoachingNeedsSignature();
assert.notEqual(individualOff,individualOn,'individual export snapshots include whether activity filtering is enabled');
assert.notEqual(emailOff,emailOn,'email export snapshots include whether activity filtering is enabled');
filter(true,3);
assert.notEqual(individualOn,signature(),'individual export snapshots include the selected activity weeks');
assert.notEqual(emailOn,context.emailCoachingNeedsSignature(),'email export snapshots include the selected activity weeks');

// Filtering is applied after explicit selections and to team denominators, without deleting those selections.
const scopePeople=[{repKey:'active',fullName:'Active Rep',coach:'Coach'},{repKey:'inactive',fullName:'Inactive Rep',coach:'Coach'}];
selection.includeRepKeys=new Set(['active','inactive']);
Object.assign(context,{QualtricsIndividualMessages:{resolveScope:()=>scopePeople},individualScopeIndex:()=>({}),individualNameAllowed:()=>true,hireDatePassesReportFilter:()=>true,coachNameKey:value=>String(value||'').toLowerCase(),assignedRepSetForCoach:()=>new Set(['active','inactive'])});
for(const [source,name] of [[ui,'individualResolvedScope'],[html,'assignedRepSetForRows'],[html,'reportTeamPopulationForRows']])vm.runInContext(sourceFunction(source,name),context);
install([row('active',reportDate)]);filter(true,2);
assert.deepEqual(context.individualResolvedScope().map(rep=>rep.repKey),['active'],'explicitly selected inactive people are hidden from individual evaluation');
assert.deepEqual([...selection.includeRepKeys],['active','inactive'],'hiding never destroys explicit selections');
assert.deepEqual(sortedKeys(context.assignedRepSetForRows(scopePeople,reportDate)),['active'],'inactive people do not inflate assigned-representative totals');
assert.deepEqual(sortedKeys(context.reportTeamPopulationForRows(scopePeople,reportDate).get('coach')),['active'],'fallback report rows cannot add an inactive person back into the denominator');
filter(false);
assert.deepEqual(context.individualResolvedScope().map(rep=>rep.repKey),['active','inactive'],'turning the filter off restores the selected people');
assert.deepEqual(sortedKeys(context.assignedRepSetForRows(scopePeople,reportDate)),['active','inactive']);

async function asynchronousGuards(){
  const notices=[];
  Object.assign(context,{AbortController,performance,setTimeout,URLSearchParams,location:{search:''},toast:message=>notices.push(message),setStatus(){},setProgress(){},renderIndividualExportSelection(){}});
  for(const name of ['invalidateIndividualRunCache','individualThrowIfCancelled','evaluateIndividualMessages'])vm.runInContext(sourceFunction(ui,name),context);
  vm.runInContext(sourceFunction(html,'markWeeklyStatsFilterResultsStale'),context);

  // An explicit filter change cancels both ongoing individual work types.
  const reviewController=new AbortController(),exportController=new AbortController();
  state.individualReviewRun={controller:reviewController};state.individualCoachingExportRun={controller:exportController};state.individualResults=[{repKey:'prior'}];
  context.invalidateIndividualRunCache('weekly stats filter changed');
  assert.equal(reviewController.signal.aborted,true);assert.equal(exportController.signal.aborted,true);
  assert.equal(state.individualResultsStale,true);
  state.individualReviewRun=null;state.individualCoachingExportRun=null;

  // Cancel at the final pre-commit yield: the previous reviewed results must survive intact.
  const priorResults=[{repKey:'previous-review'}],priorEvaluation={results:priorResults};
  state.individualResults=priorResults;state.individualEvaluation=priorEvaluation;state.individualResultsStale=false;state.individualRunCache=null;state.individualRosterRows=[{Name:'Prior Rep',Username:'prior@example.test'}];
  let yields=0,renderedNewReview=0;
  const evaluation={results:[{repKey:'would-be-hidden'}],summary:{evaluated:1,attention:1,mixed:0,strengthOnly:0}};
  Object.assign(context,{
    uid:()=> 'guard-review',individualSelectedRules:()=>[{id:'rule'}],individualSelectedReportFiles:()=>[],individualTemplateFromForm:()=>({}),
    renderIndividualScopeSummary(){},setIndividualReviewProgress(){},buildIndividualRunContext:async()=>({}),createIndividualResolver:()=>({}),
    renderIndividualSummary(){},renderIndividualReview:()=>renderedNewReview++,renderIndividualPerformance(){},
    individualYieldToBrowser:async()=>{if(++yields===3){filter(true,1);context.invalidateIndividualRunCache('weekly stats filter changed');}},
    QualtricsIndividualMessages:{...context.QualtricsIndividualMessages,buildRosterIndex:()=>({}),evaluateAllAsync:async()=>evaluation,sortReviewResults:results=>results,summarize:()=>evaluation.summary}
  });
  filter(false);await context.evaluateIndividualMessages();
  assert.equal(yields,3,'the fixture cancels after evaluation and ranking, immediately before the message-state commit');
  assert.equal(state.individualResults,priorResults,'cancelled work must not overwrite the previous result array');
  assert.equal(state.individualEvaluation,priorEvaluation,'cancelled work must not overwrite the previous evaluation');
  assert.equal(state.individualResultsStale,true,'the old review remains clearly stale after the filter change');
  assert.equal(renderedNewReview,0);assert.equal(state.individualReviewRun,null);

  // Replacing imported Weekly Stats refreshes the top status and invalidates an existing report.
  for(const name of ['rebuildIdentityAliases','applyIdentityToRows','rebuildCoachingTypeOptions','rebuildCoachAliasIndex','applyCoachAliasesToRows','rebuildTeamMapFromCoreData','applyCoachAliasesToTeamMap','rebuildHireDateIndex','renderCoreChips','renderHireDateControls','renderUploadReadiness','renderCoachAliasReview','renderReportAudienceControls','invalidateIndividualScopeIndex','markRulePreviewStale'])context[name]=()=>{};
  context.rebuildDataIndexes=()=>{state.indexes={weeklyByRep:new Map([['replacement',[row('replacement',reportDate)] ]])};};
  vm.runInContext(sourceFunction(html,'rebuildDerivedMaps'),context);
  state.weeklyStatsRows=[row('replacement',reportDate)];state.report={weeklyStatsFilterStale:false};els.weeklyStatsFilterStatus.textContent='old source status';filter(true,2);
  context.rebuildDerivedMaps();
  assert.equal(state.report.weeklyStatsFilterStale,true,'new Weekly Stats invalidate report exports when activity filtering is enabled');
  assert.match(els.weeklyStatsFilterStatus.textContent,/1 rep/,'source replacement refreshes the visible eligible-representative count');

  // A filter change or source replacement during ZIP creation must prevent a stale email download.
  let downloads=0,zipHook=()=>{};
  class TestZip{file(){}async generateAsync(){await Promise.resolve();zipHook();return {};}}
  Object.assign(context,{window:{JSZip:TestZip},JSZip:TestZip,refreshReportConcernHistory(){},makeEmailHtml:()=>'',makeEml:()=>'',summaryStats:()=>({}),compareAlarmStats:()=>0,sanitizeFile:value=>value,downloadBlob:()=>downloads++});
  els.exportMsgExtension={checked:false};
  vm.runInContext(sourceFunction(html,'exportEmails'),context);
  const makeReport=()=>({reportDate:'2026-10-27',flagged:[{repKey:'prior-population'}],byCoach:new Map(),weeklyStatsFilterStale:false});
  filter(false);state.report=makeReport();zipHook=()=>filter(true,3);await context.exportEmails();
  assert.equal(downloads,0,'the selected filter cannot change while a ZIP is being prepared');
  assert.match(notices.at(-1),/Generate the report again/);
  filter(true,2);state.report=makeReport();zipHook=()=>context.markWeeklyStatsFilterResultsStale();await context.exportEmails();
  assert.equal(downloads,0,'a replaced stats source cannot download the old report population');
  state.report=makeReport();zipHook=()=>{};await context.exportEmails();
  assert.equal(downloads,1,'a report with unchanged inputs can still be downloaded');

  // The additional current-report impact downloads obey the same stale-report boundary.
  let impactDownloads=0;
  Object.assign(context,{impactDownloadRows:()=>impactDownloads++,impactScopedNeeds:()=>[],impactExportShape:value=>value});
  for(const name of ['impactExportCurrent','impactExportOverallPdf'])vm.runInContext(sourceFunction(html,name),context);
  state.report={...makeReport(),weeklyStatsFilterStale:true,coachingImpact:{needs:[{repKey:'prior-population'}]}};
  context.impactExportCurrent();await context.impactExportOverallPdf();
  assert.equal(impactDownloads,0,'impact downloads cannot expose people from a stale report');
  assert.match(notices.at(-1),/Generate the report again/);
  console.log(`PASS Qualtrics Weekly Stats filter (${process.env.TZ}): defaults, calendar/DST bounds, source-only activity, zeros, replacements, persistence, scopes, denominators, export snapshots and asynchronous stale-result guards`);
}
asynchronousGuards().catch(error=>{console.error(error);process.exitCode=1;});
