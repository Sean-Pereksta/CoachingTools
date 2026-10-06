'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseHTML } = require('linkedom');
require('../shared/coachtools-weekly-index.js');
require('../shared/performance-scorecard-periods.js');
const W = globalThis.CoachToolsWeeklyIndex, P = globalThis.CoachToolsScorecardPeriods;
const available = ['2026-10-03','2026-09-26','2026-09-19','2026-09-12','2026-09-05','2026-08-29','2026-08-22'];
const point = (week, num = 4, den = 10, type = 'weeklyRetail') => ({ week, sort: week, type, consumer: { num, den, value: num / den } });
function runtime(file = 'performance-scorecard.html', dom = false) {
  const html = fs.readFileSync(path.join(__dirname, '../apps', file), 'utf8');
  const names = ['clean','mean','resetCalcCache','availableReportingWeeks','mainWindowSpec','selectedWindow','windowCacheKey','selectedWindowLabel','pointInSelectedWindow','personPoints','qaReportingPeriod','qaRows','qaSeries','aggregateMetric','priorWindowSpec','trendFor','historyCoverage','coverage','metricPack','teamMetric','syncMainWindowUi','syncWeekComparison','installWeekPicker'];
  const code = names.map(name => html.split('\n').find(line => line.startsWith(`function ${name}(`))).join('\n');
  const controls = { departmentSel:{value:'Retail'}, weeksSummary:{}, weeksList:{}, weekComparison:{} };
  const parsed = dom ? parseHTML(html) : null;
  if (parsed) parsed.document.querySelector('#departmentSel option[value="Retail"]').selected = true;
  let renderCount = 0;
  const state = { weeklyByRep:new Map([['a',available.map(key => point(key))]]), reportingDates:new Map([['weeklyRetail', new Set(available)]]), byId:new Map(), calcCache:new Map(), cohortCache:new Map(), qaByRep:new Map(), config:{minWeeks:4,minCoverage:.5} };
  const get = id => parsed ? parsed.document.getElementById(id) : controls[id];
  const api = new Function('state','$','Periods','CoachToolsWeeklyIndex','personDepartment','goalDefinition','METRICS','percentile','document','render', `let scorecardWindowMemo=null;const reportingWeeksMemo=new Map(),qaPeriodMemo=new Map(),weekSelections=new Map();${code};return {${names.join(',')},weekSelections};`)(state,get,P,W,person=>person.department,()=>({direction:'higher'}),{'consumer-rate':{higher:true}},()=>50,parsed?.document,()=>renderCount++);
  const select = keys => { api.weekSelections.set(get('departmentSel').value,new Set(keys));api.resetCalcCache(); };
  return { api,state,controls,select,html,get,document:parsed?.document,window:parsed?.window,renderCount:()=>renderCount };
}
test('one week, consecutive dates, gaps, and moving reporting days use actual prior periods', () => {
  for (const [selected,prior] of [
    [[available[0]],[available[1]]],
    [available.slice(0,2),available.slice(2,4)],
    [[available[0],available[2]],available.slice(3,5)]
  ]) {
    const spec = P.spec(available,selected,'Retail');
    assert.deepEqual(spec.dates,selected);assert.deepEqual(spec.priorDates,prior);assert.equal(spec.weeks,selected.length);
  }
  const moved = P.spec(['2026-10-03','2026-09-27','2026-09-18'],['2026-10-03'],'Retail');
  assert.deepEqual(moved.priorDates,['2026-09-27']);
});
test('default uses latest eight available dates, and explicit choices survive data refresh', () => {
  const all = [...available,'2026-08-15','2026-08-08','2026-08-01'];
  assert.deepEqual(P.selection(all,null),all.slice(0,8));
  assert.deepEqual(P.selection(all,new Set([available[0],available[2],'2027-01-01'])),[available[0],available[2]]);
  assert.deepEqual(P.selection(all,new Set()),[]);
});
test('exact source dates stay separate, deduplicate by source/date and include unresolved dates in picker', () => {
  const build = records => W.build({preserveReportingDates:true,sources:[{type:'weeklyRetail',records}],extract:record=>[{rows:record.rows}],pick:(row,names)=>row[names.find(key=>row[key]!=null)],resolvePerson:({row})=>row.Representative==='A'?'a':'',metricFromRows:rows=>({consumer:{num:rows.reduce((n,r)=>n+r.num,0),den:10,value:rows.reduce((n,r)=>n+r.num,0)/10}})});
  const result = build([
    {id:'old',importedAt:'2026-10-04',rows:[{Representative:'A',Date:'10/03/2026',num:1},{Representative:'A',Date:'10/04/2026',num:3},{Representative:'Unknown',Date:'09/26/2026',num:5}]},
    {id:'new',importedAt:'2026-10-05',rows:[{Representative:'A',Date:'2026-10-03',num:8}]}
  ]);
  assert.deepEqual(result.byPerson.get('a').map(p=>p.week),['2026-10-03','2026-10-04']);
  assert.equal(result.byPerson.get('a')[0].consumer.num,8);
  assert.deepEqual(P.availableDates(result.reportingDates,'Retail'),['2026-10-04','2026-10-03','2026-09-26']);
  const fallback = build([{id:'fallback',detectedPeriod:{start:'2026-10-03'},rows:[{Representative:'A',num:4}]}]);
  assert.equal(fallback.byPerson.get('a')[0].week,'2026-10-03');
});
test('calendar-day keys are stable across timezones and date representations', () => {
  for (const TZ of ['UTC','America/New_York','America/Los_Angeles','Pacific/Auckland']) {
    const modulePath = path.resolve(__dirname,'../shared/coachtools-weekly-index.js');
    const output = execFileSync(process.execPath,['-e',`require(${JSON.stringify(modulePath)});const w=globalThis.CoachToolsWeeklyIndex;console.log(JSON.stringify(['2026-10-03','10/03/2026','2026-10-03T00:00:00Z',new Date('2026-10-03T00:00:00Z'),new Date(2026,9,3)].map(v=>w.reportingDateKey(v))))`],{env:{...process.env,TZ},encoding:'utf8'});
    assert.deepEqual(JSON.parse(output),Array(5).fill('2026-10-03'),TZ);
  }
});
for (const file of ['performance-scorecard.html','performance-scorecard-enhanced.html']) {
  test(`${file}: real checkbox and shortcut events immediately refresh selection and metrics`, () => {
    const {api,get,document,window,renderCount} = runtime(file,true);
    api.syncMainWindowUi();api.installWeekPicker();
    const click = selector => document.querySelector(selector).dispatchEvent(new window.Event('click',{bubbles:true}));
    click('[data-week-count="1"]');assert.deepEqual(api.mainWindowSpec().dates,[available[0]]);
    click('[data-week-count="4"]');assert.deepEqual(api.mainWindowSpec().dates,available.slice(0,4));
    click('[data-week-count="8"]');assert.deepEqual(api.mainWindowSpec().dates,available);
    click('[data-week-count="0"]');assert.deepEqual(api.mainWindowSpec().dates,[]);
    for (const key of [available[0],available[2]]) {
      const input=document.querySelector(`[data-reporting-week="${key}"]`);
      input.checked=true;input.dispatchEvent(new window.Event('change',{bubbles:true}));
      assert.equal(document.querySelector(`[data-reporting-week="${key}"]`),input);
    }
    assert.deepEqual(api.mainWindowSpec().dates,[available[0],available[2]]);
    assert.equal(api.historyCoverage('a').available,2);
    assert.match(get('weekComparison').textContent,/Compared with: 09\/12\/2026, 09\/05\/2026/);
    click('[data-week-count="all"]');assert.deepEqual(api.mainWindowSpec().dates,available);
    assert.equal(renderCount(),7,'Every user action renders immediately');
    get('weeksPicker').open=true;get('weeksSummary').focus=()=>{};
    const escape=new window.Event('keydown');escape.key='Escape';document.dispatchEvent(escape);
    assert.equal(get('weeksPicker').open,false);
    get('weeksPicker').open=true;click('#weekComparison');assert.equal(get('weeksPicker').open,false);
  });
  test(`${file}: selection drives weighted metrics, coverage and independent prior history`, () => {
    const { api,state,select } = runtime(file);
    state.weeklyByRep.set('a',[point(available[0],4,10),point(available[1],8,10),point(available[2],1,2),point(available[3],9,100)]);
    select(available.slice(0,2));
    assert.equal(api.aggregateMetric('a','consumer-rate').value,.6);
    const pack = api.metricPack({personId:'a'},'consumer-rate',[]);
    assert.equal(pack.prior.value,10/102);assert.equal(pack.trend.delta,.6-10/102);
    select([available[0],available[2],available[4]]);
    assert.deepEqual(api.personPoints('a').map(p=>p.week),[available[2],available[0]]);
    const coverage = api.historyCoverage('a');
    assert.equal(coverage.measured,2);assert.equal(coverage.available,3);assert.equal(coverage.rate,2/3);
    assert.equal(api.aggregateMetric('a','consumer-rate').value,5/12);
  });
  test(`${file}: team trend aggregates both periods rather than averaging rep deltas`, () => {
    const { api,state,select } = runtime(file);
    state.weeklyByRep.set('a',[point(available[0],8,10),point(available[1],1,10)]);
    state.weeklyByRep.set('b',[point(available[0],20,100),point(available[1],90,100)]);
    select([available[0]]);
    const packs = ['a','b'].map(personId=>({packs:{'consumer-rate':api.metricPack({personId},'consumer-rate',[])}}));
    const team = api.teamMetric(packs,'consumer-rate');
    assert.equal(team.value,28/110);assert.equal(team.comparison.prior,91/110);assert.equal(team.trend,28/110-91/110);
    assert.notEqual(team.trend,packs.reduce((n,r)=>n+r.packs['consumer-rate'].trend.delta,0)/2);
  });
  test(`${file}: insufficient baseline keeps current values and explicit clear stays empty`, () => {
    const { api,state,select,controls } = runtime(file);
    state.reportingDates.set('weeklyRetail',new Set(available.slice(0,6)));
    select(available.slice(0,4));
    const pack = api.metricPack({personId:'a'},'consumer-rate',[]);
    assert.equal(pack.value,.4);assert.equal(pack.trend.status,'insufficient');assert.ok(Number.isNaN(pack.trend.delta));
    assert.match(pack.trend.reason,/Need 4 prior weeks, found 2/);
    api.syncMainWindowUi();assert.match(controls.weekComparison.textContent,/Need 4 prior weeks, found 2/);
    select([]);assert.equal(api.mainWindowSpec().weeks,0);assert.equal(api.historyCoverage('a').eligible,false);
    assert.ok(Number.isNaN(api.aggregateMetric('a','consumer-rate').value));
    assert.equal(api.mainWindowSpec().weeks,0,'Clear must not reset to latest eight');
    select([available[0]]);state.weeklyByRep.set('a',[point(available[0])]);api.resetCalcCache();
    assert.match(api.metricPack({personId:'a'},'consumer-rate',[]).trend.reason,/Insufficient prior data/);
  });
  test(`${file}: department changes refresh dates without replacing missing source periods`, () => {
    const {api,state,controls,select} = runtime(file);
    state.reportingDates.set('weeklyReferral',new Set(['2026-10-04','2026-09-26']));
    state.weeklyByRep.set('a',[point('2026-10-03'),point('2026-10-04',8,10,'weeklyReferral')]);
    assert.deepEqual(api.mainWindowSpec().dates,available);
    select(['2026-10-03']);controls.departmentSel.value='Referral';api.resetCalcCache();
    assert.deepEqual(api.mainWindowSpec().dates,['2026-10-04','2026-09-26']);
    select(['2026-10-04']);controls.departmentSel.value='Retail';api.resetCalcCache();assert.deepEqual(api.mainWindowSpec().dates,['2026-10-03']);
    controls.departmentSel.value='All';api.resetCalcCache();assert.equal(api.availableReportingWeeks()[0],'2026-10-04');
    select(['2026-10-04','2026-10-03']);assert.equal(api.personPoints('a').length,2);
    assert.equal(api.aggregateMetric('a','consumer-rate').value,.6);
    state.weeklyByRep.set('b',[point('2026-10-03')]);assert.equal(api.historyCoverage('b').rate,.5);
    controls.departmentSel.value='Retail';api.resetCalcCache();select(['2026-10-04']);assert.deepEqual(api.mainWindowSpec().dates,[]);
  });
  test(`${file}: checkbox UI exposes every source date and shortcuts; QA does not bridge gaps`, () => {
    const { api,state,controls,select,html } = runtime(file);
    assert.ok(html.includes('preserveReportingDates:true'));assert.ok(html.includes('performance-scorecard-periods.js'));
    assert.ok(!html.includes('id="windowSel"'));assert.doesNotMatch(api.mainWindowSpec.toString(),/new Date|Date\.now/);
    for (const label of ['Latest Week','Latest 4','Latest 8','Select All','Clear']) assert.ok(html.includes(`>${label}</button>`));
    select([available[0],available[2]]);api.syncMainWindowUi();
    assert.equal((controls.weeksList.innerHTML.match(/type="checkbox"/g)||[]).length,7);
    assert.equal((controls.weeksList.innerHTML.match(/ checked/g)||[]).length,2);
    assert.match(controls.weekComparison.textContent,/Compared with: 09\/12\/2026, 09\/05\/2026 · 2 weeks/);
    assert.equal(controls.weeksSummary.textContent,'2 weeks · 10/03, 09/19');
    state.qaByRep.set('a',[{date:'2026-10-02',score:.9},{date:'2026-09-25',score:.1},{date:'2026-09-18',score:.8}]);
    assert.deepEqual(api.qaRows('a').map(q=>q.score),[.9,.8]);
    for (const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) if(script[1].trim()) new Function(script[1]);
  });
}
