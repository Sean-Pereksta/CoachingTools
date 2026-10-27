#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {parseHTML}=require('linkedom');
const workflow=require('../qualtrics/workflow.js'),engine=require('../qualtrics/individual-messages.js');
const html=fs.readFileSync(path.join(__dirname,'../qualtrics/generator.html'),'utf8');
const ui=fs.readFileSync(path.join(__dirname,'../qualtrics/individual-ui.js'),'utf8');
const date=value=>new Date(`${value}T00:00:00`),reportDate=date('2026-10-14');
const need=(repKey,topic,overrides={})=>({repKey,repName:repKey,topicId:topic,topic,lookbackDays:14,recent:false,...overrides});

// One row per stable identity, one count per topic, and topic-matched recency rather than any coaching.
const rows=workflow.coachingNeedsRows([
  need('Never','QA',{latestAnyCoaching:date('2026-10-13')}),need('Never','Sales'),need('Never','Sales'),
  need('Mixed','QA',{recent:true,latestTopicCoaching:date('2026-10-10')}),need('Mixed','Sales',{latestTopicCoaching:date('2026-09-01'),lookbackDays:21}),
  need('Recent','QA',{recent:true,latestTopicCoaching:date('2026-10-10')}),
  need('Repeat','QA',{recent:true,followUp:true,latestTopicCoaching:date('2026-10-10')}),
  need('Future','QA',{latestTopicCoaching:date('2026-10-15'),latestAnyCoaching:date('2026-10-15')}),
  need('Separate','QA',{repName:'Never',coach:'Different Coach'})
],reportDate);
assert.equal(rows.length,5,'all-recent ordinary needs are excluded; distinct identities with the same name remain separate');
const never=rows.find(row=>row.Representative==='Never'&&row.Coach==='');
assert.equal(never.Priority,'High');assert.equal(never['Total Concern Topics'],2);assert.equal(never['Latest Any Coaching'],'2026-10-13');assert.equal(never['Days Since Any Coaching'],1);
assert.match(never['Topics Needing Coaching'],/QA.*Sales/,'unrelated coaching cannot close topic coaching gaps');
const mixed=rows.find(row=>row.Representative==='Mixed');
assert.equal(mixed.Priority,'Medium');assert.equal(mixed['Topics Without Recent Coaching'],1);assert.equal(mixed['Topics Needing Coaching'],'Sales');assert.match(mixed['Topic Lookback Days'],/Sales: 21/);
assert.equal(rows.find(row=>row.Representative==='Repeat').Priority,'Low — follow-up');
assert.equal(rows.find(row=>row.Representative==='Future')['Latest Topic Coaching'],'','future-dated coaching never appears as historical evidence');
assert.ok(rows.findIndex(row=>row.Priority==='Medium')>rows.map(row=>row.Priority).lastIndexOf('High'),'all High representatives sort before Medium');
const csv=workflow.coachingNeedsCsv([{...never,Representative:'=HYPERLINK("example")',Coach:'Coach, One','Priority Reason':'First line\nSecond line'}]);
assert.ok(csv.startsWith('\ufeff'));assert.match(csv,/"'=HYPERLINK\(""example""\)"/);assert.match(csv,/"Coach, One"/);assert.match(csv,/"First line\nSecond line"/);

const {document}=parseHTML(html),els=Object.fromEntries([...document.querySelectorAll('[id]')].map(node=>[node.id,node]));
els.reportDate.value='2026-10-14';els.globalCoachLookback.value='2';els.individualMaxConcerns.value='1';
const reps=['Never','Mixed','Recent','Repeat','Healthy'].map((fullName,i)=>({repKey:fullName,fullName,coach:i%2?'Coach B':'Coach A',team:'Work Group',organizationNames:['Org One']}));
const rules=['QA','Sales'].map(id=>({id,title:id,coachLookbackWeeks:id==='Sales'?3:2,individualMessage:{concern:{enabled:true,sourceType:'stat',source:id,operator:'lt',threshold:'50',message:`Review ${id}`},strength:{enabled:false}}}));
const scores={Never:{QA:20,Sales:25},Mixed:{QA:20,Sales:25},Recent:{QA:20,Sales:60},Repeat:{QA:20,Sales:60},Healthy:{QA:60,Sales:60}};
const coachingByRep=new Map([
 ['Never',[{date:date('2026-10-15'),topic:'QA'},{date:date('2026-10-13'),topic:'Unrelated'}]],
 ['Mixed',[{date:date('2026-10-10'),topic:'QA'},{date:date('2026-09-01'),topic:'Sales'}]],
 ['Recent',[{date:date('2026-10-10'),topic:'QA'}]],['Repeat',[{date:date('2026-10-10'),topic:'QA'}]]
]);
const oldResults=[{fullName:'Stale message only',sendReady:false}],state={rules,dashboardFiles:[],selectedOtherRuleIds:new Set(),individualDataRevision:1,individualRosterRows:[],individualRosterRevision:0,individualResults:oldResults,individualResultsStale:true,individualScopeSelection:{allByDefault:true,organizationIds:new Set(),coachKeys:new Set(),includeRepKeys:new Set(),excludeRepKeys:new Set()},hireDateSettings:{filterEnabled:false}};
let downloads=[],notices=[],progress=[],yieldHook=null,generationHook=null,historyWrites=0;
const context=vm.createContext({state,els,document,QualtricsWorkflow:workflow,QualtricsIndividualMessages:engine,window:{},Blob,Date,Map,Set,AbortController,console,performance,setTimeout,clearTimeout,requestAnimationFrame:fn=>setTimeout(fn,0),cancelAnimationFrame:clearTimeout,URLSearchParams,location:{search:''},toast:message=>notices.push(message),downloadBlob:(blob,name)=>downloads.push({blob,name}),autoSaveRuleEdit(){},ymd:d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,parseDate:value=>value?date(value):null,addDays:(d,days)=>{const next=new Date(d);next.setDate(next.getDate()+days);return next;},rowsForRep:(_,key)=>coachingByRep.get(key)||[],coachingMatchInfo:(row,rule)=>({matches:row.topic===rule.id}),concernHistoryForRecord:record=>({appearanceCount:record.repKey==='Repeat'?2:0}),setProgress:(pct,phase)=>progress.push({pct,phase}),setStatus(){},queueConcernHistory:async fn=>fn(),put:()=>historyWrites++,incrementConcernAppearances:()=>historyWrites++});
vm.runInContext(html.slice(html.indexOf('function parseDate('),html.indexOf("const HIRE_DATE_SETTINGS_KEY=")),context);
vm.runInContext(ui,context);
vm.runInContext(html.slice(html.indexOf('function coachMatch('),html.indexOf('function matchingCoachingEmptyHtml(')),context);
Object.assign(context,{uid:()=>`run-${Date.now()}`,individualScopeIndex:()=>({representatives:reps}),individualResolvedScope:()=>reps,individualSelectedRules:()=>rules,individualSelectedReportFiles:()=>[],renderIndividualScopeSummary(){},renderIndividualExportSelection(){},renderEmailWorkflowStatus(){},individualYieldToBrowser:async()=>{if(yieldHook)await yieldHook();},individualStatObservation:(rep,source)=>({value:scores[rep.repKey][source],raw:scores[rep.repKey][source],missing:false}),currentReportAudience:()=>({scope:'all',value:'',minPeople:1}),generateReport:async()=>{if(generationHook)return generationHook();state.report={reportDate:'2026-10-14',flagged:[]};}});
context.bindIndividualMessages();
assert.ok(document.querySelector('#view-report > .coachingNeedsExportCard #exportEmailCoachingNeedsBtn'));
assert.ok(document.querySelector('#view-individual > .coachingNeedsExportCard #exportIndividualCoachingNeedsBtn'));

async function main(){
 // Fresh evaluation does not require an email roster and cannot reuse stale reviewed messages.
 await context.exportIndividualCoachingNeeds();
 assert.equal(downloads.length,1);assert.equal(state.individualResults,oldResults);assert.equal(state.individualResultsStale,true);assert.equal(state.individualCoachingExportRun,null);assert.equal(historyWrites,0);
 const individualCsv=await downloads[0].blob.text();
 assert.match(downloads[0].name,/qualtrics_individual_coaching_needs_2026-10-14.csv/);
 assert.match(individualCsv,/"Never","High"/);assert.match(individualCsv,/"Mixed","Medium"/);assert.match(individualCsv,/"Repeat","Low — follow-up"/);
 assert.ok(!individualCsv.includes('"Recent"'));assert.ok(!individualCsv.includes('"Healthy"'));assert.ok(!individualCsv.includes('Stale message only'));
 assert.match(individualCsv,/QA: 14 \| Sales: 14/,'both concerns survive a one-message cap and use the global weeks setting');assert.match(individualCsv,/"Org One"/);
 assert.ok(progress.some(item=>/concern topics/.test(item.phase||'')),'long evaluation yields and reports progress');
 // Changes during a responsive run cancel the old snapshot before a download.
 downloads=[];yieldHook=async()=>{yieldHook=null;context.invalidateIndividualRunCache('scope changed');};
 await context.exportIndividualCoachingNeeds();assert.equal(downloads.length,0);assert.equal(state.individualCoachingExportRun,null);assert.match(els.individualCoachingNeedsStatus.textContent,/cancelled or inputs changed/);
 // Both entry points reject simultaneous work without changing prior results.
 state.individualReviewRun={};await context.exportIndividualCoachingNeeds();await context.exportEmailCoachingNeeds();assert.equal(downloads.length,0);state.individualReviewRun=null;
 const emailRecord=(rep,rule)=>({repKey:rep.repKey,repName:rep.fullName,coach:rep.coach,team:rep.team,ruleId:rule.id,ruleTitle:rule.title,coached:context.coachMatch(rep,rule,reportDate,rule.coachLookbackWeeks),concernHistory:{appearanceCount:rep.repKey==='Repeat'?2:0}});
 generationHook=async()=>{state.report={reportDate:'2026-10-14',flagged:reps.filter(rep=>rep.repKey!=='Healthy').flatMap(rep=>rules.filter(rule=>scores[rep.repKey][rule.id]<50).map(rule=>emailRecord(rep,rule)))};};
 // The email export also regenerates and deduplicates all qualifying report records.
 await context.exportEmailCoachingNeeds();assert.equal(downloads.length,1);assert.equal(state.emailWorkflowRunning,false);assert.equal(historyWrites,0);
 const emailCsv=await downloads[0].blob.text();assert.match(downloads[0].name,/qualtrics_email_coaching_needs/);assert.match(emailCsv,/"Never","High"/);assert.match(emailCsv,/"Mixed","Medium"/);assert.ok(!emailCsv.includes('"Recent"'));
 downloads=[];generationHook=async()=>{state.report={reportDate:'2026-10-14',flagged:[],allFlagged:[emailRecord(reps[0],rules[0]),emailRecord(reps[0],rules[1])],minPeople:10};};
 await context.exportEmailCoachingNeeds();assert.equal(downloads.length,1,'small teams hidden in emails must remain in the full coaching list');assert.match(await downloads[0].blob.text(),/"Never","High"/);
 downloads=[];generationHook=async()=>{};await context.exportEmailCoachingNeeds();assert.equal(downloads.length,0,'validation returning early must not export an older report');
 generationHook=async()=>{state.report={reportDate:'2026-10-14',flagged:[emailRecord(reps[0],rules[0])]};state.individualDataRevision++;};
 await context.exportEmailCoachingNeeds();assert.equal(downloads.length,0,'newly loaded data invalidates an export snapshot');assert.match(els.emailCoachingNeedsStatus.textContent,/inputs changed/);
 generationHook=async()=>{throw new Error('Read failure');};await context.exportEmailCoachingNeeds();assert.equal(downloads.length,0);assert.equal(state.emailWorkflowRunning,false);assert.match(els.emailCoachingNeedsStatus.textContent,/Read failure/);
 assert.equal(historyWrites,0,'coaching needs exports never record concern or email history');
 console.log('PASS Qualtrics coaching needs: full-scope fresh exports, recency priority, topic deduplication, repeat follow-up, no roster/caps/view limits, CSV integrity, read-only and race guards');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
