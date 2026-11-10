'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
global.WeeklyCore = require('../shared/weekly-data-builder-core.js');
const data = require('../shared/verification-all-star-data.js');
const reps = [{name:'Alex Example', coach:'Coach One', lane:1}, {name:'Jordan Sample', lane:2}];
const sources = {checklist:{available:true,attendanceAvailable:true,correctivesAvailable:true}};
const weeklyHeader = ['Date','Sheet','Name','Wipers Accepted','Wipers Offered','Wiper Rate'];
const qaHeader = ['Agent Name','Interaction Start Time','Score %','Evaluation ID'];
const checklistHeader = ['Associate Name','Incident Date','Incident','Description','Corrective Action Taken','ID'];
const parse = (type, rows, meta={id:'one',importedAt:'2026-11-01'}) => data.parseRows(type, rows, meta).rows;

test('calendar dates accept Excel serials and source dates, reject rollover and ranges', () => {
  assert.equal(data.dayKey('10/7/26 12:24 PM'), '2026-10-07');
  assert.equal(data.dayKey('2026-10-31T23:00:00-04:00'), '2026-10-31');
  assert.equal(data.dayKey('2026-02-31'), '');
  assert.equal(data.dayKey('10/1/2026 - 10/7/2026'), '');
  assert.equal(data.dayKey(46296), '2026-10-01');
});

test('month Wiper rate is total accepted / total offered with exact full names', () => {
  const weekly = parse('weeklyReferral', [weeklyHeader,
    ['10/7/2026','Coach One','Example, Alex',1,2,'50%'],
    ['10/14/2026','Coach One','Alex Example',9,90,'10%'],
    ['11/1/2026','Coach One','Alex Example',90,90,'100%'],
    ['10/7/2026','Coach One','Alex Different',90,90,'100%']]);
  const result = data.aggregate({month:'2026-10',reps,weekly,sources});
  assert.equal(result.metrics['alex example'].wiperRate, 10/92);
  assert.equal(result.metrics['alex example'].accepted,10);
  assert.deepEqual(result.weeks,['2026-10-07','2026-10-14']);
  assert.equal(result.metrics['jordan sample'].wiperRate,null);
});

test('latest retained weekly snapshot replaces a person/date instead of double counting', () => {
  const old = parse('weeklyReferral',[weeklyHeader,['10/7/2026','Coach One','Alex Example',1,10]],{id:'old',importedAt:'2026-10-08'});
  const newer = parse('weeklyReferral',[weeklyHeader,['10/7/2026','Coach One','Alex Example',2,10]],{id:'new',importedAt:'2026-10-15'});
  const result = data.aggregate({month:'2026-10',reps,weekly:old.concat(newer),sources});
  assert.equal(result.metrics['alex example'].accepted,2);
  assert.equal(result.metrics['alex example'].weeklyWipers.length,1);
});

test('explicit upload overrides one week and retains the other stored weeks', () => {
  const weekly = parse('weeklyReferral',[weeklyHeader,['10/7/2026','Coach One','Alex Example',1,10],['10/14/2026','Coach One','Alex Example',2,10]]);
  const upload = {rows:parse('weeklyReferral',[weeklyHeader,['10/7/2026','Coach One','Alex Example',5,10]])};
  const result = data.aggregate({month:'2026-10',reps,weekly,sources,uploads:[upload]});
  assert.equal(result.metrics['alex example'].accepted,7);
  assert.equal(result.metrics['alex example'].offered,20);
});

test('90-day evaluations are filtered by month and unique evaluation ID', () => {
  const old = parse('qa',[qaHeader,['Alex Example','10/3/2026 10:00 AM','80%','eval-one']],{id:'old',importedAt:'2026-10-04'});
  const qa = old.concat(parse('qa',[qaHeader,['Alex Example','10/3/2026 10:00 AM','90%','eval-one'],['Alex Example','10/8/2026',1,'eval-two'],['Alex Example','9/30/2026','0%','outside']],{id:'new',importedAt:'2026-11-01'}));
  const result = data.aggregate({month:'2026-10',reps,qa,sources});
  assert.equal(result.metrics['alex example'].quality,0.95);
  assert.equal(result.metrics['alex example'].qaCount,2);
});

test('Genesys evaluation IDs keep separate scores on one conversation while replacing an updated evaluation', () => {
  const header = ['Conversationid','Genesys Evaluation ID','Agent Name','Interaction Start Time','Score %'];
  const original = parse('qa',[header,
    ['conversation-one','evaluation-one','Alex Example','10/3/2026','80%'],
    ['conversation-one','evaluation-two','Alex Example','10/3/2026','100%']
  ],{id:'original',importedAt:'2026-10-04'});
  const updated = parse('qa',[header,
    ['conversation-one','evaluation-one','Alex Example','10/3/2026','90%']
  ],{id:'updated',importedAt:'2026-10-05'});
  const first = data.aggregate({month:'2026-10',reps,qa:original,sources});
  assert.equal(first.metrics['alex example'].qaCount,2);
  assert.equal(first.metrics['alex example'].quality,.9);
  const result = data.aggregate({month:'2026-10',reps,qa:original.concat(updated),sources});
  assert.equal(result.metrics['alex example'].qaCount,2);
  assert.equal(result.metrics['alex example'].quality,.95);
});

test('checklist counts attendance once per matching item and corrective substring once per item', () => {
  const checklist = parse('checklist',[checklistHeader,
    ['Alex Example','10/1/2026','Absence / Tardy','Both terms','Final Written Warning','item-one'],
    ['Alex Example','10/8/2026','Other','Tardy arrival','Verbal coaching','item-two'],
    ['Alex Example','10/10/2026','Other','General note','Informal note','item-three'],
    ['Alex Example','9/30/2026','Absence','','Final Warning','outside']]);
  const result = data.aggregate({month:'2026-10',reps,checklist,sources});
  assert.equal(result.metrics['alex example'].attendance,2);
  assert.equal(result.metrics['alex example'].correctives,2);
  assert.equal(result.metrics['jordan sample'].attendance,0);
  assert.equal(result.metrics['jordan sample'].correctives,0);
});

test('missing checklist source differs from a source with no matching items', () => {
  const result = data.aggregate({month:'2026-10',reps});
  assert.equal(result.metrics['alex example'].attendance,null);
  assert.equal(result.metrics['alex example'].correctives,null);
  assert.ok(result.metrics['alex example'].issues.length);
});

test('invalid Wiper counts, zero offers and conflicting same-source rows stay unavailable', () => {
  const weekly = parse('weeklyReferral',[weeklyHeader,['10/7/2026','A','Alex Example',1,10],['10/7/2026','B','Alex Example',2,10],['10/7/2026','A','Jordan Sample',0,0]]);
  const result = data.aggregate({month:'2026-10',reps,weekly,sources});
  assert.equal(result.metrics['alex example'].wiperRate,null);
  assert.equal(result.metrics['jordan sample'].wiperRate,null);
  assert.match(result.diagnostics.join(' '),/Conflicting Wiper/);
});

test('Wiper uploads use Weekly Data Builder header, encoding and conflict parser', () => {
  const rows = [['Report title'],['Employee Name','Wipers Accepted','Wipers Asked','Wiper Count','Wiper Jobs'],['Example, Alex','4','20','999','1000']];
  const parsed = data.parseWiperRows(rows,{publicationDate:'2026-10-07'});
  assert.equal(parsed.rows[0].accepted,4);
  assert.equal(parsed.rows[0].offered,20);
  assert.equal(parsed.rows[0].key,'alex example');
  assert.throws(()=>data.parseWiperRows(rows),/publication date/);
});

test('multi-period Wiper uploads return choices without silently combining periods', () => {
  const rows = [['Name','Date','Wipers Accepted','Wipers Offered'],['Alex Example','10/7/2026',1,2],['Alex Example','10/14/2026',4,10]];
  const pending = data.parseWiperRows(rows,{});
  assert.equal(pending.requiresSelection,true);
  assert.deepEqual(pending.periods,['10/7/2026','10/14/2026']);
  const selected = data.parseWiperRows(rows,{period:'10/14/2026'});
  assert.equal(selected.rows.length,1);
  assert.equal(selected.rows[0].accepted,4);
  assert.equal(selected.rows[0].date,'2026-10-14');
});

test('history loader uses the scoped stream boundary and ignores superseded versions', async () => {
  const histories = {
    weeklyReferral:[{id:'week-one',importedAt:'2026-10-08'},{id:'replaced',supersededBy:'week-one'},{id:'week-two',importedAt:'2026-10-15'}],
    qa:[{id:'eval',importedAt:'2026-11-01'}], checklist:[{id:'items',importedAt:'2026-11-01'}]
  };
  const rows = {
    'week-one':[weeklyHeader,['10/7/2026','Coach One','Alex Example',2,10]],
    'week-two':[weeklyHeader,['10/14/2026','Coach One','Alex Example',5,10]],
    eval:[qaHeader,['Alex Example','10/8/2026','95%','eval-one']],
    items:[checklistHeader,['Alex Example','10/9/2026','Absence','','Written Warning','item-one']]
  };
  const calls = [];
  const appData = {ready:async()=>{},get:async()=>null,streamRows:async function*(type,opts){calls.push(opts);yield {sheetName:'Data',rowStart:0,rows:rows[opts.datasetId]};}};
  const storage = {getHistory:async(type)=>histories[type] || []};
  const result = await data.loadMonth('2026-10',reps,{appData,data:storage});
  assert.equal(calls.length,4);
  assert.ok(calls.every(call=>!call.scope&&!call.unscoped),'the application must not override the global read scope');
  assert.equal(result.metrics['alex example'].accepted,7);
  assert.equal(result.metrics['alex example'].quality,0.95);
  assert.equal(result.metrics['alex example'].correctives,1);
});

test('Retail fallback covers missing Referral weeks and Referral takes precedence on overlap', () => {
  const referral = parse('weeklyReferral',[weeklyHeader,['10/7/2026','A','Alex Example',2,10]]);
  const retail = parse('weeklyRetail',[weeklyHeader,['10/7/2026','A','Alex Example',9,10],['10/14/2026','A','Alex Example',3,10]]);
  const result = data.aggregate({month:'2026-10',reps,weekly:referral,retail,sources});
  assert.equal(result.metrics['alex example'].accepted,5);
  assert.equal(result.metrics['alex example'].offered,20);
});

test('known missing weeks are reported per person; unrelated uploads cannot create expected weeks', () => {
  const weekly = parse('weeklyReferral',[weeklyHeader,['10/7/2026','A','Alex Example',2,10],['10/14/2026','A','Alex Example',3,10],['10/7/2026','A','Jordan Sample',3,10]]);
  const uploads = [{fileName:'extra.csv',rows:parse('weeklyReferral',[weeklyHeader,['10/21/2026','A','Unrelated Person',9,10],['11/4/2026','A','Alex Example',9,10]])}];
  const result = data.aggregate({month:'2026-10',reps,weekly,sources,uploads});
  assert.deepEqual(result.weeks,['2026-10-07','2026-10-14']);
  assert.match(result.metrics['jordan sample'].issues.join(' '),/Missing Wiper data for 1/);
  assert.match(result.diagnostics.join(' '),/outside the monthly lane roster/);
  assert.match(result.diagnostics.join(' '),/outside 2026-10/);
});

test('monthly data ranks complete people in all five lanes without filling missing performance with zeros', () => {
  const core = require('../shared/verification-all-star-core.js');
  const roster = [], weekly = [weeklyHeader], qa = [qaHeader], lane3Values = {};
  for (let lane = 1; lane <= 5; lane++) {
    for (const kind of ['Eligible', 'Missing Quality', 'Missing Wipers', 'Missing VAPH']) {
      const name = kind + ' Lane ' + lane;
      roster.push({name, key:core.nameKey(name), coach:'Coach ' + lane, lane, vaph:kind === 'Missing VAPH' ? null : kind === 'Eligible' ? 0 : 100});
      if (lane === 3 && kind !== 'Missing VAPH') lane3Values[core.nameKey(name)] = kind === 'Eligible' ? 0 : 100;
      if (kind !== 'Missing Wipers') weekly.push(['10/7/2026','Coach ' + lane,name,kind === 'Eligible' ? 0 : 9,10]);
      if (kind !== 'Missing Quality') qa.push([name,'10/8/2026',kind === 'Eligible' ? '0%' : '99%',name + '-evaluation']);
    }
  }
  const monthly = data.aggregate({month:'2026-10',reps:roster,weekly:parse('weeklyReferral',weekly),qa:parse('qa',qa),sources});
  const report = core.buildReport({month:'2026-10',reps:roster,lane3Values,metrics:monthly.metrics,settings:{measures:['wipers','vaph','quality','attendance','correctives'],requireAllWiperWeeks:true}});
  assert.equal(report.rankedRows.length,5);
  assert.equal(report.excludedRows.length,15);
  assert.equal(report.winners.length,5);
  assert.ok(report.lanes.every(lane => lane.ready && lane.winners.length === 1));
  for (const winner of report.winners) {
    assert.match(winner.name,/^Eligible Lane/);
    assert.equal(winner.wipers,0,'A measured zero Wiper rate is valid, unlike a missing source.');
    assert.equal(winner.quality,0,'A scored zero is valid, unlike no evaluations.');
    assert.equal(winner.vaph,0,'A measured zero VAPH is valid.');
    assert.equal(winner.total,5);
    assert.deepEqual(Object.values(winner.ranks),[1,1,1,1,1]);
  }
  for (const excluded of report.excludedRows) {
    assert.equal(excluded.total,null);
    assert.equal(excluded.laneRank,null);
    assert.ok(Object.values(excluded.ranks).every(rank => rank === null));
    assert.ok(excluded.exclusionReasons.length);
  }
});

test('three-metric defaults retain 279 people despite missing checklist sources and incomplete weekly coverage', () => {
  const core = require('../shared/verification-all-star-core.js');
  const roster = [], weekly = [weeklyHeader], qa = [qaHeader], lane3Values = {};
  for (let index = 0; index < 279; index++) {
    const name = 'Example Representative ' + index, lane = index % 5 + 1;
    roster.push({name,key:core.nameKey(name),coach:'Example Coach',lane,vaph:10});
    if (lane === 3) lane3Values[core.nameKey(name)] = 10;
    weekly.push(['10/7/2026','Example Coach',name,4,10]);
    qa.push([name,'10/8/2026','95%','evaluation-' + index]);
  }
  weekly.push(['10/14/2026','Example Coach',roster[0].name,4,10]);
  const monthly = data.aggregate({month:'2026-10',reps:roster,weekly:parse('weeklyReferral',weekly),qa:parse('qa',qa)});
  const report = core.buildReport({month:'2026-10',reps:roster,lane3Values,metrics:monthly.metrics});
  assert.equal(report.rankedRows.length,279);
  assert.equal(report.excludedRows.length,0);
  assert.equal(report.eligibilityComparison.strictEligible,0);
  assert.equal(report.eligibilityComparison.threeMetricEligible,279);
  assert.equal(report.eligibilityComparison.recoveredByThreeMetrics,279);
  assert.ok(report.lanes.every(lane => lane.ready));
  assert.equal(monthly.metrics[roster[0].key].attendance,null,'Unavailable source values remain unknown.');
  assert.equal(monthly.metrics[roster[0].key].correctives,null);
  assert.ok(monthly.metrics[roster[1].key].issueDetails.some(issue => issue.code === 'missing-wiper-weeks' && issue.metric === 'wipers'));
  assert.ok(report.rankedRows.every(row => row.ranks.attendance === null && row.ranks.correctives === null && row.penalty === 0));
});

test('typed source issues identify the affected measure for configurable eligibility', () => {
  const monthly = data.aggregate({month:'2026-10',reps});
  const details = monthly.metrics['alex example'].issueDetails;
  assert.ok(details.some(issue => issue.code === 'missing-wipers' && issue.metric === 'wipers'));
  assert.ok(details.some(issue => issue.code === 'missing-quality' && issue.metric === 'quality'));
  assert.ok(details.some(issue => issue.code === 'attendance-source' && issue.metric === 'attendance'));
  assert.ok(details.some(issue => issue.code === 'correctives-source' && issue.metric === 'correctives'));
  assert.equal(details.length,monthly.metrics['alex example'].issues.length);
});

test('lane-specific required and ranked measures stay separate through monthly data aggregation', () => {
  const core = require('../shared/verification-all-star-core.js');
  const roster = [1,2,3].flatMap(lane => ['First','Second'].map((label,index) => ({name:'Lane '+lane+' '+label,lane,coach:'Example Coach',vaph:lane===3?999:20-index*10})));
  const weekly = parse('weeklyReferral',[weeklyHeader,
    ['10/7/2026','Example Coach','Lane 1 First',4,10],['10/7/2026','Example Coach','Lane 1 Second',3,10],
    ['10/7/2026','Example Coach','Lane 2 First',5,10]
  ]);
  const qa = parse('qa',[qaHeader,
    ['Lane 1 First','10/8/2026','90%','evaluation-one'],
    ...[2,3].flatMap(lane=>['First','Second'].map(label=>['Lane '+lane+' '+label,'10/8/2026','95%','evaluation-'+lane+'-'+label]))
  ]);
  const monthly = data.aggregate({month:'2026-10',reps:roster,weekly,qa});
  const report = core.buildReport({month:'2026-10',reps:roster,metrics:monthly.metrics,settings:{lanes:{
    '1':{requiredMeasures:['wipers'],rankedMeasures:['quality','vaph']},
    '2':{requiredMeasures:['quality'],rankedMeasures:['wipers']},
    '3':{requiredMeasures:['quality'],rankedMeasures:['vaph']}
  }}});
  assert.equal(report.excludedRows.length,0);
  assert.equal(report.rankedRows.length,6);
  const find = name => report.rows.find(row=>row.name===name);
  const first = find('Lane 1 First'), second = find('Lane 1 Second');
  assert.equal(first.ranks.wipers,null,'A required-only measure supplies no points.');
  assert.equal(first.total,2);
  assert.equal(second.quality,null,'Missing optional scored source values stay blank.');
  assert.equal(second.ranks.quality,2,'The missing optional score receives last-place points.');
  assert.equal(second.total,4);
  assert.equal(find('Lane 2 Second').ranks.wipers,2);
  assert.equal(find('Lane 2 Second').quality,.95);
  assert.equal(find('Lane 2 Second').ranks.quality,null);
  for(const label of ['First','Second']) {
    const row=find('Lane 3 '+label);
    assert.equal(row.vaph,null,'Lane 3 does not substitute monthly VAPH for the separate source.');
    assert.equal(row.ranks.vaph,1,'No observed optional scores means a joint last-place rank.');
    assert.equal(row.total,1);
    assert.equal(row.winner,true);
  }
});

test('undated attendance or corrective items remain unavailable instead of becoming zero', () => {
  const checklist = parse('checklist',[checklistHeader,['Alex Example','invalid date','Absence','','Written Warning','undated']]);
  const result = data.aggregate({month:'2026-10',reps,checklist,sources});
  assert.equal(result.metrics['alex example'].attendance,null);
  assert.equal(result.metrics['alex example'].correctives,null);
  assert.match(result.metrics['alex example'].issues.join(' '),/dates need review/);
});

test('UTF-16 TSV Wiper uploads decode using the Weekly Data Builder reader', async () => {
  const text = 'EMPLOYEE_FULL_NAME\tWIPERS_ACCEPTED\tWIPERS_OFFERED\r\nExample, Alex\t4\t20';
  const bytes = Buffer.concat([Buffer.from([255,254]),Buffer.from(text,'utf16le')]);
  const file = {name:'Wiper source.csv',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length)};
  const parsed = await data.parseWiperUpload(file,{publicationDate:'2026-10-07'});
  assert.equal(parsed.rows[0].accepted,4);
  assert.equal(parsed.rows[0].offered,20);
});

test('multi-sheet Excel uploads find a readable second sheet and retain choices for an irrelevant selection', async () => {
  const XLSX=require('../vendor/xlsx.full.min.js'),book=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Read Me'],['Instructions for the monthly upload']]),'Read Me');
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([weeklyHeader,['10/7/2026','Coach One','Alex Example',4,20]]),'Weekly Counts');
  const bytes=XLSX.write(book,{bookType:'xlsx',type:'array'}),file={name:'team.xlsx',size:bytes.byteLength,arrayBuffer:async()=>bytes};
  const parsed=await data.parseWiperUpload(file,{XLSX});
  assert.equal(parsed.selectedSheet,'Weekly Counts');
  assert.equal(parsed.rows[0].accepted,4);
  assert.deepEqual(parsed.sheets,['Read Me','Weekly Counts']);
  const irrelevant=await data.parseWiperUpload(file,{XLSX,sheet:'Read Me'});
  assert.equal(irrelevant.requiresSelection,true);
  assert.equal(irrelevant.selectedSheet,'Read Me');
  assert.deepEqual(irrelevant.sheets,['Read Me','Weekly Counts']);
  assert.equal(irrelevant.rows.length,0);
});

test('bad uploaded counts replace stored values with a blocking missing metric', () => {
  const weekly=parse('weeklyReferral',[weeklyHeader,['10/7/2026','Coach One','Alex Example',4,20]]);
  const parsed=data.parseWiperRows([weeklyHeader,['10/7/2026','Coach One','Alex Example','invalid',20]],{publicationDate:'2026-10-07'});
  const result=data.aggregate({month:'2026-10',reps,weekly,sources,uploads:[parsed]});
  assert.equal(result.metrics['alex example'].accepted,null);
  assert.equal(result.metrics['alex example'].wiperRate,null);
  assert.match(result.metrics['alex example'].issues.join(' '),/Wiper counts need review/);
  assert.match(result.diagnostics.join(' '),/not a valid statistic/);
});

test('scoped workbook warnings retain generic and selected-person issues without naming other representatives',()=>{
  const warnings=['Lane 3: Avg Cases per hr Salesforce header not found; using column D.',
    'Conflicting coaches in Phone Data for A Rep.','Conflicting coaches in Phone Data for B Rep.',
    'Lane 3: conflicting activity values for B Rep.','B Rep appears in more than one lane; review the monthly roster.'];
  const filtered=data.filterWarningsForRoster(warnings,[{name:'A Rep'}],true);
  assert.deepEqual(filtered,[warnings[0],warnings[1]]);
  assert.deepEqual(data.filterWarningsForRoster(warnings,[{name:'A Rep'}],false),warnings);
});

test('real CoachToolsData history and streamed chunks produce monthly metrics', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const idb = require('fake-indexeddb');
  const values = new Map();
  const context = vm.createContext({...idb,indexedDB:new idb.IDBFactory(),console,setTimeout,clearTimeout,queueMicrotask,structuredClone,TextEncoder,TextDecoder,
    localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},
    addEventListener(){},removeEventListener(){},dispatchEvent(){},CustomEvent:function(type,init){this.type=type;this.detail=init?.detail;}});
  context.window=context;context.parent=context;
  for (const file of ['weekly-data-builder-core.js','coachtools-storage.js','coachtools-app-data.js','verification-all-star-data.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'../shared',file),'utf8'),context,{filename:file});
  const store=context.CoachToolsData;
  await store.ready();
  const save=async(type,period,rows,suffix='')=>{
    const dock={meta:{fileName:type+suffix+'.csv'},workbook:{sheets:['Data'],data:{Data:{aoa:rows}}}};
    return store.importDataset(type,dock,{originalFileName:type+suffix+'.csv',detectedPeriod:{periodKey:period,sortKey:period,label:period},rowCount:rows.length-1,scopeSnapshot:{mode:'all',label:'All people'}});
  };
  const large=[weeklyHeader,...Array.from({length:12500},(_,index)=>['10/7/2026','A','Unrelated '+index,1,10]),['10/7/2026','A','Alex Example',2,10]];
  await save('weeklyReferral','2026-10-07',large);
  large[large.length-1][3]=4;
  await save('weeklyReferral','2026-10-07',large,'-corrected');
  await save('weeklyRetail','2026-10-14',[weeklyHeader,['10/14/2026','A','Alex Example',5,20]]);
  await save('qa','2026-11-01',[qaHeader,['Alex Example','10/8/2026','96%','qa-one']]);
  await save('checklist','2026-11-01',[checklistHeader,['Alex Example','10/9/2026','Tardy','','Final Written Warning','item-one']]);
  const history=await store.getHistory('weeklyReferral',{metadataOnly:true,activeOnly:true});
  assert.equal(history.length,1,'superseded import must be excluded by real store');
  assert.equal(history[0].chunked,true,'fixture exercises stored chunk streaming');
  const result=await context.VerificationAllStarData.loadMonth('2026-10',reps);
  assert.equal(result.metrics['alex example'].accepted,9);
  assert.equal(result.metrics['alex example'].offered,30);
  assert.equal(result.metrics['alex example'].quality,0.96);
  assert.equal(result.metrics['alex example'].attendance,1);
  assert.equal(result.metrics['alex example'].correctives,1);
  assert.equal(result.metrics['jordan sample'].attendance,0);
  assert.deepEqual(Array.from(result.weeks),['2026-10-07','2026-10-14']);
});
