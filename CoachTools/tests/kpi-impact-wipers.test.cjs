'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../apps/kpi-impact.html'), 'utf8').replace(/\r\n/g, '\n');
function harness(){
  const context = vm.createContext({});
  vm.runInContext(
    source.slice(source.indexOf('const toNum ='), source.indexOf('/* =========================\n   LocalStorage dock loading')) +
    source.slice(source.indexOf('function normHdr('), source.indexOf('function findDockKey(')) +
    source.slice(source.indexOf('function aoaToRows('), source.indexOf('/* =========================\n   Documented Coaching')) +
    'let allRows=[],headers=[],autoSets=[]; function rowsInScope(){return allRows;}' +
    source.slice(source.indexOf('function computeHeaders('), source.indexOf('function preferConsumerSet(')) +
    source.slice(source.indexOf('function computeTeamMetrics('), source.indexOf('function computeImpacts(')) +
    source.slice(source.indexOf('function metricGoalConfig('), source.indexOf('function calcPercentile(')) +
    `globalThis.api={
      load:(rows,source)=>normalizeWiperRows(canonicalizeStatsRowsFromDock({sheets:{'Coach Alpha':rows}},source),source),
      raw:(rows,source)=>canonicalizeStatsRowsFromDock({sheets:{'Coach Alpha':rows}},source),
      normalize:normalizeWiperRows,
      merge:mergeRetailReferral,
      select:rows=>{allRows=rows;computeHeaders();buildAutoSets();return autoSets.find(set=>set.label==='Wiper Rate');},
      sets:()=>autoSets,
      metrics:computeTeamMetrics,
      goal:metricGoalConfig,
      labels:metricVolumeLabels
    };`, context);
  return context.api;
}
const row = fields=>({Name:'Alex Reed',Date:'2026-11-01',...fields});

test('automatically discovers referral Accepted / Offered, ignores rate headers, and preserves appointment KPIs',()=>{
  const h = harness();
  const rows = h.load([row({
    'Wipers Accepted Rate':.99, 'Wipers Accept':1, 'Wipers Accepted':6,
    'Wipers Offered Rate':.88, 'Wipers Offered':20, 'Wipers Asked':40,
    'Wiper Count':9, 'Wiper Jobs':10, 'Consumer Appointments':4, 'Consumer Opportunities':10
  })], 'Referral');
  const set = h.select(rows);
  assert.equal(set.A, 'Wipers Accepted');
  assert.equal(set.B, 'Wipers Offered');
  assert.equal(h.metrics(set).rate, .3);
  assert.equal(h.metrics(set).apps, 6);
  assert.equal(h.metrics(set).opps, 20);
  assert.equal(h.goal(set).goal, .23);
  assert.equal(h.labels(set).numerator, 'wipers accepted');
  assert.equal(h.labels(set).denominator, 'wipers offered');
  assert.equal(h.sets().filter(set=>set.label==='Wiper Rate').length, 1);
  assert.ok(h.sets().some(set=>set.A==='Consumer Appointments' && set.B==='Consumer Opportunities'));
});

test('retail uses Count / Jobs and referral uses Accepted / Asked before combining weighted counts',()=>{
  const h = harness();
  const retail = h.load([row({'Wiper Count':10,'Wiper Jobs':20,'Wipers Accepted':99,'Wipers Asked':100})], 'Retail');
  const referral = h.load([row({'Wipers Accepted':3,'Wipers Asked':30,'Wiper Count':9,'Wiper Jobs':10})], 'Referral');
  let set = h.select(h.merge([...retail,...referral],true,false));
  assert.equal(h.metrics(set).rate, .5);
  set = h.select(h.merge([...retail,...referral],false,true));
  assert.equal(h.metrics(set).rate, .1);
  const combined = h.merge([...retail,...referral],true,true);
  assert.equal(combined.length, 1, 'same person and date remain one merged stats row');
  set = h.select(combined);
  assert.equal(h.metrics(set).apps, 13);
  assert.equal(h.metrics(set).opps, 50);
  assert.equal(h.metrics(set).rate, .26, 'count-weighted rate, rather than an average of source percentages');
});

test('supports legacy and normalized count headers and Coaching Gaps fallback behavior',()=>{
  const h = harness();
  for(const [fields,source,expected] of [
    [{' wipers_accept ':3,' Wipers-Asked ':10},'Referral',.3],
    [{' WIPERS_ACCEPTED ':4,'wiper_offered':20},'Referral',.2],
    [{'Wipers Accepted':5,'Wipers Offered':20},'Retail',.25],
    [{'Wiper Count':2,'Wiper Jobs':10},'Referral',.2],
    [{'Wiper Count':9,'Wiper Jobs':0,'Wipers Accepted':2,'Wipers Asked':10},'Retail',.2],
    [{'Wiper Count':2,'Wiper Jobs':10,'Wipers Accepted':9,'Wipers Asked':0},'Referral',.2]
  ]){
    const set = h.select(h.load([row(fields)], source));
    assert.ok(set, source+' wipers should be available automatically');
    assert.equal(h.metrics(set).rate, expected);
  }
});

test('weights representatives by offers, respects exclusions, and keeps a zero denominator unavailable',()=>{
  const h = harness();
  const rows = h.load([
    row({'Wipers Accepted':2,'Wipers Offered':10}),
    row({Name:'Blair Moss','Wipers Accepted':81,'Wipers Offered':90}),
    row({Name:'Total','Wipers Accepted':100,'Wipers Offered':100})
  ],'Referral');
  const set = h.select(rows);
  assert.equal(h.metrics(set).apps,83);
  assert.equal(h.metrics(set).opps,100);
  assert.equal(h.metrics(set).rate,.83);
  assert.equal(h.metrics(set).byRep.length,2);
  assert.equal(h.metrics(set,new Set(['Blair Moss'])).opps,10);
  assert.equal(h.metrics(set,new Set(['Blair Moss'])).rate,.2);
  const zeroSet = h.select(h.load([row({'Wipers Accepted':0,'Wipers Offered':0})],'Referral'));
  assert.ok(zeroSet);
  assert.ok(Number.isNaN(h.metrics(zeroSet).rate));
});

test('does not invent a count KPI from percentages or an incomplete pair',()=>{
  const h = harness();
  assert.equal(h.select(h.load([row({'Wipers Accepted Rate':.5,'Wipers Offered Rate':.7})],'Referral')), undefined);
  assert.equal(h.select(h.load([row({'Wipers Accepted':5,'Consumer Opportunities':20})],'Referral')), undefined);
});

test('cached 450-row parsing chunks use the same source-wide fallback as full parsing',()=>{
  const h = harness();
  for(const [source,early,late,expected] of [
    ['Retail',{'Wiper Count':0,'Wiper Jobs':0,'Wipers Accepted':3,'Wipers Asked':10},
      {'Wiper Count':1,'Wiper Jobs':10,'Wipers Accepted':3,'Wipers Asked':10},.1],
    ['Referral',{'Wiper Count':2,'Wiper Jobs':10,'Wipers Accepted':0,'Wipers Asked':0},
      {'Wiper Count':2,'Wiper Jobs':10,'Wipers Accepted':6,'Wipers Asked':20},.3]
  ]){
    const input = Array.from({length:451},(_,index)=>row(index===450 ? late : early));
    const full = h.load(input,source);
    const fullSet = h.select(full);
    const fullRate = h.metrics(fullSet).rate;
    const cachedChunks = [...h.raw(input.slice(0,450),source),...h.raw(input.slice(450),source)];
    assert.equal(cachedChunks[0]['Wipers Offered'],undefined,'chunk preparation retains raw count pairs');
    const chunkSet = h.select(h.normalize(cachedChunks,source));
    assert.equal(h.metrics(chunkSet).rate,expected);
    assert.equal(h.metrics(chunkSet).rate,fullRate,source+' results must not depend on the parser chunk boundary');
  }
  assert.match(source,/normalizeWiperRows\(canonicalizeStatsRowsFromDock\(retailDock, 'Retail'\), 'Retail'\)/);
  assert.match(source,/normalizeWiperRows\(canonicalizeStatsRowsFromDock\(referralDock, 'Referral'\), 'Referral'\)/);
});
