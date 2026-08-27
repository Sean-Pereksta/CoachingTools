#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const insights=require('../qualtrics/insights.js');

assert.equal(insights.formatDisplayValue('Cash Scheduled %',0.436,{format:'auto',precision:1}),'43.6%');
assert.equal(insights.formatDisplayValue('Conversion Rate','43.6%',{format:'auto',precision:1}),'43.6%');
assert.equal(insights.formatDisplayValue('Custom Value','42',{format:'auto',precision:1}),'42');
assert.equal(insights.formatDisplayValue('Cases',1234.4,{format:'count'}),'1,234');
assert.equal(insights.formatDisplayValue('Revenue',1234.5,{format:'currency',precision:2}),'$1,234.50');
assert.equal(insights.formatDisplayValue('AHT Seconds',724,{format:'duration'}),'12:04');
assert.equal(insights.formatDisplayText('Afterpay Scheduling %',.25,{format:'percentage',precision:0,template:'{value} scheduling when providing Afterpay'}),'25% scheduling when providing Afterpay');
assert.equal(insights.formatDisplayText('Call Quality',.78,{format:'percentage',precision:0,template:'QA: {value}'}),'QA: 78%');
assert.equal(insights.formatDisplayText('Save the Sale Usage',.42,{format:'percentage',precision:0,template:''}),'42%');

const oldHistory=insights.classifyCorrective({historyCount:1,currentPoor:false,severity:.2});
assert.equal(oldHistory.state,'plain');
assert.deepEqual(oldHistory.tags,[]);
const improving=insights.classifyCorrective({historyCount:1,currentPoor:true,severity:.55,improving:true});
assert.equal(improving.state,'improving');
assert.deepEqual(improving.tags,['Prior Corrective — Improving']);
const critical=insights.classifyCorrective({historyCount:2,recentCount:1,currentPoor:true,severity:.9,persistent:true,hasRecentCoaching:true});
assert.equal(critical.state,'critical');
assert.deepEqual(critical.tags,['Repeat Corrective History + Current Need','Coaching Not Sticking']);

const concentrated=insights.scoreOpportunity({severity:.95,breadth:.1,affected:2});
assert.ok(concentrated.score>=80,'Severe concentrated needs must remain high urgency.');
assert.equal(concentrated.pattern.label,'High / Concentrated');
assert.equal(insights.concentration({affectedOrganizations:5,totalOrganizations:6,affectedTeams:9,totalTeams:12,affectedPeople:30,totalPeople:100}).label,'Organization-wide');
assert.equal(insights.trendLabel({observations:8,improving:.7,worsening:.2}),'Improving');
assert.equal(insights.evidenceConfidence({people:1,observations:2,weeks:2}),'Limited sample');

const occurrenceA=insights.concernOccurrenceKey({repKey:'EMP-42',ruleId:'save-sale',runId:'2026-08'});
const occurrenceDuplicate=insights.concernOccurrenceKey({repKey:' emp-42 ',ruleId:'SAVE-SALE',reportPeriod:'2026-08'});
const occurrenceNext=insights.concernOccurrenceKey({repKey:'EMP-42',ruleId:'save-sale',runId:'2026-09'});
assert.equal(occurrenceA,occurrenceDuplicate,'The same representative/rule/run must have one deterministic occurrence key.');
assert.notEqual(occurrenceA,occurrenceNext,'A different run/report period must create a new occurrence.');
const concernSummary=insights.summarizeConcernHistory([
  {repKey:'EMP-42',ruleId:'save-sale',runId:'2026-08'},
  {repKey:'emp-42',ruleId:'SAVE-SALE',runId:'2026-08'},
  {repKey:'EMP-42',ruleId:'save-sale',runId:'2026-09'}
]);
assert.equal(concernSummary.occurrences.size,2,'Duplicate report regeneration/import must not inflate appearance history.');
assert.equal(concernSummary.byRepRule.get('emp-42\u001fsave-sale'),2);
const nameSummary=insights.summarizeConcernNameCounts([
  {Representative:'Jordan Smith'},
  {Representative:' jordan  smith '},
  {'Agent Name':'Jordan Smith — jordan.smith@example.com'},
  {Representative:'Avery Jones'}
]);
assert.equal(nameSummary.counts.get('jordan smith'),3,'Concern history must count every matching name row regardless of rule or period.');
assert.equal(nameSummary.labels.get('jordan smith'),'Jordan Smith');
assert.equal(nameSummary.counts.get('avery jones'),1);
assert.equal(nameSummary.total,4);
assert.equal(nameSummary.uniqueNames,2);
assert.deepEqual(insights.classifyConcernHistory({appearances:1,relatedCoachingLast21:0}),{key:'new',label:'New'});
assert.deepEqual(insights.classifyConcernHistory({appearances:2,relatedCoachingLast21:0}),{key:'undercoached',label:'Undercoached'});
assert.deepEqual(insights.classifyConcernHistory({appearances:3,relatedCoachingLast21:1}),{key:'undercoached',label:'Undercoached'});
assert.deepEqual(insights.classifyConcernHistory({appearances:3,relatedCoachingLast21:3}),{key:'review-option',label:'Review Option'});
assert.deepEqual(insights.classifyConcernHistory({appearances:2,relatedCoachingLast21:2}),{key:'monitor',label:'Monitor'});

console.log('PASS Qualtrics insights tests');
