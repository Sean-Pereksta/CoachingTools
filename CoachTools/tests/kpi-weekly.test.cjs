'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const core = require('../shared/kpi-weekly-core.js');

const sunday = new Date(2026,10,15);
const start = core.weekStart(sunday);
function local(weeks, day=0){ return new Date(2026,10,15+7*weeks+day); }
function row(name, weeks, results, volume){ return {key:name,name,date:local(weeks),results,volume}; }
function event(name,weeks,desc){ return {key:name,rep:name,date:local(weeks,2),desc,type:'1:1 Coaching'}; }
const closeTo = (actual,expected) => assert.ok(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);

test('compares Sunday–Saturday across a month boundary and refuses to skip a missing prior calendar week',()=>{
  assert.equal(core.weekStart(local(0,6)),start);
  assert.equal(core.weekStart(local(0,7)),start+core.week);
  const index = core.index([row('A',0,30,60), row('A',-2,20,100),row('A',1,90,100)],start+core.week);
  assert.equal(index.size,2);
  assert.ok(Number.isNaN(core.compare(index,start,5,.47).delta));
  assert.equal(core.compare(index,start,5,.47).priorGap,null);
});

test('uses opportunity-weighted baselines, exact 10-point boundaries and zero-volume exclusion',()=>{
  const index = core.index([
    row('In line',0,58,100),row('In line',-1,5,10),row('In line',-2,50,100),row('In line',-3,0,0),
    row('Over',0,60,100),row('Over',-1,50,100), row('Under',0,40,100),row('Under',-1,50,100)
  ],start+core.week);
  const report = core.compare(index,start,5,.47);
  assert.deepEqual(report.rows.map(rep=>rep.classification),['In-line performance','Overperformed','Underperformed']);
  assert.equal(report.rows[0].normWeeks,2);
  assert.deepEqual(report.rows[0].priorGap,{target:50,count:8});
  assert.deepEqual(report.rows[0].goalGap,{target:47,count:11});
});

test('rep contributions reconcile with the team change even when reps enter and exit',()=>{
  const index = core.index([row('Stayed',0,30,50),row('Stayed',-1,30,100),row('Left',-1,10,100),row('Joined',0,75,150)],start+core.week);
  const report = core.compare(index,start,4,.47);
  closeTo(report.rows.reduce((sum,rep)=>sum+rep.contribution,0),report.delta);
  closeTo(report.performance+report.mix,report.delta);
  assert.equal(report.rows.find(rep=>rep.key==='Joined').performance,0);
  assert.equal(report.drivers[0].name,'Left');
  assert.deepEqual(report.goalGap,{target:94,count:11});
  assert.deepEqual(report.priorGap,{target:40,count:65});
});

test('matches Quick Focus terms and weights complete, paired before/after windows by measured volume',()=>{
  const index = core.index([
    row('A',-3,10,100),row('A',-2,40,100),row('A',-1,0,0),row('A',0,0,100),row('A',1,80,100),row('A',3,40,100),
    row('B',-1,5,10),row('B',2,3,10),row('B',3,0,0),row('C',3,5,10)
  ],start+4*core.week);
  const events = [event('A',0,'Appt Rate'),event('A',0,'Appt Rate refresher'),event('B',0,'Appt Rate'),event('B',-1,'Wiper review'),event('A',1,'Appt Rate late'),event('C',0,'Appt Rate')];
  assert.deepEqual(core.coachingCounts(events,'consumer',start),{current:4,previous:0});
  const report = core.coachingOutcome(index,events,'consumer',start+3*core.week,6);
  assert.equal(report.coachingCount,3);
  assert.equal(report.cases.length,2);
  assert.equal(report.pending,1);
  assert.equal(report.insufficient,1);
  closeTo(report.delta,(.35*200-.20*10)/210);
  assert.equal(report.reps[0].name,'A');
  assert.equal(report.reps[0].cases[0].events.length,2);
  assert.deepEqual(core.coachingCounts([{...event('A',0,''),types:['Call Quality']}],'callQuality',start),{current:1,previous:0});
});
