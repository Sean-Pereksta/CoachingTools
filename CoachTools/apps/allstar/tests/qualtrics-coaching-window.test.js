#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const insights=require('../qualtrics/insights.js'),workflow=require('../qualtrics/workflow.js');
const html=fs.readFileSync(path.join(__dirname,'../qualtrics/generator.html'),'utf8');
const ui=fs.readFileSync(path.join(__dirname,'../qualtrics/individual-ui.js'),'utf8');

// Exercise local calendar boundaries both with and without a daylight-saving transition.
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
const els={globalCoachLookback:{value:'2'},reportDate:{value:'2026-10-27'},ruleNamePreview:{}};
const state={coachLookbackWeeks:2,coachingRows:[],checklistRows:[],qaRows:[],weeklyStatsRows:[],reportSettings:{weightsEnabled:false}};
const byRep=new Map();
const savedSettings=new Map(),localStorage={getItem:key=>savedSettings.get(key)??null,setItem:(key,value)=>savedSettings.set(key,value)};
const context=vm.createContext({Date,Map,Set,console,els,state,localStorage,rowsForRep:(_,key)=>byRep.get(key)||[],QualtricsWorkflow:workflow});
for(const name of ['parseDate','addDays','normalizeCoachLookbackWeeks','currentCoachLookbackWeeks','normalizeWeeklyStatsFilter','currentWeeklyStatsFilter','weeklyStatsActivityPasses','coachingDateRange','loadCoachLookbackWeeks','saveCoachLookbackWeeks','splitListInput','cleanTextForSearch','phraseListFromRule','typeListFromRule','splitCoachingTypes','textMatch','coachingTopicMatches','coachingMatchInfo','coachMatch','coachingSummaryFromRows','matchingCoachingRowsForRule','urgencyCoachingLookbackWeeks','urgencyCoachingPeriod','summaryStats']){
  vm.runInContext(sourceFunction(html,name),context);
}
vm.runInContext(sourceFunction(ui,'coachingNeedsRecord'),context);
const local=(year,month,day,hour=0,minute=0,second=0,ms=0)=>new Date(year,month-1,day,hour,minute,second,ms);
const rule={id:'sales',title:'Sales',coachLookbackWeeks:2,coaching:{mode:'descriptionContains',descriptionPhrases:['save the sale']}};
const rep={repKey:'representative',repName:'Representative',coach:'Current Coach',team:'Current Team'};
const row=(id,date,overrides={})=>({id,date,key:rep.repKey,repKey:rep.repKey,coach:'Former Coach',type:'Other Topic',desc:'Discussed SAVE THE SALE with the representative.',...overrides});

assert.equal(context.normalizeCoachLookbackWeeks(''),2);
assert.equal(context.normalizeCoachLookbackWeeks('invalid'),2);
for(const weeks of [1,2,3,52])assert.equal(context.normalizeCoachLookbackWeeks(String(weeks)),weeks);
delete els.globalCoachLookback;state.coachLookbackWeeks=3;
assert.equal(context.currentCoachLookbackWeeks(),3,'saved weeks are used when the control is unavailable');
els.globalCoachLookback={value:'2'};state.coachLookbackWeeks=2;
context.loadCoachLookbackWeeks();assert.equal(els.globalCoachLookback.value,'2','a new workspace starts at two weeks');
els.globalCoachLookback.value='3';context.saveCoachLookbackWeeks();
els.globalCoachLookback.value='1';state.coachLookbackWeeks=1;context.loadCoachLookbackWeeks();
assert.equal(els.globalCoachLookback.value,'3','the shared weeks survive reopening');
assert.equal(state.coachLookbackWeeks,3);els.globalCoachLookback.value='2';state.coachLookbackWeeks=2;

for(const reportDate of [local(2026,10,27),local(2026,11,3)]){
  const original=reportDate.getTime(),range=context.coachingDateRange(reportDate,2);
  assert.equal(reportDate.getTime(),original,'building a range must not mutate the selected date');
  assert.equal(range.start.getHours(),0);assert.equal(range.start.getMinutes(),0);
  assert.equal(range.end.getHours(),23);assert.equal(range.end.getMinutes(),59);assert.equal(range.end.getSeconds(),59);assert.equal(range.end.getMilliseconds(),999);
  const expectedStart=new Date(reportDate);expectedStart.setDate(expectedStart.getDate()-14);
  assert.equal(range.start.getTime(),expectedStart.getTime(),'weeks use calendar days across daylight saving');
  const nextDay=new Date(reportDate);nextDay.setDate(nextDay.getDate()+1);
  const entries=[row('midnight',new Date(reportDate)),row('late',new Date(range.end)),row('boundary',new Date(range.start)),row('older',new Date(range.start.getTime()-1)),row('future',nextDay),row('unrelated',new Date(reportDate),{desc:'An unrelated coaching topic',type:'save the sale',raw:{Other:'save the sale'}})];
  byRep.set(rep.repKey,entries.slice().sort((a,b)=>b.date-a.date));
  const match=context.coachMatch(rep,rule,reportDate,2);
  assert.equal(match.recentCount,3,'midnight, later the same day and the inclusive lower boundary all count');
  assert.equal(match.isCoached,true);
  assert.equal(match.recentMatched.some(item=>item.id==='future'),false,'tomorrow is excluded');
  assert.equal(match.recentMatched.some(item=>item.id==='older'),false,'older than the selected weeks is excluded');
  assert.equal(match.matched.some(item=>item.id==='unrelated'),false,'Description keywords cannot be satisfied by type or unrelated fields');
  assert.equal(match.recentMatched.some(item=>item.coach==='Former Coach'),true,'a changed coach assignment cannot invalidate the representative coaching');
  assert.equal(context.matchingCoachingRowsForRule(rep.repKey,rule,reportDate).some(item=>item.id==='late'),true,'performance-linked matching keeps report-day coaching');
  const summary=context.coachingSummaryFromRows(rep.repKey,entries.filter(item=>item.id!=='unrelated'),reportDate,2);
  assert.equal(summary.recentCount,3,'precomputed corrective summaries use the same full-day window');
  assert.equal(summary.matched.some(item=>item.id==='future'),false,'precomputed summaries cannot expose future evidence');
  const need=context.coachingNeedsRecord(rep,rule,reportDate,match);
  assert.equal(need.recent,true);assert.equal(need.lookbackDays,14);
  assert.equal(need.latestTopicCoaching.getTime(),range.end.getTime(),'coaching-needs exports retain the latest matching coaching on the report date');
  assert.equal(workflow.coachingNeedsRows([need],reportDate).length,0,'a normal concern with matching coaching today is not exported as uncoached');
}

// The imported event date has precedence, including fractional Excel dates and Date objects.
const serial=46322+((23*60+45)*60+30)/86400; // 2026-10-27 23:45:30 in Excel's calendar.
const serialMidnight=context.parseDate(46322);
assert.equal(serialMidnight.getDate(),27,'a date-only Excel number retains its calendar date west of UTC');
assert.equal(serialMidnight.getHours(),0);
for(const raw of ['2026-10-27T23:45:30',local(2026,10,27,23,45,30),serial]){
  const selected=insights.selectDocumentedCoachingDate({'Coaching Date':raw,'Created On':'2020-01-01'},context.parseDate);
  assert.equal(selected.source,'Coaching Date');
  assert.equal(selected.date.getFullYear(),2026);assert.equal(selected.date.getMonth(),9);assert.equal(selected.date.getDate(),27);
  assert.equal(selected.date.getHours(),23);assert.equal(selected.date.getMinutes(),45);assert.equal(selected.date.getSeconds(),30);
  byRep.set(rep.repKey,[row('imported',selected.date)]);
  assert.equal(context.coachMatch(rep,rule,local(2026,10,27),2).isCoached,true,'all supported import date representations count on their report day');
}

// The visible shared setting wins over the obsolete per-rule value everywhere it is displayed.
const twentyDaysAgo=local(2026,10,7,12),reportDate=local(2026,10,27);
byRep.set(rep.repKey,[row('20-days',twentyDaysAgo)]);
vm.runInContext(sourceFunction(html,'renderRuleNamePreview'),context);
Object.assign(context,{
  readRuleForm:()=>rule,renderCoachingTypeOptions(){},renderCountRuleChips(){},updateRuleTypeVisibility(){},isCoreDataRule:()=>false,isHeaderCountRule:()=>true,
  previewSourceRowsForRule:()=>[{name:'Sales.csv',rows:[{}]}],buildHeaderCountRecords:()=>({records:[{...rep,count:1,sources:new Set(['Sales.csv'])}],countHeader:'Agent Name',threshold:1,countedRows:1,scanned:1}),
  checklistMatch:()=>({count:0}),coachingPreviewHtml:match=>match.isCoached?'COACHED_TRUE':'COACHED_FALSE',esc:value=>String(value??''),knownRepUniverse:()=>new Set([rep.repKey])
});
for(const weeks of [1,3]){
  els.globalCoachLookback.value=String(weeks);
  assert.equal(context.currentCoachLookbackWeeks(),weeks);
  assert.equal(context.urgencyCoachingLookbackWeeks(rule,weeks),weeks,'urgency uses the shared weeks instead of a legacy per-rule override');
  const period=context.urgencyCoachingPeriod(rule,reportDate,weeks);
  assert.equal(period.end.getTime(),context.coachingDateRange(reportDate,weeks).end.getTime());
  const match=context.coachMatch(rep,rule,reportDate,context.currentCoachLookbackWeeks()),need=context.coachingNeedsRecord(rep,rule,reportDate,match);
  assert.equal(need.lookbackDays,weeks*7);assert.equal(need.recent,weeks===3);
  context.renderRuleNamePreview();
  assert.ok(els.ruleNamePreview.innerHTML.includes(weeks===3?'COACHED_TRUE':'COACHED_FALSE'),'the rule preview follows the visible shared setting');
}

// Corrective qualification settings do not narrow the shared coaching coverage window.
els.globalCoachLookback.value='3';
const correctiveRule={id:'corrective',title:'Sales corrective',ruleType:'coachingCorrective',coachLookbackWeeks:2,coaching:{mode:'none'},coachingCorrective:{coachingTopic:'Sales',coachingMatch:'equals',coachingLookbackWeeks:1,minCoachingCount:5,requireChecklist:true,buildUp:{enabled:true,weeks:10}}};
const oldMatching=row('corrective-match',twentyDaysAgo,{type:'Sales',typeParts:['Quality','Sales'],desc:'Discussed follow-up',searchText:'Quality | Sales | Discussed follow-up'});
const unrelatedToday=row('corrective-other',local(2026,10,27,16),{type:'Quality',typeParts:['Quality'],desc:'An unrelated coaching',searchText:'Quality | An unrelated coaching'});
byRep.set(rep.repKey,[unrelatedToday,oldMatching]);
const correctiveMatch=context.coachMatch(rep,correctiveRule,reportDate,context.currentCoachLookbackWeeks());
assert.equal(correctiveMatch.recentCount,1,'matching coverage survives a narrower qualification window, minimum count, checklist and build-up filters');
assert.equal(correctiveMatch.latestMatch.id,'corrective-match','an unrelated corrective coaching cannot count through the generic mode none');
const correctiveNeed=context.coachingNeedsRecord(rep,correctiveRule,reportDate);
assert.equal(correctiveNeed.recent,true);assert.equal(correctiveNeed.lookbackDays,21);
assert.equal(correctiveNeed.latestTopicCoaching.getTime(),twentyDaysAgo.getTime(),'individual coaching needs use the corrective rule topic');
byRep.set(rep.repKey,[unrelatedToday]);
assert.equal(context.coachMatch(rep,correctiveRule,reportDate,3).isCoached,false,'unrelated recent coaching does not satisfy a corrective topic');
assert.equal(context.coachingNeedsRecord(rep,correctiveRule,reportDate).recent,false);
const containsRule={...correctiveRule,coachingCorrective:{...correctiveRule.coachingCorrective,coachingTopic:'payment options',coachingMatch:'contains'}};
byRep.set(rep.repKey,[row('corrective-contains',local(2026,10,27,23,59),{type:'Sales Follow-up',searchText:'Sales Follow-up | Discussed PAYMENT OPTIONS and next steps'})]);
assert.equal(context.coachMatch(rep,containsRule,reportDate,3).isCoached,true,'configured contains matching still counts report-day topic evidence');
assert.equal(context.coachMatch(rep,{...containsRule,coachingCorrective:{...containsRule.coachingCorrective,coachingMatch:'equals'}},reportDate,3).isCoached,false,'equals requires the configured coaching type rather than a substring elsewhere');

// Reproduce the reported shape: 5% at midnight plus 46% coached later that day.
els.globalCoachLookback.value='2';
const reportRows=[];
for(let index=0;index<100;index++){
  const person={repKey:`person-${index}`,repName:`Person ${index}`};
  byRep.set(person.repKey,index<51?[row(String(index),local(2026,10,27,index<5?0:16))]:[]);
  reportRows.push({...person,coached:context.coachMatch(person,rule,reportDate,2)});
}
context.assignedRepSetForReportRows=rows=>new Set(rows.map(item=>item.repKey));
assert.equal(context.summaryStats(reportRows,reportDate).coachedPct,.51,'the report shows all 51% on the same day');
const tomorrow=local(2026,10,28),nextDayRows=reportRows.map(person=>({...person,coached:context.coachMatch(person,rule,tomorrow,2)}));
assert.equal(context.summaryStats(nextDayRows,tomorrow).coachedPct,.51,'waiting a day adds no delayed same-day coachings');
console.log(`PASS Qualtrics coaching window (${process.env.TZ}): full report day, calendar/DST bounds, Excel/date imports, keyword scoping, shared weeks, preview, urgency, exports and 5%-to-51% reproduction`);
