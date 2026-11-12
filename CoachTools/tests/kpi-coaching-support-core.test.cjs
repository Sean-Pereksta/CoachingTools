'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../shared/kpi-coaching-support-core.js');
const row=(date,apps,opps=100,rep='Alex Reed')=>({rep,date,apps,opps});
const event=(date,types=['Appointments'],rep='Alex Reed')=>({rep,date,types,desc:'Review next steps',coach:'Coach Alpha'});
const person=options=>core.analyze(options).people[0];
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-10,actual+' != '+expected);

test('latest current value and weighted window trend are distinct and use Sunday weeks',()=>{
  const result=core.analyze({rows:[row('2026-10-04',1,10),row('2026-10-11',81,90),row('2026-10-18',4,10),row('2026-10-25',24,30)],goal:.9});
  const p=result.people[0];
  assert.equal(p.currentRate,.8);close(p.windowRate,110/140);close(p.trendDelta,.7-.82);
  assert.equal(p.trendLabel,'Declining');assert.equal(p.needLevel,'high');close(p.needGap,.1);
  assert.equal(result.windowStart,'2026-10-04');assert.equal(result.asOf,'2026-10-31');
  assert.equal(p.series[0].date,'2026-10-04');assert.equal(p.series[0].label,'Oct 4–10');
});

test('support response excludes coaching week and weights all before/after opportunities',()=>{
  const p=person({rows:[row('2026-10-04',10),row('2026-10-11',20),row('2026-10-18',100),row('2026-10-25',50),row('2026-11-01',30,50)],coachings:[event('2026-10-20')],topic:'Appointments',goal:.75});
  assert.equal(p.category,'growing');close(p.preRate,.15);close(p.postRate,80/150);close(p.responseDelta,80/150-.15);
  assert.deepEqual(p.responseSample,{beforeWeeks:2,afterWeeks:2});
  assert.equal(p.latestCoaching.date,'2026-10-20');assert.equal(p.coachingCount,1);
});

test('the latest support controls follow-up classification without reusing an older response',()=>{
  const p=person({rows:[row('2026-10-04',20),row('2026-10-11',30),row('2026-10-18',40)],coachings:[event('2026-10-11'),event('2026-10-20')],topic:'Appointments',goal:.5});
  assert.equal(p.category,'follow-up');assert.equal(p.responseDelta,null);assert.equal(p.responseSample.afterWeeks,0);
  assert.equal(p.latestCoaching.date,'2026-10-20');
});

test('selected topic matching is exact and case insensitive, with equivalent representative names',()=>{
  const p=person({rows:[row('2026-10-04',20),row('2026-10-11',20),row('2026-10-18',20)],coachings:[event('2026-10-12',['APPOINTMENTS'],'Reed, Alex'),event('2026-10-13',['Appointments Follow-up'])],topic:' appointments ',goal:.5});
  assert.equal(p.category,'stagnant');assert.equal(p.coachingCount,1);assert.equal(p.latestCoaching.rep,'Reed, Alex');
  assert.equal(p.responseDelta,0);
});

test('coaching type filters the actual type field independently of selected coaching topic',()=>{
  const options={rows:[row('2026-10-04',20),row('2026-10-11',20),row('2026-10-18',20),row('2026-10-25',30)],coachings:[
    {...event('2026-10-12',['Consumer AR','Side by side']),topics:['Consumer AR'],coachingType:'Side by side'},
    {...event('2026-10-20',['Consumer AR','Observation']),topics:['Consumer AR'],coachingType:'Observation'}
  ],topic:'consumer ar',coachingType:'SIDE BY SIDE',goal:.5};
  const result=core.analyze(options),p=result.people[0];assert.equal(p.coachingCount,1);assert.equal(p.latestCoaching.date,'2026-10-12');
  assert.equal(p.latestCoaching.coachingType,'Side by side');assert.equal(p.topicEvents.length,2);
  assert.deepEqual(result.coachingTypes,['Observation','Side by side']);assert.deepEqual(result.topics,['Consumer AR']);
  assert.equal(person({...options,coachingType:'Consumer AR'}).coachingCount,0,'Topic names are not guessed as coaching types.');
});

test('uncoached people keep distinct need levels and an on-track category',()=>{
  const rows=[row('2026-10-04',35,100,'High'),row('2026-10-04',44,100,'Moderate'),row('2026-10-04',49,100,'Low'),row('2026-10-04',50,100,'At goal')];
  const result=core.analyze({rows,goal:.5});
  assert.deepEqual(Object.fromEntries(result.people.map(p=>[p.rep,p.needLevel])),{High:'high',Moderate:'moderate',Low:'low','At goal':'at-goal'});
  assert.equal(result.counts['needs-support'],3);assert.equal(result.counts['on-track'],1);
  assert.equal(result.people.find(p=>p.rep==='At goal').category,'on-track');
});

test('supported people maintaining goal are on track rather than stagnant, while growth and pending evidence stay distinct',()=>{
  const options={rows:[row('2026-10-04',50),row('2026-10-11',50),row('2026-10-18',50)],coachings:[event('2026-10-12')],topic:'Appointments',goal:.5};
  const p=person(options);assert.equal(p.category,'on-track');assert.equal(p.responseDelta,0);assert.equal(p.needGap,0);assert.match(p.categoryReason,/maintaining performance after coaching/);
  assert.equal(person({...options,rows:[row('2026-10-04',40),row('2026-10-11',50),row('2026-10-18',60)]}).category,'growing');
  assert.equal(person({...options,coachings:[event('2026-10-20')]}).category,'follow-up');
});

test('missing counts and zero opportunities do not become zero-rate performance',()=>{
  const result=core.analyze({rows:[row('2026-10-04',20),row('2026-10-11',0,0),row('2026-10-18','',100),row('2026-10-18',null,100,'Missing')],goal:.5});
  const p=result.people.find(p=>p.rep==='Alex Reed');assert.equal(p.currentRate,.2);assert.equal(p.currentDate,'2026-10-04');assert.equal(p.totalMeasuredWeeks,1);assert.equal(p.trendDelta,null);
  assert.equal(result.people.find(p=>p.rep==='Missing').category,'insufficient');
  assert.deepEqual(core.analyze({rows:[],goal:.5}).people,[]);
});

test('coaching evidence is bounded to the selected data window, excluding future and old support',()=>{
  const p=person({rows:[row('2026-10-04',20),row('2026-10-11',20)],coachings:[event('2026-09-30'),event('2026-10-18')],topic:'Appointments',goal:.5});
  assert.equal(p.coachingCount,0);assert.equal(p.category,'needs-support');
});

test('selected corrective events do not masquerade as support and escalation requires the same topic',()=>{
  const p=person({rows:[row('2026-10-04',20),row('2026-10-11',20),row('2026-10-18',20),row('2026-10-25',20)],coachings:[event('2026-10-12'),event('2026-10-20',['Appointments','Written warning']),event('2026-10-24',['Wipers','Written warning'])],topic:'Appointments',correctiveType:'written WARNING',goal:.5});
  assert.equal(p.coachingCount,1);assert.equal(p.latestCoaching.date,'2026-10-12');assert.equal(p.correctiveEvents.length,2);assert.equal(p.topicEvents.length,2);
  assert.equal(p.latestCorrective.date,'2026-10-24');assert.equal(p.latestCorrectiveTopicMatch,false);assert.equal(p.correctiveAfterSupport,true);assert.equal(p.category,'stagnant');
  const only=person({rows:[row('2026-10-04',20),row('2026-10-11',20)],coachings:[event('2026-10-12',['Appointments','Written warning'])],topic:'Appointments',correctiveType:'Written warning',goal:.5});
  assert.equal(only.category,'needs-support');assert.equal(only.coachingCount,0);assert.equal(only.correctiveAfterSupport,false);
});

test('a corrective from before the latest support or another topic is not escalation after support',()=>{
  const options={rows:[row('2026-10-04',20),row('2026-10-11',20),row('2026-10-18',20)],coachings:[event('2026-10-10',['Appointments','Corrective']),event('2026-10-12'),event('2026-10-13',['Wipers','Corrective'])],topic:'Appointments',correctiveType:'Corrective',goal:.5};
  assert.equal(person(options).correctiveAfterSupport,false);
});

test('checklist corrective type and incident are independent of coaching-topic vocabulary',()=>{
  const p=person({rows:[row('2026-10-04',20),row('2026-10-11',20),row('2026-10-18',20)],coachings:[event('2026-10-12')],
    correctives:[{rep:'Reed, Alex',createdDate:'2026-10-14',servedDate:'2026-10-16',correctiveType:'Written warning',incident:'Conversion opportunity',desc:'Review action',status:'Action Taken'}],
    topic:'Appointments',correctiveType:'written WARNING',correctiveIncident:'Conversion opportunity',goal:.5});
  assert.equal(p.category,'stagnant');assert.equal(p.correctiveAfterSupport,true);
  assert.equal(p.latestCorrective.date,'2026-10-16');assert.equal(p.latestCorrective.source,'checklist');assert.equal(p.latestCorrective.completion,'Served');assert.equal(p.latestCorrective.incident,'Conversion opportunity');
  assert.equal(p.correctiveOpenCount,0);assert.equal(p.correctiveServedCount,1);
});

test('future-served correctives remain open as of the data window rather than becoming future evidence',()=>{
  const p=person({rows:[row('2026-10-04',20),row('2026-10-11',20)],coachings:[event('2026-10-06')],
    correctives:[{rep:'Alex Reed',createdDate:'2026-10-08',servedDate:'2026-10-20',correctiveType:'Written warning',status:'Action Taken'}],topic:'Appointments',correctiveType:'Written warning',goal:.5});
  assert.equal(p.latestCorrective.date,'2026-10-08');assert.equal(p.latestCorrective.servedDate,'2026-10-20');
  assert.equal(p.latestCorrective.completion,'Open');assert.equal(p.latestCorrective.actionStatus,'Action Taken');assert.equal(p.correctiveOpenCount,1);assert.equal(p.correctiveAfterSupport,true);
});

test('checklist records respect effective dates, type and incident selectors',()=>{
  const options={rows:[row('2026-10-04',20),row('2026-10-11',20)],correctives:[
    {rep:'Alex Reed',createdDate:'2026-10-18',correctiveType:'Warning',incident:'A'},
    {rep:'Alex Reed',createdDate:'2026-09-30',correctiveType:'Warning',incident:'A'},
    {rep:'Alex Reed',createdDate:'2026-10-05',correctiveType:'Warning',incident:'B'},
    {rep:'Alex Reed',createdDate:'2026-10-05',correctiveType:'Suspension',incident:'A'},
    {rep:'Alex Reed',createdDate:'2026-09-30',servedDate:'2026-10-07',correctiveType:'Warning',incident:'A'}
  ],correctiveType:'Warning',correctiveIncident:'a',goal:.5};
  const p=person(options);assert.equal(p.correctiveEvents.length,1);assert.equal(p.latestCorrective.date,'2026-10-07');assert.equal(p.latestCorrective.completion,'Served');
  assert.equal(person({...options,correctiveType:null}).correctiveEvents.length,0);
});

test('growth threshold is configurable and absent goal stays unknown rather than reporting a goal miss',()=>{
  const options={rows:[row('2026-10-04',20),row('2026-10-11',20),row('2026-10-18',21)],coachings:[event('2026-10-12')],topic:'Appointments',goal:null};
  const p=person(options);assert.equal(p.category,'growing');assert.equal(p.needGap,null);assert.equal(p.needLevel,'unknown');
  assert.equal(person({...options,growthThresholdPp:2}).category,'stagnant');
  assert.equal(person({...options,goal:0}).needLevel,'at-goal');
});

test('invalid dates are ignored and caller data is not mutated',()=>{
  const input={rows:[row('2026-02-30',30),row('2026-10-04',20)],coachings:[event('bad date')],goal:.5};
  const snapshot=JSON.stringify(input),result=core.analyze(input);
  assert.equal(result.people.length,1);assert.equal(result.windowStart,'2026-10-04');assert.equal(JSON.stringify(input),snapshot);
});

test('browser global exposes the same analysis API',()=>{
  const browser={};vm.runInNewContext(fs.readFileSync(require.resolve('../shared/kpi-coaching-support-core.js'),'utf8'),browser);
  assert.equal(typeof browser.KpiCoachingSupportCore.analyze,'function');
  assert.equal(browser.KpiCoachingSupportCore.analyze({rows:[row('2026-10-04',20)],goal:.5}).people[0].category,'needs-support');
});
