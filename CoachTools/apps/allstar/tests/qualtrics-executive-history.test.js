#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {buildExecutiveHistoryReview}=require('../qualtrics/insights.js');

if(!process.argv.includes('--timezone-case')){
  for(const timezone of ['UTC','America/New_York']){
    const result=spawnSync(process.execPath,[__filename,'--timezone-case'],{encoding:'utf8',env:{...process.env,TZ:timezone}});
    assert.equal(result.status,0,`${timezone}\n${result.stdout}\n${result.stderr}`);
    process.stdout.write(result.stdout);
  }
  process.exit(0);
}

const local=(year,month,day,hour=0,minute=0)=>new Date(year,month-1,day,hour,minute);
const rules=[{id:'assumptive',title:'Assumptive language'},{id:'options',title:'Offer options'}];
const history=[];
function add(rep,rule,count,coach,dates){
  for(let index=0;index<count;index++)history.push({repKey:rep,repName:rep.toUpperCase(),ruleId:rule,ruleTitle:rule,coach,team:`${coach} Team`,runId:`${rep}-${rule}-${index}`,reportDate:dates?.[index]||`2026-10-${String(index+1).padStart(2,'0')}`});
}
add('alex','assumptive',4,'Old Coach');add('alex','options',3,'Old Coach');
add('blair','assumptive',3,'Zeta');add('casey','options',3,'Zeta');
add('devon','assumptive',3,'Alpha');add('ellis','options',3,'Alpha');
add('fran','assumptive',2,'Alpha'); // Exactly the threshold is excluded.
add('gina','assumptive',3,'Coverage');
const coaching={
  alex:[{id:'shared',date:local(2026,10,2),desc:'assumptive and options'}],
  blair:[],casey:[],devon:[],ellis:[],fran:[],
  gina:[{id:'g1',date:local(2026,10,4)},{id:'g2',date:local(2026,10,5)}]
};
const calls=[];
const opts={history,rules,reportDate:'2026-11-17',months:2,minAppearances:2,minCoachings:2,coachingAvailable:true,
  resolveRep:(rep,row)=>rep==='alex'?{repName:'Alex Current',coach:'Zeta',team:'Current Team'}:{},
  matchingCoachings:(rep,rule,range)=>{calls.push({rep,rule,range});return coaching[rep]||[];}};
const result=buildExecutiveHistoryReview(opts);
assert.equal(result.window.startDate,'2026-09-17');assert.equal(result.window.endDate,'2026-11-17');
assert.equal(result.window.weeks,62/7,'calendar-day weeks include both dates without daylight saving drift');
assert.equal(result.eligibleRecords.length,7);assert.equal(result.concernRecords.length,6);
assert.equal(result.summary.eligibleRepCount,6);assert.equal(result.summary.concernRepCount,5);
assert.equal(result.summary.coachedRepCount,2,'any matched coaching counts a coached history rep even below the coaching target');
assert.equal(result.summary.coachingContactCount,3,'one coaching matching two topics is still one contact');
assert.equal(result.summary.coachingTopicCount,4,'topic shares count a shared coaching once per matching topic');
assert.equal(result.summary.appearanceCount,22);assert.equal(result.summary.avgCoachingsPerWeek,3/(62/7));
assert.equal(result.summary.coachingsPerAppearance,3/22);
assert.deepEqual(result.coaches.map(item=>[item.rank,item.coach,item.concernRepCount]),[[1,'Zeta',3],[2,'Alpha',2],[3,'Coverage',0]],'unique people set rank; current roster assignment wins');
assert.equal(result.coaches[0].records.length,4,'Alex appears on two topics while counting once in coach rank');
assert.equal(result.coaches[0].eligibleRecords[0].repName,'Alex Current');
assert.deepEqual(result.coaches[0].missingTopicShares.map(item=>[item.ruleId,item.count,item.share]),[['assumptive',2,.5],['options',2,.5]]);
assert.deepEqual(result.summary.coachedTopicShares.map(item=>[item.ruleId,item.count,item.share]),[['assumptive',3,.75],['options',1,.25]]);
assert.equal(calls.length,7,'coaching matcher sees high-history topics only');
assert.ok(calls.every(call=>call.range.start===result.window.start));
assert.deepEqual(result.diagnostics.warnings,[]);

// Duplicate imports, future/old records, malformed dates, missing rule IDs, and
// cumulative name-only count columns cannot inflate topic appearances.
const dirty=[...history,history[0],{...history[0],appearanceCount:999},
  {repKey:'alex',ruleId:'assumptive',runId:'old',reportDate:'2026-09-16'},
  {repKey:'alex',ruleId:'assumptive',runId:'future',reportDate:'2026-11-18'},
  {repKey:'alex',ruleId:'assumptive',runId:'invalid',reportDate:'2026-02-30'},
  {repName:'Alex',Count:999},
  {repKey:'alex',reportDate:'2026-10-01'}];
const clean=buildExecutiveHistoryReview({...opts,history:dirty});
assert.equal(clean.summary.appearanceCount,22);assert.equal(clean.diagnostics.duplicateHistoryRows,2);
assert.equal(clean.diagnostics.outsideWindowRows,2);assert.equal(clean.diagnostics.invalidHistoryRows,3);
assert.match(clean.diagnostics.warnings.join(' '),/Name-only totals/);

// Full-day boundaries and a month ending on the 31st use a clamped calendar
// subtraction, including leap years. Duplicated contacts do not lower concern.
for(const [reportDate,months,startDate] of [['2026-03-31',1,'2026-02-28'],['2024-03-31',1,'2024-02-29'],['2026-11-30',9,'2026-02-28']]){
  const review=buildExecutiveHistoryReview({...opts,reportDate,months,history:[]});
  assert.equal(review.window.startDate,startDate);assert.equal(review.window.start.getHours(),0);
  assert.equal(review.window.end.getHours(),23);assert.equal(review.window.end.getMilliseconds(),999);
}
const boundaries=buildExecutiveHistoryReview({...opts,reportDate:'2026-11-03',months:1,minAppearances:0,minCoachings:3,
  history:[{repKey:'rep',repName:'Rep',ruleId:'assumptive',reportDate:'2026-10-03'},
    {repKey:'rep',repName:'Rep',ruleId:'assumptive',reportDate:'2026-11-03'}],
  matchingCoachings:()=>[{id:'start',date:local(2026,10,3)},
    {id:'end',date:local(2026,11,3,23,59)},{id:'end',date:local(2026,11,3,23,59)},
    {id:'old',date:new Date(local(2026,10,3).getTime()-1)},
    {id:'future',date:local(2026,11,4)},
    {id:'bad',date:'2026-02-30'}]});
assert.equal(boundaries.eligibleRecords[0].appearanceCount,2);
assert.equal(boundaries.concernRecords[0].coachingCount,2);assert.equal(boundaries.concernRecords[0].missingCoachings,1);
assert.equal(boundaries.diagnostics.duplicateCoachingRows,1);assert.equal(boundaries.diagnostics.invalidCoachingRows,1);
assert.equal(boundaries.window.weeks,32/7);

// Unavailable evidence is unknown; a loaded empty coaching source proves zero.
const unavailable=buildExecutiveHistoryReview({...opts,coachingAvailable:false});
assert.equal(unavailable.concernRecords.length,0);assert.equal(unavailable.summary.coachedRepCount,null);
assert.equal(unavailable.summary.avgCoachingsPerWeek,null);assert.equal(unavailable.summary.coachingContactCount,null);
assert.ok(unavailable.eligibleRecords.every(record=>record.coachingCount===null&&record.undercoached===null));
assert.match(unavailable.diagnostics.warnings[0],/unavailable/);
const empty=buildExecutiveHistoryReview({...opts,matchingCoachings:()=>[]});
assert.equal(empty.summary.concernRepCount,6);assert.equal(empty.summary.coachedRepCount,0);
assert.equal(empty.summary.coachingContactCount,0);assert.deepEqual(empty.summary.coachedTopicShares,[]);
assert.equal(empty.summary.missingTopicShares.reduce((sum,topic)=>sum+topic.count,0),7);

// A missing saved rule cannot safely establish what documented coaching matches.
const missing=buildExecutiveHistoryReview({...opts,rules:[rules[0]]});
assert.equal(missing.diagnostics.missingRuleTopics,3);assert.equal(missing.eligibleRecords.length,4);
assert.match(missing.diagnostics.warnings.join(' '),/no current saved rule/);
const partiallyUnknown=buildExecutiveHistoryReview({...opts,matchingCoachings:(rep)=>rep==='alex'?null:[]});
assert.equal(partiallyUnknown.diagnostics.unknownCoachingTopics,2);
assert.equal(partiallyUnknown.summary.coachedRepCount,null);assert.equal(partiallyUnknown.concernRecords.length,5);
assert.ok(!partiallyUnknown.concernRecords.some(record=>record.repKey==='alex'));

// Equivalent source rows without explicit IDs are deduplicated by contact
// content/date, regardless of old coach labels or source object identity.
const fallbackContact={date:local(2026,10,5),type:'Conversation',desc:'Assumptive language'};
const fingerprints=buildExecutiveHistoryReview({...opts,matchingCoachings:()=>[fallbackContact,{...fallbackContact,coach:'Old Coach'}]});
assert.ok(fingerprints.eligibleRecords.every(record=>record.coachingCount===1));
assert.equal(fingerprints.summary.coachingContactCount,6);
assert.throws(()=>buildExecutiveHistoryReview({...opts,reportDate:'2026-02-30'}),/valid report date/);
assert.equal(buildExecutiveHistoryReview({...opts,months:'',minAppearances:'',minCoachings:''}).settings.months,3);
console.log(`PASS Executive history: thresholds, unique reps/runs/contacts, topic shares, calendar windows, missing evidence (${process.env.TZ})`);
