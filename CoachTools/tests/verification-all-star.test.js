'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../shared/verification-all-star-core.js');

function row(cells) {
  const result = [];
  for (const [index,value] of Object.entries(cells)) result[Number(index)] = value;
  return result;
}
function laneSheet(metricColumn = 37, named = true) {
  return [[], [], row({26:'Name',37:'Verification Activity per Staffed Time'}), [], row({26:'Totals'}),
    row({26:'River Example',37:999}), row({26:'Morgan Sample',37:888}), [],
    row({26:'Name',[metricColumn]:named ? 'Verification Activity per Staffed Time' : 'Activity'}), row({26:'Totals',[metricColumn]:555}),
    row({26:'Sample, Morgan',[metricColumn]:12.5}), row({26:'RIVER EXAMPLE',[metricColumn]:15}), row({26:'Not In Roster',[metricColumn]:50})];
}
function fixture() {
  const sheets = {};
  for (let lane = 1; lane <= 5; lane++) {
    sheets[' Lane ' + lane + ' '] = laneSheet(lane === 2 ? 39 : 37);
    sheets[' Lane ' + lane + ' '].forEach(r => { if (typeof r[26] === 'string') r[26] = r[26].replace('River Example', 'River Example ' + lane).replace('RIVER EXAMPLE', 'RIVER EXAMPLE ' + lane).replace('Morgan Sample','Morgan Sample ' + lane).replace('Sample, Morgan','Sample ' + lane + ', Morgan'); });
  }
  sheets['Phone Data'] = [['Name','Other','Team_Name'],['River Example 1','','Coach One'],['Morgan Sample 1','','Coach Two']];
  return sheets;
}
test('monthly roster comes from the first AA list and activity from matched second list', () => {
  const parsed = core.parseMonthly(fixture());
  assert.equal(parsed.reps.length, 10);
  const river = parsed.reps.find(rep => rep.name === 'River Example 1');
  assert.equal(river.vaph,15);
  assert.equal(river.coach,'Coach One');
  assert.equal(parsed.reps.find(rep => rep.name === 'Morgan Sample 1').vaph,12.5);
  assert.equal(parsed.reps.some(rep => rep.name === 'Not In Roster'),false);
  assert.equal(parsed.reps.find(rep => rep.name === 'River Example 2').vaph,15);
});
test('monthly activity falls back to AL only in the second section', () => {
  const parsed = core.parseMonthly({'Lane 1':laneSheet(37,false)});
  assert.equal(parsed.reps[0].vaph,15);
  assert.equal(parsed.reps[1].vaph,12.5);
  assert.ok(parsed.warnings.some(w => w.includes('column AL')));
});
test('phone coach follows Team_Name header with column C fallback', () => {
  const named = core.parseMonthly({'Lane 1':laneSheet(),'Phone Data':[['Name','Team_Name','Other'],['River Example','Named Coach','Wrong Coach']]});
  assert.equal(named.reps[0].coach,'Named Coach');
  const fallback = core.parseMonthly({'Lane 1':laneSheet(),'phone data':[['River Example','','Fallback Coach']]});
  assert.equal(fallback.reps[0].coach,'Fallback Coach');
});
test('Lane 3 finds the activity header first, supports D fallback, and reports conflicts', () => {
  const parsed = core.parseLane3({October:[['Name','Avg Cases per hr Salesforce'],['River Example',20],['Morgan Sample',0]]},'October');
  assert.deepEqual(parsed.values,{'river example':20,'morgan sample':0});
  const fallback = core.parseLane3({October:[['Name','','','Activity'],['River Example','','',11],['RIVER EXAMPLE','','',12]]},'October');
  assert.equal(fallback.values['river example'],null);
  assert.ok(fallback.warnings.some(w => w.includes('column D')));
  assert.ok(fallback.warnings.some(w => w.includes('conflicting')));
});
test('month defaults use local calendar boundaries, matching full, short and dated tabs', () => {
  assert.equal(core.previousMonth(new Date(2026,0,2)), '2025-12');
  assert.equal(core.previousMonth(new Date(2026,10,9)), '2026-10');
  assert.equal(core.selectMonthSheet(['Sep','October','Oct 2025','Oct 2026'],'2026-10'),'Oct 2026');
  assert.equal(core.selectMonthSheet(['October 2025','Sept 26','2026-10'],'2026-10'),'2026-10');
  assert.equal(core.selectMonthSheet(['Oct 2025'],'2026-10'),null);
  assert.equal(core.selectMonthSheet(['October'],'2026-10'),'October');
});
test('normalized names handle full-name case, comma order, whitespace, apostrophes and dashes', () => {
  assert.equal(core.normalizeName(' Example, River '),'river example');
  assert.equal(core.normalizeName('Anne–Marie O’Example'),"anne-marie o'example");
  assert.notEqual(core.normalizeName('River Example'),core.normalizeName('River'));
});
function rep(name,lane = 1,vaph = 10) { return {name,key:core.normalizeName(name),lane,vaph,coach:'Example Coach'}; }
function metric(accepted = 25,offered = 100,quality = .95,attendance = 0,correctives = 0) { return {accepted,offered,quality,attendance,correctives}; }
test('ranking uses summed five lane ranks plus 500 points per corrective', () => {
  const report = core.buildReport({month:'2026-10',reps:[rep('River Example',1,20),rep('Morgan Sample',1,15),rep('Alex Demo',2,5)],metrics:{
    'river example':{...metric(40,100,.99,0,1),qaCount:4}, 'morgan sample':metric(30,100,.95,1,0), 'alex demo':metric(1,100,.80,10,2)
  }});
  const river = report.rows.find(r => r.name === 'River Example'), morgan = report.rows.find(r => r.name === 'Morgan Sample');
  assert.deepEqual(river.ranks,{wipers:1,vaph:1,quality:1,attendance:1,correctives:2});
  assert.equal(river.penalty,500);
  assert.equal(river.qaCount,4);
  assert.equal(river.total,506);
  assert.equal(morgan.total,9);
  assert.equal(morgan.winner,true);
  assert.equal(report.rows.find(r => r.lane === 2).total,1005);
  assert.equal(report.winners.length,2);
});
test('Lane 3 always overrides monthly VAPH, including missing or zero values', () => {
  const input = {reps:[rep('River Example',3,999)],metrics:{'river example':metric()}};
  const missing = core.buildReport(input);
  assert.equal(missing.rows[0].vaph,null);
  assert.equal(missing.rows[0].winner,false);
  assert.equal(missing.rows[0].total,null);
  const zero = core.buildReport({...input,lane3Values:{'Example, River':0}});
  assert.equal(zero.rows[0].vaph,0);
  assert.equal(zero.rows[0].winner,true);
});
test('exact ties share competition ranks and winner status', () => {
  const report = core.buildReport({reps:[rep('River Example'),rep('Morgan Sample'),rep('Alex Demo',1,1)],metrics:{
    'river example':metric(), 'morgan sample':metric(), 'alex demo':metric(1,100,.5,3,0)
  }});
  assert.equal(report.winners.length,2);
  assert.ok(report.winners.every(r => r.total === 5 && r.laneRank === 1));
  assert.equal(report.rows.find(r => r.name === 'Alex Demo').ranks.wipers,3);
});
test('missing data and zero offered block the whole lane winner, without awarding false zero scores', () => {
  const report = core.buildReport({reps:[rep('River Example'),rep('Morgan Sample')],metrics:{
    'river example':metric(), 'morgan sample':metric(0,0,null,null,null)
  }});
  const missing = report.rows.find(r => r.name === 'Morgan Sample');
  assert.deepEqual(missing.missing,['wipers','quality','attendance','correctives']);
  assert.equal(missing.total,null);
  assert.equal(report.winners.length,0);
  assert.equal(report.lanes[0].ready,false);
  assert.ok(report.rows.every(row => row.laneProvisional));
  assert.equal(report.rows.find(row => row.name === 'River Example').provisional,false);
});
test('duplicate names across lanes require roster review before winners', () => {
  const report = core.buildReport({reps:[rep('River Example',1),rep('River Example',2)],metrics:{'river example':metric()}});
  assert.equal(report.winners.length,0);
  assert.ok(report.rows.every(row => row.laneProvisional && !row.provisional));
});
test('workbook conversion preserves absolute AA/AL coordinates and XLSX round trips', () => {
  const XLSX = require('../vendor/xlsx.full.min.js');
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(laneSheet());
  sheet['!ref'] = 'AA3:AL13';
  XLSX.utils.book_append_sheet(book,sheet,'Lane 1');
  const bytes = XLSX.write(book,{type:'buffer',bookType:'xlsx'});
  const imported = XLSX.read(bytes,{type:'buffer'});
  const parsed = core.parseMonthly(imported,XLSX);
  assert.equal(parsed.reps.length,2);
  assert.equal(parsed.reps[0].name,'River Example');
  assert.equal(parsed.reps[0].vaph,15);
});
test('blocking source issues suppress winners while informational diagnostics do not', () => {
  const blocked = core.buildReport({reps:[rep('River Example')],metrics:{'river example':{...metric(),issues:['An offered count could not be read.']}}});
  assert.equal(blocked.rows[0].provisional,true);
  assert.equal(blocked.rows[0].total,null);
  assert.equal(blocked.winners.length,0);
  const informative = core.buildReport({reps:[rep('River Example')],metrics:{'river example':{...metric(),issues:[{message:'One week has no offers.',severity:'info'}]}}});
  assert.equal(informative.winners.length,1);
});
