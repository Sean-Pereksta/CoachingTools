'use strict';
const assert=require('node:assert/strict');
const E=require('../js/dated-stats.js');
const {createHarness,plain}=require('./modernization-compatibility.test.js');
const headers=['Date','Sheet','Name','Total Opportunities','Total Appointments','Consumer Opportunities','Consumer Appointments','Insurance Opportunities','Insurance Appointments','Commercial Opportunities','Commercial Appointments','Wiper Jobs','Wiper Count','Wiper Rate'];
const config=()=>({...E.defaultConfig('weeklyRetail',headers),calendar:{reviewed:true,frequency:'week',label:'ending',offsetDays:0}});
const row=(name,date,opp,appt,extra={})=>({Name:name,Sheet:'Alpha',Date:date,'Total Opportunities':opp,'Total Appointments':appt,'Consumer Opportunities':opp,'Consumer Appointments':appt,'Insurance Opportunities':0,'Insurance Appointments':0,'Commercial Opportunities':0,'Commercial Appointments':0,...extra});
const pack=rows=>E.categorize(rows,config(),{headers});
const metric=extra=>E.normalizeMetric({id:'ar',name:'Appointment Rate',source:'weeklyRetail',statistic:'total_ar',...extra});
function numbers(){
  assert.equal(E.cell('1,200',{kind:'count'}).value,1200);
  assert.equal(E.cell('0',{kind:'count'}).value,0);
  assert.equal(E.cell('',{kind:'count'}).status,'missing');
  assert.equal(E.cell('N/A').status,'unavailable');assert.equal(E.cell('*').status,'suppressed');
  assert.equal(E.cell('-1',{kind:'count'}).status,'invalid');
  assert.equal(E.cell('-5',{kind:'number',nonnegative:false}).value,-5);
  assert.equal(E.cell('.5625',{kind:'percentage',inputUnit:'fraction'}).value,56.25);
  assert.equal(E.cell('56.25%',{kind:'percentage',inputUnit:'fraction'}).value,56.25);
  assert.equal(E.cell('01:30',{kind:'duration',inputUnit:'seconds'}).value,90);
  assert.equal(E.cell('.5',{kind:'duration',inputUnit:'days'}).value,43200);
  assert.equal(E.cell('120',{kind:'percentage',inputUnit:'percentage-points'}).status,'invalid');assert.ok(Number.isNaN(E.day('2/30/2026')));
  const observations=pack([row('A','2026-09-06',1,1),row('B','2026-09-06',100,50)]).observations;
  assert.equal(E.aggregate(observations,metric()).value,75);
  assert.equal(E.aggregate(observations,metric({aggregation:'combined_rate'})).value,51/101*100);
  const many=pack([row('A','2026-09-06',10,10),row('A','2026-09-13',10,0),row('B','2026-09-06',10,10)]).observations;
  assert.equal(E.aggregate(many,metric()).value,75,'representatives with more weeks must not receive extra weight');
  assert.equal(E.aggregate(pack([row('A','2026-09-06',80,45)]).observations,metric({statistic:'',field:'Total Appointments',kind:'count',aggregation:'sum'})).value,45);
  assert.throws(()=>metric({aggregation:'sum'}),/cannot be summed/);
  assert.throws(()=>E.normalizeMetric({field:'Balance',behavior:'snapshot',aggregation:'sum'}),/cannot be summed/);
  assert.equal(E.aggregate(pack([row('A','2026-09-06',10,0)]).observations,metric()).value,0);
  assert.equal(E.aggregate(pack([row('A','2026-09-06',0,0)]).observations,metric()).value,null);
  assert.equal(E.aggregate(pack([row('A','2026-09-06',null,2)]).observations,metric()).value,null);
  const cash=pack([row('A','2026-09-06',80,40,{'Consumer Opportunities':20,'Consumer Appointments':5,'Insurance Opportunities':50,'Commercial Opportunities':10})]).observations;
  assert.equal(E.aggregate(cash,metric({statistic:'consumer_share'})).value,25);
  assert.equal(E.aggregate(cash,metric({statistic:'consumer_ar'})).value,25);
  cash[0].values['Commercial Opportunities'].status='missing';assert.equal(E.aggregate(cash,metric({statistic:'consumer_share'})).value,null,'do not infer cash from non-insurance');
  const retail=pack([row('A','2026-09-06','','',{'Wiper Jobs':20,'Wiper Count':4})]);
  assert.equal(E.aggregate(retail.observations,metric({statistic:'wiper_rate'})).value,20);
  const referralHeaders=['Date','Sheet','Name','Wipers Asked','Wipers Accept','Wiper Rate'],rc={...E.defaultConfig('weeklyReferral',referralHeaders),calendar:config().calendar};
  const referral=E.categorize([{Date:'2026-09-06',Sheet:'A',Name:'B','Wipers Asked':10,'Wipers Accept':3,'Wiper Rate':.3}],rc,{headers:referralHeaders});
  assert.equal(E.aggregate(referral.observations,metric({source:'weeklyReferral',statistic:'wiper_rate'})).value,30);
  console.log('PASS typed counts, percentage formats, durations, valid zeros, missing states, Cash definitions and distinct wiper mappings');
}
function calendarDuplicatesAndTrends(){
  assert.throws(()=>E.period('2026-09-20',{}),/Review/);
  assert.equal(E.period('2026-09-20',config().calendar).start,'2026-09-14');
  assert.equal(E.period('2026-09-20',{...config().calendar,label:'beginning'}).end,'2026-09-26');
  assert.equal(E.period('2026-09-22',{...config().calendar,label:'publication',offsetDays:-8}).start,'2026-09-14');
  const a=row('A','2026-09-06',10,4),b=row('A','2026-09-13',10,6);
  assert.equal(pack([a,b]).diagnostics.conflicts,0);assert.equal(pack([a,a]).observations.length,1);
  assert.equal(pack([a,{...a,'Total Appointments':9}]).observations[0].conflict,true);
  assert.equal(pack([a,{...b,Date:'2026-09-10'}]).diagnostics.conflicts,1);
  assert.equal(pack([a,row('AGENT_NAME','2026-09-06',10,5),row('Grand Total','2026-09-06',10,5)]).observations.length,1);
  let merged=E.mergeRows([a],[a,b],config(),{fileName:'first.csv'});assert.equal(merged.rows.length,2);assert.equal(merged.counts.duplicates,1);
  merged=E.mergeRows(merged.rows,[{...a,'Total Appointments':5}],config(),{fileName:'correction.csv'});assert.equal(merged.rows.length,2);assert.equal(merged.audit[0].fields.find(f=>f.field==='Total Appointments').before,4);
  const partial=E.mergeRows(merged.rows,[{Name:'A',Sheet:'Alpha',Date:'2026-09-06','Wiper Jobs':10,'Wiper Count':2}],config());assert.equal(partial.rows[0]['Total Appointments'],5);
  const conflicting=E.mergeRows([],[a,{...a,'Total Appointments':7}],config());assert.equal(conflicting.counts.conflicts,1);assert.equal(pack(conflicting.rows).observations[0].conflict,true);
  const extended=E.mergeRows(conflicting.rows,[b],config());assert.equal(pack(extended.rows).observations.find(o=>o.period.end==='2026-09-06').conflict,true,'unrelated imports must preserve unresolved conflicts');
  const resolved=E.mergeRows(extended.rows,[{...a,'Total Appointments':6}],config());assert.equal(pack(resolved.rows).observations[0].conflict,undefined);assert.ok(resolved.audit.some(a=>a.reason?.includes('conflicting')));
  const points=E.series(pack([row('A','2026-09-06',10,1),row('A','2026-09-20',10,5)]).observations,metric());
  assert.deepEqual(points.map(p=>p.value),[10,null,50]);assert.equal(E.trend(points).slope,20,'slope uses elapsed weeks, not row positions');
  const sparseRows=pack([row('A','2026-09-06',10,1),row('A','2026-09-20',10,5)]).observations;
  assert.equal(E.aggregate(sparseRows,metric({lastPeriods:2})).value,50,'last reporting periods include missing calendar weeks');
  assert.deepEqual(E.series(sparseRows,metric({lastPeriods:2})).map(p=>p.value),[null,50]);
  assert.equal(E.aggregate(sparseRows,metric({lastPeriods:2,periodSelection:'valid'})).value,30,'last valid periods skip gaps explicitly');
  assert.equal(E.criterion(sparseRows,metric(),{mode:'trend',summary:'slope'}).unit,'percentage points / week');
  assert.equal(E.criterion(sparseRows,metric(),{mode:'trend',summary:'validPeriods'}).unit,'periods');
  assert.equal(E.trend([{...points[0],value:0},points[2]]).relativeChange,null);
  assert.equal(E.trend([points[0]]).change,null);
  const result=E.criterion(pack([a,b,row('A','2026-09-20',10,3),row('A','2026-09-27',10,4)]).observations,metric(),{mode:'qualifying_periods',lastPeriods:4,operator:'lt',threshold:50,requiredPeriods:3,minPeriods:4});
  assert.equal(result.value,3);assert.equal(result.pass,true);
  assert.throws(()=>E.criterion(pack([a,b]).observations,metric(),{mode:'comparison_change'}),/distinct ordered/);
  assert.equal(E.formula('[A] / [B]',{A:{value:8,status:'valid'},B:{value:2,status:'valid'}}),4);
  assert.throws(()=>E.formula('![Other].[A]',{}),/Use/);assert.throws(()=>E.formula('[Absent] + 1',{}),/same source and period/);
  assert.throws(()=>E.formula('globalThis.x=1',{}),/Use/);
  console.log('PASS reviewed calendars, historical periods, conflicts, correction audit, partial updates, true gaps, elapsed-week slopes and safe expressions');
}
async function cohorts(){
  const observations=pack([row('A','2026-09-06',10,4),row('B','2026-09-06',20,10),row('A','2026-09-13',10,6),row('B','2026-09-13',20,12),row('A','2026-09-20',10,8)]).observations;
  const sessions=[{id:'one',source:'documented_coaching',repId:'a',date:'2026-09-02',topics:['Wipers']},{id:'one',source:'documented_coaching',repId:'a',date:'2026-09-02',topics:['Quality']},{id:'two',source:'documented_coaching',repId:'a',date:'2026-09-03',topics:['Wipers']},{id:'three',source:'documented_coaching',repId:'a',date:'2026-09-04',topics:['Wipers']},{id:'four',source:'documented_coaching',repId:'b',date:'2026-09-09',topics:['Wipers']}];
  assert.equal(E.dedupeEvents(sessions).length,4);
  const coverage={complete:true,start:'2026-08-01',end:'2026-10-01'},base={anchorStart:'2026-08-31',anchorEnd:'2026-09-06',coverage,groupBy:'coaching_frequency',frequencyWindow:'anchor',eventConditions:[]};
  const result=await E.research(observations,metric({statistic:'',field:'Total Appointments',kind:'count',aggregation:'sum'}),base,sessions);
  assert.equal(result.data.find(p=>p.label==='2026-08-31'&&p.line==='3 sessions').value,4,'three sessions do not triple the numerical contribution');
  assert.equal(result.data.find(p=>p.label==='2026-08-31'&&p.line==='0 sessions').value,10);
  const unknown=await E.research(observations,metric(),{...base,coverage:{}},sessions);assert.ok(unknown.data.every(p=>p.line==='Unknown coaching coverage'));
  const observed=E.eventSummary(E.dedupeEvents(sessions),'a',{start:'2026-09-01',end:'2026-09-06'},{},{});
  assert.equal(E.eventConditionPass(observed,{operator:'gte',threshold:2}),true);
  assert.equal(E.eventConditionPass(observed,{operator:'eq',threshold:3}),false,'incomplete coverage cannot prove an exact session count');
  const filter={source:'documented_coaching',operator:'gte',threshold:1};
  const fixed=await E.research(observations,metric(),{...base,groupBy:'all',eventConditions:[filter],mode:'fixed'},sessions);
  assert.ok(fixed.data.every(p=>p.members.length===1&&p.members[0]==='a'));
  const changing=await E.research(observations,metric(),{...base,groupBy:'all',eventConditions:[filter],mode:'changing'},sessions);
  assert.deepEqual(changing.data.map(p=>p.members),[['a'],['b']]);
  assert.deepEqual(changing.axisLabels,['2026-08-31','2026-09-07','2026-09-14'],'periods without qualifying members still occupy the chart axis');
  const grouped=await E.research(observations,metric(),{...base,groupBy:'coach',coaches:['Alpha'],organizations:[{name:'One',coaches:['Alpha']},{name:'Two',coaches:['Alpha']}]},sessions);
  assert.equal(grouped.data[0].eligibleRepresentatives,2);
  const aligned=await E.research(observations,metric(),{...base,mode:'before_after',groupBy:'all',beforeWeeks:1,afterWeeks:2,coachingSource:'documented_coaching'},sessions);
  assert.equal(aligned.data.find(p=>p.relativeWeek===0).label,'Coaching week (mixed timing)');assert.equal(aligned.data.find(p=>p.relativeWeek===1).value,60);
  const sparse=E.series(observations,metric({minValidPeriods:3}));assert.equal(sparse[0].eligibleRepresentatives,1,'minimum weeks applies before each plotted value');
  assert.match(sparse[0].exclusions.find(e=>e.repId==='b').reason,/Requires 3 valid periods/);
  const transfer=pack([row('A','2026-09-06',10,4),row('A','2026-09-13',10,9,{Sheet:'Outside'}),row('B','2026-09-06',10,5)]).observations;
  const restricted=await E.research(transfer,metric(),{...base,groupBy:'coach',coaches:['Alpha'],mode:'fixed'},sessions);
  assert.ok(restricted.data.every(p=>p.line==='Alpha'),'a later transfer cannot introduce coaches outside the selected organizations');
  assert.equal(restricted.data[1].value,null);assert.equal(restricted.data[1].members.length,2,'the fixed cohort remains visible even when members lack in-scope data');
  assert.match(restricted.data[1].exclusions.find(e=>e.repId==='a').reason,/outside the selected population/);
  await assert.rejects(E.research(observations,metric(),base,sessions,{cancelled:()=>true}),{name:'AbortError'});
  await assert.rejects(E.categorizeAsync([row('A','2026-09-06',10,4)],config(),{headers,cancelled:()=>true}),{name:'AbortError'});
  console.log('PASS distinct sessions, fan-out protection, unknown coverage, fixed/changing populations, organization overlap, before/after timing and cancellation');
}
async function integration(){
  const h=createHarness();
  try{
    h.context.rows=[row('Alice Able','2026-09-06',10,4),row('Alice Able','2026-09-13',20,12),row('Bob Baker','2026-09-06',40,20)];h.context.headers=headers;h.context.config=config();
    h.run(`state.data.weeklyRetail={fileName:'fixture.csv',headers,rows:rows.map(r=>({...r,_rep:r.Name,_repKey:fullNameIdentityKey(r.Name),_team:r.Sheet,_sourceKey:'weeklyRetail'})),config,audit:[]};noteCategorizationSourceVersion('weeklyRetail');initDatedStatsWorkspace();`);
    const result=await h.run(`categorizeImportedData({manual:true,triggerEvent:{type:'click',isTrusted:true,currentTarget:els.categorizeDataBtn},persist:false,throwErrors:true})`);
    assert.equal(result,true);assert.equal(h.run(`datedStatsCategory('weeklyRetail').observations.length`),3);
    assert.equal(h.run(`state.categorized.dated.rows.length`),0,'numerical observations never become coaching events');
    h.run(`state.metrics=[normalizeMetric({id:'weekly-ar',name:'Weekly AR',mode:'datedStats',source:'weeklyRetail',statistic:'total_ar'})];`);
    assert.equal(h.run(`evaluateMetric(state.metrics[0],getRowsRaw('weeklyRetail'),'weeklyRetail')`),50);
    h.run(`const criterion=normalizeCriterionForStorage({id:'ds-criterion',name:'Trend',calcType:'datedStats',source:'weeklyRetail',datedStatsMetricId:'weekly-ar',datedStatsRule:{mode:'trend',summary:'change'},scoreType:'display',audience:'rep',zeroCanWin:true});`);
    assert.equal(h.run(`criterionValue(criterion,{kind:'rep',key:fullNameIdentityKey('Alice Able'),name:'Alice Able',team:'Alpha'},{})`),20);
    h.run(`state.data.documented_coaching.headers=['Coaching Date','Description','Session ID'];state.data.documented_coaching.rows=[{_rep:'Alice Able',_repKey:fullNameIdentityKey('Alice Able'),'Coaching Date':'9/2/26',Description:'Wipers','Session ID':'session-one'},{_rep:'Alice Able',_repKey:fullNameIdentityKey('Alice Able'),'Coaching Date':'9/2/26',Description:'Wipers followup tag','Session ID':'session-one'}];`);
    assert.equal(h.run(`datedStatsEvents().length`),1,'existing short formatted event dates use the established event parser');
    assert.equal(h.run(`criterionValue({...criterion,datedStatsRule:{mode:'aggregate',startDate:'2026-09-07',endDate:'2026-09-13'},datedStatsEventConditions:[{source:'documented_coaching',topic:'Wipers',operator:'gte',threshold:1,startDate:'2026-08-31',endDate:'2026-09-06'}]},{kind:'rep',key:fullNameIdentityKey('Alice Able'),name:'Alice Able',team:'Alpha'},{})`),60,'event qualification and subsequent numerical periods remain independent');
    assert.equal(h.run(`criterionValue(criterion,{kind:'rep',key:fullNameIdentityKey('Alice Able'),name:'Alice Able',sourceArea:'referral'},{})`),null,'a different roster area cannot borrow Retail measurements');
    assert.equal(h.run(`normalizeCriterionForStorage(criterion).calcType`),'datedStats');
    h.run(`state.models.push({id:'ds-model',name:'Dated Stats model',criteria:[criterion]});openEditModel('ds-model');`);
    assert.ok(h.context.document.querySelector('[data-dsr="mode"]'));
    h.run(`openDatedStatsMetricEditor('weekly-ar');`);assert.ok(h.context.document.querySelector('[data-ds="aggregation"]'));
    h.run(`const item=normalizeResearchItem({id:'ds-research',title:'Weekly AR',source:'weeklyRetail',outputType:'line',datedStats:{version:1,metricId:'weekly-ar',mode:'fixed',groupBy:'coach'}});state.researchItems=[item];`);
    const research=await h.run(`evaluateDatedStatsResearch(item)`);assert.deepEqual(plain(research.data.map(p=>p.value)),[45,60]);
    assert.equal(await h.run(`researchSaveRenderedResult(item,${JSON.stringify(plain(research))})`),true);
    const restored=await h.run(`researchRenderedResultGet('ds-research')`);assert.equal(restored.definition.metric.aggregation,'equal_rep');assert.ok(restored.data[0].contributions.length);assert.ok(restored.savedAt);
    h.run(`state.data.weeklyRetail.rows[0]['Total Appointments']=9;noteCategorizationSourceVersion('weeklyRetail');`);
    assert.throws(()=>h.run(`datedStatsCategory('weeklyRetail')`),/Categorize/);
    const frozen=await h.run(`researchRenderedResultGet('ds-research')`);assert.equal(frozen.data[0].value,45,'opening saved results does not refresh');
    h.run(`const pkg=buildAllStarJsonPackage();const staged=stageAllStarJsonPackage(pkg,'backup.json');`);
    assert.equal(h.run(`staged.nextData.weeklyRetail.config.calendar.label`),'ending');assert.equal(h.run(`staged.categorized.stats.sources.weeklyRetail.observations.length`),3);
    h.run(`state.data.retail.controlRoster=[{_rep:'Same Name',_team:'One'},{_rep:'Same Name',_team:'Two'}];invalidateRosterIndex('identity fixture');`);
    assert.match(h.run(`datedStatsIdentity('Same Name','weeklyRetail').reason`),/multiple roster identities/);
    console.log('PASS actual manual categorization, metric/model integration, shared keys, source isolation, saved evidence and frozen Research snapshots');
  }finally{h.close();}
}

async function importAndStorage(){
  const h=createHarness();
  try{
    h.context.headers=headers;h.context.config=config();
    h.context.firstRows=[row('Alice Able','2026-09-06',10,4),row('Alice Able','2026-09-13',20,12)];
    h.run(`const workbook=rs=>({SheetNames:['Weekly'],Sheets:{},__coachToolsAoaBySheet:{Weekly:[headers,...rs.map(r=>headers.map(h=>r[h]??''))]}});`);
    assert.equal(await h.run(`loadDatedStatsFile('weeklyRetail',{name:'first.csv',size:1},{workbook:workbook(firstRows),config})`),true);
    assert.equal(h.run(`state.data.weeklyRetail.rows.length`),2);
    assert.equal(await h.run(`loadDatedStatsFile('weeklyRetail',{name:'correction.csv',size:1},{workbook:workbook([{...firstRows[0],'Total Appointments':7}]),config})`),true);
    assert.equal(h.run(`state.data.weeklyRetail.rows.length`),2);
    assert.equal(h.run(`state.data.weeklyRetail.rows[0]['Total Appointments']`),7);
    assert.equal(h.run(`state.data.weeklyRetail.audit.length`),1);
    assert.equal(await h.run(`loadDatedStatsFile('weeklyRetail',{name:'again.csv',size:1},{workbook:workbook([{...firstRows[0],'Total Appointments':7}]),config})`),true);
    assert.equal(h.run(`state.data.weeklyRetail.lastImport.duplicates`),1);
    const stored=await h.run(`(async()=>{const db=await importCacheOpenDb();const r=await idbReq(db.transaction(IMPORT_CACHE_SOURCE_STORE,'readonly').objectStore(IMPORT_CACHE_SOURCE_STORE).get('weeklyRetail'));db.close();return r;})()`);
    assert.equal(stored.value.rows.length,2);assert.equal(stored.value.config.calendar.label,'ending');assert.equal(stored.value.audit.length,1);
    h.run(`state.data.weeklyRetail={fileName:'',rows:[],headers:[]};`);
    assert.equal(await h.run(`loadImportedDataFromIndexedDB({deferRender:true})`),true);
    assert.equal(h.run(`state.data.weeklyRetail.rows.length`),2);
    // Shared source replacement honors its active population; a single-week
    // direct upload above, in contrast, preserves other historical periods.
    h.run(`state.centralSyncGeneration=0;window.CoachToolsData={ready:async()=>{},getDatasetVersion:type=>type==='weeklyRetail'?{datasetId:'weekly-v2',version:2}:null,getCurrent:async()=>({originalFileName:'shared.csv',data:{meta:{datedStatsConfig:config},workbook:{sheets:['Weekly'],data:{Weekly:{aoa:[headers,...[{...firstRows[1],Name:'Bob Baker'}].map(r=>headers.map(h=>r[h]??''))]}}}}})};`);
    const synced=await h.run(`syncAllStarFromCoachToolsData({persist:false,render:false})`);
    assert.equal(synced.changed,true);assert.equal(h.run(`state.data.weeklyRetail.rows.length`),1);assert.equal(h.run(`state.data.weeklyRetail.rows[0].Name`),'Bob Baker');
    // A failed source must not discard committed history.
    const before=h.run(`JSON.stringify(state.data.weeklyRetail)`);
    assert.equal(await h.run(`loadDatedStatsFile('weeklyRetail',{name:'bad.csv',size:1},{workbook:{SheetNames:['Bad'],Sheets:{},__coachToolsAoaBySheet:{Bad:[['Wrong'],['No rows']]}},silent:true})`),false);
    assert.equal(h.run(`JSON.stringify(state.data.weeklyRetail)`),before);
    console.log('PASS direct uploads, overlap correction, repeated imports, IndexedDB read-back/reopen, shared weekly source replacement and failed-import rollback');
  }finally{h.close();}
}
function mixedUnitsAndOutputs(){
  const cfg=config();cfg.fields.Rate={kind:'percentage',inputUnit:'per-date',unitsByDate:{'2026-09-06':'fraction','2026-09-13':'percentage-points'}};
  const obs=E.categorize([row('A','2026-09-06',10,1,{Rate:.8}),row('A','2026-09-13',10,2,{Rate:80}),row('A','2026-09-20',10,3,{Rate:1})],cfg,{headers:[...headers,'Rate']}).observations;
  assert.deepEqual(obs.map(o=>o.values.Rate.value),[80,80,null]);assert.match(obs[2].values.Rate.reason,/unit needs review/);
  const m=metric({statistic:'',field:'Rate',kind:'percentage',output:'series'});
  assert.throws(()=>E.metricResult(obs,m,{scalar:true}),/series/);
  assert.deepEqual(E.metricResult(obs,m).points.map(p=>p.value),[80,80,null]);
  assert.equal(E.metricResult(obs,{...m,output:'summary',summary:'change'}).value,0);
  assert.equal(E.cell('150',{kind:'percentage',inputUnit:'percentage-points',bounded:false}).value,150,'activity-to-call ratios can exceed 100%');
  console.log('PASS reviewed per-date mixed units, unknown unit exclusions, series/scalar protection and reusable trend summaries');
}

(async()=>{numbers();calendarDuplicatesAndTrends();mixedUnitsAndOutputs();await cohorts();await integration();await importAndStorage();})().catch(e=>{console.error(e);process.exitCode=1;});
