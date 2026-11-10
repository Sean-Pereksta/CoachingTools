'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../shared/verification-all-star-core.js');
const strictSettings = {measures:['wipers','vaph','quality','attendance','correctives'],requireAllWiperWeeks:true,correctivePenalty:500};
function buildStrict(options) { return core.buildReport({...options,settings:strictSettings}); }

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
  const report = buildStrict({month:'2026-10',reps:[rep('River Example',1,20),rep('Morgan Sample',1,15),rep('Alex Demo',2,5)],metrics:{
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
  const missing = buildStrict(input);
  assert.equal(missing.rows[0].vaph,null);
  assert.equal(missing.rows[0].winner,false);
  assert.equal(missing.rows[0].total,null);
  const zero = buildStrict({...input,lane3Values:{'Example, River':0}});
  assert.equal(zero.rows[0].vaph,0);
  assert.equal(zero.rows[0].winner,true);
});
test('exact ties share competition ranks and winner status', () => {
  const report = buildStrict({reps:[rep('River Example'),rep('Morgan Sample'),rep('Alex Demo',1,1)],metrics:{
    'river example':metric(), 'morgan sample':metric(), 'alex demo':metric(1,100,.5,3,0)
  }});
  assert.equal(report.winners.length,2);
  assert.ok(report.winners.every(r => r.total === 5 && r.laneRank === 1));
  assert.equal(report.rows.find(r => r.name === 'Alex Demo').ranks.wipers,3);
});
test('missing data and zero offered exclude that representative while complete peers still win', () => {
  const report = buildStrict({reps:[rep('River Example'),rep('Morgan Sample')],metrics:{
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
  const report = buildStrict({reps:[rep('River Example',1),rep('River Example',2)],metrics:{'river example':metric()}});
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
  const blocked = buildStrict({reps:[rep('River Example')],metrics:{'river example':{...metric(),issues:['An offered count could not be read.']}}});
  assert.equal(blocked.rows[0].provisional,true);
  assert.equal(blocked.rows[0].total,null);
  assert.equal(blocked.winners.length,0);
  const informative = buildStrict({reps:[rep('River Example')],metrics:{'river example':{...metric(),issues:[{message:'One week has no offers.',severity:'info'}]}}});
  assert.equal(informative.winners.length,1);
});

for (const missingField of ['quality','wipers','vaph','attendance','correctives']) {
  test('a representative missing ' + missingField + ' cannot distort any eligible metric rank or summed total', () => {
    const completeReps = [rep('Complete First',1,20),rep('Complete Second',1,10)];
    const completeMetrics = {'complete first':metric(60,100,.9,1,1),'complete second':metric(40,100,.8,2,2)};
    const baseline = buildStrict({reps:completeReps,metrics:completeMetrics});
    const partialRep = rep('Partial Best',1,999), partialMetric = metric(100,100,1,0,0);
    if (missingField === 'vaph') partialRep.vaph = null;
    else if (missingField === 'wipers') partialMetric.accepted = null;
    else partialMetric[missingField] = null;
    const report = buildStrict({reps:[...completeReps,partialRep],metrics:{...completeMetrics,'partial best':partialMetric}});
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
  const report = buildStrict({reps,metrics,lane3Values});
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
  const report = buildStrict({reps:[rep('Duplicate Example',1,999),rep('Duplicate Example',2,999),rep('Unique One',1,1),rep('Unique Two',2,1)],metrics:{
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
  const report = buildStrict({reps:[rep('Complete Example',1,1),rep('Conflicting Best',1,999)],metrics:{
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
  const report = buildStrict({reps:[rep('Observed Zero',1,0),rep('Unknown Counts',1,999)],metrics:{
    'observed zero':metric(0,10,0,0,0), 'unknown counts':{accepted:10,offered:10,quality:1}
  }});
  const zero = report.rankedRows[0], unknown = report.excludedRows[0];
  assert.equal(zero.name,'Observed Zero'); assert.equal(zero.wipers,0); assert.equal(zero.vaph,0); assert.equal(zero.quality,0);
  assert.equal(zero.attendance,0); assert.equal(zero.correctives,0); assert.equal(zero.total,5); assert.equal(zero.winner,true);
  assert.deepEqual(unknown.missing,['attendance','correctives']);
  assert.equal(unknown.attendance,null); assert.equal(unknown.correctives,null); assert.equal(unknown.penalty,null); assert.equal(unknown.total,null);
});

test('a lane without an eligible cohort has no ranks, total, or winner', () => {
  const report = buildStrict({reps:[rep('Missing Quality'),rep('Missing Wipers')],metrics:{
    'missing quality':metric(1,100,null),'missing wipers':metric(0,0,.99)
  }});
  assert.equal(report.rankedRows.length,0); assert.equal(report.excludedRows.length,2); assert.equal(report.winners.length,0);
  assert.equal(report.lanes[0].ready,false); assert.equal(report.lanes[0].provisional,true);
  assert.ok(report.rows.every(row => row.total === null && row.laneRank === null && !row.winner));
  assert.ok(report.rows.every(row => Object.values(row.ranks).every(rank => rank === null)));
  assert.equal(report.stats.readyLanes,0);
});

test('excluded high performers cannot change a complete-cohort tie or competition rank gaps', () => {
  const report = buildStrict({reps:[rep('Tied One'),rep('Tied Two'),rep('Third Place',1,1),rep('Excluded Best',1,999)],metrics:{
    'tied one':metric(), 'tied two':metric(), 'third place':metric(1,100,.5,3,0), 'excluded best':metric(100,100,1,null,0)
  }});
  assert.equal(report.winners.length,2);
  assert.ok(report.winners.every(row => row.total === 5 && row.laneRank === 1));
  assert.deepEqual(report.rankedRows.find(row => row.name === 'Third Place').ranks,{wipers:3,vaph:3,quality:3,attendance:3,correctives:1});
  assert.equal(report.excludedRows[0].total,null);
});

test('warning, informational, and explicitly nonblocking source notes allow complete representatives to rank', () => {
  for (const issue of [{message:'Source note',severity:'warning'}, {message:'Source note',severity:'info'}, {message:'Source note',severity:'error',blocking:false}]) {
    const report = buildStrict({reps:[rep('Complete Example')],metrics:{'complete example':{...metric(),issues:[issue]}}});
    assert.equal(report.rankedRows.length,1); assert.equal(report.excludedRows.length,0); assert.equal(report.winners.length,1);
    assert.equal(report.winners[0].total,5); assert.deepEqual(report.winners[0].exclusionReasons,[]);
  }
});

test('ranking settings default to the three requested performance measures and reject an explicit empty selection', () => {
  assert.deepEqual(core.normalizeSettings(),{measures:['wipers','vaph','quality'],requireAllWiperWeeks:false,correctivePenalty:500});
  assert.deepEqual(core.normalizeSettings({measures:['quality','vaph','quality'],correctivePenalty:'125'}),{measures:['vaph','quality'],requireAllWiperWeeks:false,correctivePenalty:125});
  assert.throws(() => core.normalizeSettings({measures:[]}), /at least one/);
  assert.throws(() => core.buildReport({settings:{measures:[]}}), /at least one/);
  assert.throws(() => core.normalizeSettings({measures:['unknown']}), /Choose ranking measures/);
  assert.throws(() => core.normalizeSettings({correctivePenalty:-1}), /nonnegative/);
  assert.throws(() => core.normalizeSettings({correctivePenalty:Infinity}), /nonnegative/);
  assert.throws(() => core.normalizeSettings({requireAllWiperWeeks:'false'}), /on or off/);
});

test('default eligibility recovers complete performance data despite missing checklist sources and known Wiper week gaps', () => {
  const input = {reps:[rep('Complete Performance')],metrics:{'complete performance':{
    accepted:20,offered:100,quality:.95,
    issueDetails:[
      {code:'attendance-source',metric:'attendance',message:'Attendance source columns unavailable',blocking:true},
      {code:'correctives-source',metric:'correctives',message:'Corrective source column unavailable',blocking:true},
      {code:'missing-wiper-weeks',metric:'wipers',message:'Missing Wiper data for 2 available week(s)',blocking:true}
    ]
  }}};
  const before = JSON.stringify(input), report = core.buildReport(input), ranked = report.rankedRows[0];
  assert.equal(JSON.stringify(input),before);
  assert.equal(report.rankedRows.length,1); assert.equal(report.excludedRows.length,0);
  assert.equal(ranked.total,3); assert.equal(ranked.penalty,0); assert.equal(ranked.provisional,false);
  assert.deepEqual(ranked.ranks,{wipers:1,vaph:1,quality:1,attendance:null,correctives:null});
  assert.equal(ranked.attendance,null); assert.equal(ranked.correctives,null); assert.deepEqual(ranked.missing,[]);
  assert.deepEqual(ranked.dataWarnings,[{code:'missing-wiper-weeks',metric:'wipers',message:'Missing Wiper data for 2 available week(s)'}]);
  assert.deepEqual(report.eligibilityComparison,{currentEligible:1,threeMetricEligible:1,strictEligible:0,recoveredByThreeMetrics:1});
  assert.deepEqual(report.exclusionSummary,[]);
});

test('legacy Wiper, QA, attendance and corrective issue messages are scoped to selected measures', () => {
  const report = core.buildReport({reps:[rep('Complete Performance')],metrics:{'complete performance':{
    accepted:20,offered:100,quality:.95,
    issues:['Missing Wiper data for 4 available week(s)','Attendance source columns unavailable','Corrective source column unavailable','Checklist item dates need review']
  }}});
  assert.equal(report.rankedRows.length,1); assert.equal(report.rankedRows[0].dataWarnings.length,1);
  assert.equal(report.rankedRows[0].dataWarnings[0].code,'missing-wiper-weeks');
  assert.equal(report.eligibilityComparison.strictEligible,0);
  const onlyActivity = core.buildReport({settings:{measures:['vaph']},reps:[rep('Only Activity',1,12)],metrics:{'only activity':{
    issues:['No Wiper data for this month','Evaluation dates need review','Attendance source columns unavailable','Corrective source column unavailable','Checklist item dates need review']
  }}});
  assert.equal(onlyActivity.rankedRows.length,1); assert.equal(onlyActivity.rankedRows[0].total,1);
  assert.deepEqual(onlyActivity.rankedRows[0].ranks,{wipers:null,vaph:1,quality:null,attendance:null,correctives:null});
  assert.equal(onlyActivity.rankedRows[0].quality,null); assert.equal(onlyActivity.rankedRows[0].wipers,null);
});

test('typed source details are authoritative and block only the selected source metric', () => {
  const metrics = {'Complete Example':{...metric(),issues:['Unknown conflicting source'],issueDetails:[{code:'attendance-source',metric:'attendance',message:'Attendance unavailable',blocking:true}]}};
  assert.equal(core.buildReport({reps:[rep('Complete Example')],metrics}).rankedRows.length,1);
  const attendance = core.buildReport({settings:{measures:['attendance']},reps:[rep('Complete Example')],metrics});
  assert.equal(attendance.excludedRows.length,1);
  assert.deepEqual(attendance.excludedRows[0].exclusionDetails,[{code:'attendance-source',metric:'attendance',message:'Attendance unavailable'}]);
  assert.equal(core.buildReport({reps:[rep('Complete Example')],metrics:{'complete example':{...metric(),issues:['Unknown conflicting source'],issueDetails:[]}}}).rankedRows.length,1);
});

test('unknown blocking conflicts still exclude a representative under the default performance settings', () => {
  const report = core.buildReport({reps:[rep('Complete Example')],metrics:{'complete example':{...metric(),issueDetails:[{code:'unresolved-conflict',metric:'source',message:'Two source identities disagree.',blocking:true}]}}});
  assert.equal(report.excludedRows.length,1);
  assert.deepEqual(report.excludedRows[0].exclusionDetails,[{code:'unresolved-conflict',metric:'source',message:'Two source identities disagree.'}]);
  assert.equal(report.exclusionSummary[0].count,1);
});

test('all supported nonempty measure combinations sum only selected ranks and apply corrective penalty only when selected', () => {
  const ids = core.MEASURES.map(measure => measure.id);
  for (let mask = 1; mask < 32; mask++) {
    const measures = ids.filter((_,index) => mask & (1 << index));
    const report = core.buildReport({settings:{measures,correctivePenalty:125},reps:[rep('Complete Example',1,0)],metrics:{'complete example':metric(0,10,0,0,2)}});
    const ranked = report.rankedRows[0];
    assert.equal(ranked.total,measures.length + (measures.includes('correctives') ? 250 : 0), measures.join(','));
    assert.equal(ranked.penalty,measures.includes('correctives') ? 250 : 0);
    for (const id of ids) assert.equal(ranked.ranks[id],measures.includes(id) ? 1 : null,id);
  }
});

test('correctives-only scoring needs no performance data and supports a zero penalty', () => {
  const options = {settings:{measures:['correctives'],correctivePenalty:125},reps:[rep('No Correctives',1,null),rep('Two Correctives',1,null)],metrics:{
    'no correctives':{correctives:0},'two correctives':{correctives:2}
  }};
  const report = core.buildReport(options);
  assert.deepEqual(report.rankedRows.map(row => [row.name,row.total]),[['No Correctives',1],['Two Correctives',252]]);
  assert.ok(report.rankedRows.every(row => row.attendance === null && row.quality === null && row.vaph === null && row.wipers === null));
  const zeroPenalty = core.buildReport({...options,settings:{measures:['correctives'],correctivePenalty:0}});
  assert.deepEqual(zeroPenalty.rankedRows.map(row => row.total),[1,2]);
});

test('known Wiper week coverage is optional by default and required only when the user enables it', () => {
  const input = {reps:[rep('Week Gap')],metrics:{'week gap':{...metric(),issueDetails:[{code:'missing-wiper-weeks',metric:'wipers',message:'Missing Wiper data for 2 available week(s)',blocking:false}]}}};
  assert.equal(core.buildReport(input).rankedRows.length,1);
  const strictWeeks = core.buildReport({...input,settings:{requireAllWiperWeeks:true}});
  assert.equal(strictWeeks.excludedRows.length,1);
  assert.deepEqual(strictWeeks.excludedRows[0].exclusionDetails,[{code:'missing-wiper-weeks',metric:'wipers',message:'Missing Wiper data for 2 available week(s)'}]);
  assert.equal(core.buildReport({...input,settings:{measures:['quality'],requireAllWiperWeeks:true}}).rankedRows.length,1);
});

test('only selected metric ranks determine totals even when unselected corrective counts are high', () => {
  const report = core.buildReport({settings:{measures:['wipers','quality']},reps:[rep('Best Performance'),rep('Other Performance')],metrics:{
    'best performance':metric(90,100,.99,null,9),'other performance':metric(80,100,.9,null,0)
  }});
  assert.deepEqual(report.rankedRows.map(row => [row.name,row.total]),[['Best Performance',2],['Other Performance',4]]);
  assert.ok(report.rankedRows.every(row => row.penalty === 0 && row.ranks.vaph === null && row.ranks.correctives === null && row.ranks.attendance === null));
});

test('exclusion summaries count unique people per reason while allowing overlapping reasons', () => {
  const report = core.buildReport({reps:[rep('Duplicate Example',1),rep('Duplicate Example',2),rep('Other Missing Quality',1)],metrics:{
    'duplicate example':metric(0,0,null),'other missing quality':metric(1,10,null)
  }});
  const summary = code => report.exclusionSummary.find(reason => reason.code === code);
  assert.equal(summary('duplicate-identity').count,1);
  assert.equal(summary('missing-quality').count,2);
  assert.equal(summary('missing-wipers').count,1);
  assert.equal(report.excludedRows.length,3);
  assert.deepEqual(report.eligibilityComparison,{currentEligible:0,threeMetricEligible:0,strictEligible:0,recoveredByThreeMetrics:0});
});

test('eligibility comparison separates active settings, default three-metric eligibility, and strict five-metric coverage', () => {
  const report = core.buildReport({settings:{measures:['vaph']},reps:[rep('All Performance'),rep('Activity Only')],metrics:{
    'all performance':{accepted:1,offered:10,quality:.9},'activity only':{}
  }});
  assert.deepEqual(report.eligibilityComparison,{currentEligible:2,threeMetricEligible:1,strictEligible:0,recoveredByThreeMetrics:1});
});

for (const boundary of ['total','blank','metric']) {
  test('monthly roster stops at its ' + boundary + ' boundary before ACW summary labels in all five lanes', () => {
    const sheets = {};
    for (let lane = 1; lane <= 5; lane++) {
      const first = 'Élodie Dupont ' + lane, second = 'Sample ' + lane + ', Morgan';
      const separator = boundary === 'total' ? row({26:'Totals'}) : boundary === 'blank' ? [] : row({26:'ACW %'});
      sheets['Lane ' + lane] = [[],[],row({26:'Name'}),[],row({26:'Totals'}),row({26:first}),row({26:second}),separator,
        row({26:'ACW %'}),row({26:'ACW time'}),row({26:'Average Handle Time'}),row({26:'Name',37:'Verification Activity per Staffed Time'}),
        row({26:'Totals'}),row({26:first,37:15}),row({26:'ACW time',37:999})];
    }
    const parsed = core.parseMonthly(sheets);
    assert.equal(parsed.reps.length,10);
    assert.ok(parsed.reps.every(person => !/acw|handle time/i.test(person.name)));
    assert.equal(new Set(parsed.reps.map(person => person.key)).size,10);
    assert.ok(!parsed.warnings.some(warning => /appears in more than one lane/.test(warning)));
    for (let lane = 1; lane <= 5; lane++) {
      const members = parsed.reps.filter(person => person.lane === lane);
      assert.equal(members.length,2); assert.equal(members[0].name,'Élodie Dupont ' + lane); assert.equal(members[0].vaph,15);
      assert.equal(members[1].name,'Sample ' + lane + ', Morgan'); assert.equal(members[1].vaph,null,'real representative without activity remains in the roster');
    }
  });
}

test('internal roster spacing preserves later genuine names while summary headings still end the roster', () => {
  const parsed = core.parseMonthly({'Lane 1':[
    [],[],row({26:'Name'}),[],row({26:'Totals'}),
    row({26:'Élodie Dupont'}),[],row({26:'Sample, Morgan'}),[],
    row({26:'Attendance'}),row({26:'ACW %'}),row({26:'ACW time'}),
    row({26:'Name',37:'Verification Activity per Staffed Time'}),row({26:'Totals'}),
    row({26:'Élodie Dupont'}),row({26:'Sample, Morgan',37:14}),row({26:'ACW time',37:999})
  ]});
  assert.deepEqual(parsed.reps.map(person => person.name),['Élodie Dupont','Sample, Morgan']);
  assert.equal(parsed.reps[0].vaph,null,'missing activity does not remove a real representative');
  assert.equal(parsed.reps[1].vaph,14);
  assert.ok(parsed.reps.every(person => person.coach === ''),'a coach directory is not required to recognize roster names');
  assert.ok(parsed.reps.every(person => !/attendance|acw/i.test(person.name)));
});
