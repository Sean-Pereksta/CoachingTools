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
test('missing data and zero offered exclude that representative while complete peers still win', () => {
  const report = core.buildReport({reps:[rep('River Example'),rep('Morgan Sample')],metrics:{
    'river example':metric(), 'morgan sample':metric(0,0,null,null,null)
  }});
  const missing = report.rows.find(r => r.name === 'Morgan Sample');
  assert.deepEqual(missing.missing,['wipers','quality','attendance','correctives']);
  assert.equal(missing.total,null);
  assert.equal(missing.eligible,false);
  assert.deepEqual(missing.ranks,{wipers:null,vaph:null,quality:null,attendance:null,correctives:null});
  assert.equal(missing.laneRank,null);
  assert.equal(report.winners.length,1);
  assert.equal(report.winners[0].name,'River Example');
  assert.equal(report.winners[0].total,5);
  assert.equal(report.lanes[0].ready,true);
  assert.equal(report.lanes[0].provisional,false);
  assert.ok(report.rows.every(row => !row.laneProvisional));
  assert.deepEqual(report.rankedRows.map(row => row.name),['River Example']);
  assert.deepEqual(report.excludedRows.map(row => row.name),['Morgan Sample']);
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

for (const missingField of ['quality','wipers','vaph','attendance','correctives']) {
  test('a representative missing ' + missingField + ' cannot distort any eligible metric rank or summed total', () => {
    const completeReps = [rep('Complete First',1,20),rep('Complete Second',1,10)];
    const completeMetrics = {'complete first':metric(60,100,.9,1,1),'complete second':metric(40,100,.8,2,2)};
    const baseline = core.buildReport({reps:completeReps,metrics:completeMetrics});
    const partialRep = rep('Partial Best',1,999), partialMetric = metric(100,100,1,0,0);
    if (missingField === 'vaph') partialRep.vaph = null;
    else if (missingField === 'wipers') partialMetric.accepted = null;
    else partialMetric[missingField] = null;
    const report = core.buildReport({reps:[...completeReps,partialRep],metrics:{...completeMetrics,'partial best':partialMetric}});
    assert.deepEqual(report.rankedRows.map(row => ({name:row.name,ranks:row.ranks,total:row.total,laneRank:row.laneRank,winner:row.winner})),
      baseline.rankedRows.map(row => ({name:row.name,ranks:row.ranks,total:row.total,laneRank:row.laneRank,winner:row.winner})));
    const excluded = report.excludedRows[0];
    assert.equal(excluded.name,'Partial Best'); assert.equal(excluded.eligible,false);
    assert.deepEqual(excluded.missing,[missingField]);
    assert.ok(excluded.exclusionReasons.length > 0);
    assert.ok(Object.values(excluded.ranks).every(rank => rank === null));
    assert.equal(excluded.total,null); assert.equal(excluded.laneRank,null); assert.equal(excluded.winner,false);
    assert.equal(report.lanes[0].ready,true); assert.equal(report.lanes[0].provisional,false);
  });
}

test('all five lanes publish eligible winners and totals despite incomplete roster members', () => {
  const reps = [], metrics = {}, lane3Values = {};
  for (let lane = 1; lane <= 5; lane++) {
    const complete = rep('Complete Lane ' + lane,lane,10), partial = rep('Partial Lane ' + lane,lane,999);
    reps.push(complete,partial);
    metrics[complete.key] = metric(); metrics[partial.key] = metric(100,100,null,0,0);
    if (lane === 3) { lane3Values[complete.key] = 10; lane3Values[partial.key] = 999; }
  }
  const report = core.buildReport({reps,metrics,lane3Values});
  assert.equal(report.rows.length,10); assert.equal(report.winners.length,5);
  assert.equal(report.rankedRows.length,5); assert.equal(report.excludedRows.length,5);
  assert.deepEqual(report.stats,{totalRows:10,eligibleRows:5,excludedRows:5,readyLanes:5});
  assert.ok(report.winners.every(row => row.total === 5 && row.laneRank === 1 && row.eligible && !row.laneProvisional));
  for (const lane of report.lanes) {
    assert.equal(lane.ready,true); assert.equal(lane.provisional,false);
    assert.equal(lane.count,2); assert.equal(lane.eligibleCount,1); assert.equal(lane.excludedCount,1);
    assert.equal(lane.rankedRows.length,1); assert.equal(lane.excludedRows.length,1); assert.equal(lane.winners.length,1);
  }
  assert.ok(report.warnings.every(warning => !/pending|no eligible representatives/.test(warning)));
});

test('duplicate roster names are excluded without blocking unrelated winners in either lane', () => {
  const report = core.buildReport({reps:[rep('Duplicate Example',1,999),rep('Duplicate Example',2,999),rep('Unique One',1,1),rep('Unique Two',2,1)],metrics:{
    'duplicate example':metric(100,100,1,0,0),'unique one':metric(),'unique two':metric()
  }});
  assert.deepEqual(report.winners.map(row => row.name),['Unique One','Unique Two']);
  assert.ok(report.winners.every(row => row.total === 5));
  assert.equal(report.excludedRows.length,2);
  assert.ok(report.excludedRows.every(row => !row.eligible && row.total === null && row.laneRank === null && !row.winner));
  assert.ok(report.excludedRows.every(row => Object.values(row.ranks).every(rank => rank === null)));
  assert.ok(report.excludedRows.every(row => row.exclusionReasons.some(reason => /Duplicate representative/.test(reason))));
  assert.equal(report.lanes[0].ready,true); assert.equal(report.lanes[1].ready,true);
});

test('a conflicting source record is excluded before metric ranks and does not block its complete peer', () => {
  const report = core.buildReport({reps:[rep('Complete Example',1,1),rep('Conflicting Best',1,999)],metrics:{
    'complete example':metric(1,100,.5,5,1),
    'conflicting best':{...metric(100,100,1,0,0),issues:[{message:'Two uploaded sources disagree.',severity:'error'}]}
  }});
  assert.equal(report.winners.length,1); assert.equal(report.winners[0].name,'Complete Example');
  assert.deepEqual(report.winners[0].ranks,{wipers:1,vaph:1,quality:1,attendance:1,correctives:1});
  assert.equal(report.winners[0].total,505);
  assert.deepEqual(report.excludedRows[0].exclusionReasons,['Two uploaded sources disagree.']);
  assert.ok(Object.values(report.excludedRows[0].ranks).every(rank => rank === null));
});

test('zero-valued observed statistics remain eligible, while unknown attendance and correctives stay unknown', () => {
  const report = core.buildReport({reps:[rep('Observed Zero',1,0),rep('Unknown Counts',1,999)],metrics:{
    'observed zero':metric(0,10,0,0,0), 'unknown counts':{accepted:10,offered:10,quality:1}
  }});
  const zero = report.rankedRows[0], unknown = report.excludedRows[0];
  assert.equal(zero.name,'Observed Zero'); assert.equal(zero.wipers,0); assert.equal(zero.vaph,0); assert.equal(zero.quality,0);
  assert.equal(zero.attendance,0); assert.equal(zero.correctives,0); assert.equal(zero.total,5); assert.equal(zero.winner,true);
  assert.deepEqual(unknown.missing,['attendance','correctives']);
  assert.equal(unknown.attendance,null); assert.equal(unknown.correctives,null); assert.equal(unknown.penalty,null); assert.equal(unknown.total,null);
});

test('a lane without an eligible cohort has no ranks, total, or winner', () => {
  const report = core.buildReport({reps:[rep('Missing Quality'),rep('Missing Wipers')],metrics:{
    'missing quality':metric(1,100,null),'missing wipers':metric(0,0,.99)
  }});
  assert.equal(report.rankedRows.length,0); assert.equal(report.excludedRows.length,2); assert.equal(report.winners.length,0);
  assert.equal(report.lanes[0].ready,false); assert.equal(report.lanes[0].provisional,true);
  assert.ok(report.rows.every(row => row.total === null && row.laneRank === null && !row.winner));
  assert.ok(report.rows.every(row => Object.values(row.ranks).every(rank => rank === null)));
  assert.equal(report.stats.readyLanes,0);
});

test('excluded high performers cannot change a complete-cohort tie or competition rank gaps', () => {
  const report = core.buildReport({reps:[rep('Tied One'),rep('Tied Two'),rep('Third Place',1,1),rep('Excluded Best',1,999)],metrics:{
    'tied one':metric(), 'tied two':metric(), 'third place':metric(1,100,.5,3,0), 'excluded best':metric(100,100,1,null,0)
  }});
  assert.equal(report.winners.length,2);
  assert.ok(report.winners.every(row => row.total === 5 && row.laneRank === 1));
  assert.deepEqual(report.rankedRows.find(row => row.name === 'Third Place').ranks,{wipers:3,vaph:3,quality:3,attendance:3,correctives:1});
  assert.equal(report.excludedRows[0].total,null);
});

test('warning, informational, and explicitly nonblocking source notes allow complete representatives to rank', () => {
  for (const issue of [{message:'Source note',severity:'warning'}, {message:'Source note',severity:'info'}, {message:'Source note',severity:'error',blocking:false}]) {
    const report = core.buildReport({reps:[rep('Complete Example')],metrics:{'complete example':{...metric(),issues:[issue]}}});
    assert.equal(report.rankedRows.length,1); assert.equal(report.excludedRows.length,0); assert.equal(report.winners.length,1);
    assert.equal(report.winners[0].total,5); assert.deepEqual(report.winners[0].exclusionReasons,[]);
  }
});
