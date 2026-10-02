'use strict';
const assert=require('node:assert/strict');
const {createHarness,plain}=require('./modernization-compatibility.test.js');
function fixture(coaches=3,weeks=12){
  const h=createHarness();h.run(`
    window.AllStarResearchWorkspace.init();
    const headers=['Date','Name','Sheet','Consumer Appointments','Consumer Opportunities','Insurance Apps','Insurance Opps','Commercial Appts','Commercial Opportunities'];
    const dates=Array.from({length:${weeks}},(_,i)=>ymd(new Date(Date.UTC(2026,6,19+i*7))));
    const coaches=Array.from({length:${coaches}},(_,i)=>'Coach '+String(i+1).padStart(2,'0'));
    const people=coaches.flatMap((coach,i)=>[0,1].map(rep=>({name:'Person '+i+' '+rep,coach,rep})));
    const rows=dates.slice().reverse().flatMap(Date=>people.map(p=>({Date,Name:p.name,Sheet:p.coach,'Consumer Appointments':p.rep?9:8,'Consumer Opportunities':p.rep?90:10,'Insurance Apps':p.rep?2:1,'Insurance Opps':4,'Commercial Appts':1,'Commercial Opportunities':2,_sourceKey:'weeklyRetail'})));
    state.data.weeklyRetail={headers,rows,config:window.AllStarDatedStats.defaultConfig('weeklyRetail',headers)};
    state.data.retail.controlRoster=people.map(p=>({_rep:p.name,_repKey:fullNameIdentityKey(p.name),_team:p.coach,sourceArea:'retail'}));
    state.sourceMeta.weeklyRetail={sourceVersion:1};state.orgs=[normalizeOrg({name:'Retail Coaches',coachNames:coaches})];
    invalidateRosterIndex('rates fixture');markDataIndexDirty('rates fixture',{sources:['weeklyRetail']});
    const setupRate=()=>{
      openResearchItemEditor(null);
      els.guidedPrimarySource.value='weeklyRetail';els.guidedResearchSubject.value='teams';els.guidedBreakdown.value='coach';els.guidedDisplay.value='line';
      state.editingResearchPopulationScope={includeOrgs:['Retail Coaches']};syncGuidedResearchToAdvanced();
      els.researchTypedMeasure.value='cash_appointment_rate';renderResearchTypedMeasureMeta();applyResearchTypedMeasureToEditor();
      return currentResearchItemFromEditor();
    };
  `);return h;
}
async function calculationsAndUi(){
  const h=fixture();try{
    h.run('const item=setupRate();');
    assert.match(h.run('els.researchTypedMeasureMeta.textContent'),/Available — Calculated/);
    assert.match(h.run('els.guidedCalculationGrid.textContent'),/Average of valid representative weekly rates/);
    assert.match(h.run('els.guidedCalculationGrid.textContent'),/3 possible Coach \/ Team lines/);
    assert.deepEqual(plain(h.run('[item.groupField,item.secondaryGroupField,item.valueMode,item.groupAggregation,item.zeroDenominator]')),['Date','_team','measure','average','blank']);
    assert.equal(h.run('validateResearchEditor()'),true);
    const result=plain(await h.run('evaluateResearchItemAsync(item)'));h.context.result=result;
    assert.equal(result.data.length,36);assert.ok(result.data.every(r=>Math.abs(r.values[0]-45)<1e-9));
    assert.equal(result.perf.calculationDiagnostics.chartSeries,3);assert.equal(result.perf.calculationDiagnostics.representativeWeekResults,72);
    assert.equal(h.run('AllStarCharts.buildDataset({type:"line",secondary:true,y:[0]},result).baseSeries'),3);
    const weighted=plain(await h.run('evaluateResearchItemAsync({...item,groupAggregation:"weighted"})'));
    assert.ok(weighted.data.every(row=>Math.abs(row.values[0]-17)<1e-9));
    const reconciled=plain(await h.run('evaluateResearchItemAsync({...item,reconcile:true})'));assert.equal(reconciled.reconciliation.ok,true);
    h.run("els.guidedSort.value='xAsc';activateGuidedResearch();");
    assert.equal(h.run('currentResearchItemFromEditor().valueField'),h.run('item.valueField'),'display changes cannot overwrite a selected measure');
    h.run("el('researchShowLinesFor').value='representatives';el('researchShowLinesFor').dispatchEvent(new Event('change',{bubbles:true}));state.editingResearchPopulationScope={includeReps:people.slice(0,3).map(p=>p.name)};");
    const reps=plain(await h.run('evaluateResearchItemAsync(currentResearchItemFromEditor())'));h.context.reps=reps;
    assert.equal(h.run('AllStarCharts.buildDataset({type:"line",secondary:true,y:[0]},reps).baseSeries'),3);
    assert.equal(reps.data.length,36);assert.deepEqual([...new Set(reps.data.map(r=>r.values[0]))].sort((a,b)=>a-b),[10,80]);
    for(const [id,expected] of [['insurance_appointment_rate',37.5],['commercial_appointment_rate',50]]){
      h.context.rateId=id;const segment=plain(await h.run('evaluateResearchItemAsync({...item,valueField:researchMeasureRef(rateId),measureId:rateId})'));
      assert.ok(segment.data.every(row=>row.values[0]===expected),id);
    }
    h.run("const expressionItem={...item,measureId:'',valueMode:'avg',valueField:'[Consumer Appointments] / [Consumer Opportunities]'};");
    const expression=plain(await h.run('evaluateResearchItemAsync(expressionItem)'));assert.ok(expression.data.every(r=>r.values[0]===45));
    assert.equal(h.run('aggregateResearchValue({...item,zeroDenominator:"blank"},[{...rows[0],"Consumer Appointments":0,"Consumer Opportunities":0}],null)'),null);
    assert.equal(h.run('aggregateResearchValue({...item,zeroDenominator:"zero"},[{...rows[0],"Consumer Appointments":0,"Consumer Opportunities":0}],null)'),0);
    assert.equal(h.run('aggregateResearchValue(item,[{...rows[0],"Consumer Appointments":"","Consumer Opportunities":50}],null)'),null);
    assert.equal(h.run('aggregateResearchValue(item,[{...rows[0],"Consumer Appointments":4,"Consumer Opportunities":5},{...rows[0],"Consumer Appointments":4,"Consumer Opportunities":5},{...rows[1],"Consumer Appointments":9,"Consumer Opportunities":90}],null)'),45,'split rows aggregate within representative/week before averaging reps');
    assert.deepEqual(h.errors,[]);console.log('PASS derived Consumer/Insurance/Commercial rates, UI choice persistence, rep/week before coach, average 45 vs weighted 17, three rep/coach series, expressions, zero/missing inputs');
  }finally{h.close();}
}
async function mappingDirectAndSaved(){
  const h=fixture(1,1);try{
    h.run(`
      state.data.weeklyRetail={headers:['Date','Name','Sheet','Consumer Appointment Rate'],config:{dateField:'Date',repField:'Name',coachField:'Sheet'},rows:rows.map((row,i)=>({Date:row.Date,Name:row.Name,Sheet:row.Sheet,'Consumer Appointment Rate':i?'10%':.8,_sourceKey:'weeklyRetail'}))};
      markDataIndexDirty('direct',{sources:['weeklyRetail']});const directItem=setupRate();
    `);
    assert.match(h.run('els.researchTypedMeasureMeta.textContent'),/Available — Direct field/);
    const direct=plain(await h.run('evaluateResearchItemAsync(directItem)'));assert.equal(direct.data[0].values[0],45);
    h.run(`state.data.weeklyRetail.config.fields={'Consumer Appointment Rate':{kind:'percentage',inputUnit:'percentage-points'}};`);
    assert.equal(h.run(`aggregateResearchValue(directItem,[{...state.data.weeklyRetail.rows[0],'Consumer Appointment Rate':.5}],null)`),.5,'declared sub-one percentage points must never be rescaled');
    h.run('delete state.data.weeklyRetail.config.fields;');
    const noWeights=plain(await h.run('evaluateResearchItemAsync({...directItem,groupAggregation:"weighted"})'));assert.equal(noWeights.data[0].values[0],null);assert.match(noWeights.perf.calculationDiagnostics.reason,/requires appointment and opportunity counts/);
    h.run(`
      state.data.weeklyRetail={headers:['Date','Name','Sheet','Booked','Consumer Opportunities'],config:{dateField:'Date',repField:'Name',coachField:'Sheet'},rows:rows.map(row=>({...row,Booked:row['Consumer Appointments']}))};
      noteCategorizationSourceVersion('weeklyRetail');markDataIndexDirty('manual',{sources:['weeklyRetail']});
      state.researchItems=[directItem];openResearchItemEditor(directItem.id);const missingItem=currentResearchItemFromEditor();els.researchTypedMeasure.value='cash_appointment_rate';renderResearchTypedMeasureMeta();
    `);
    assert.match(h.run('els.researchTypedMeasureMeta.textContent'),/missing Consumer Appointments/);
    assert.match(h.run('els.researchTypedMeasureMeta.textContent'),/✓ Consumer Opportunities/);
    assert.equal(h.run("els.researchTypedMeasure.querySelector('option[value=cash_appointment_rate]').hasAttribute('disabled')"),false,'missing rate remains selectable for mapping');
    const empty=plain(await h.run('evaluateResearchItemAsync(missingItem)'));h.context.empty=empty;
    assert.match(h.run('renderResearchResultByDisplay(missingItem,empty)'),/No graph could be produced/);
    assert.match(empty.perf.calculationDiagnostics.reason,/Consumer Appointments/);
    h.run("els.researchTypedMeasureMeta.querySelector('[data-map-rate]').onclick();el('researchRateName').value='Mapped appointments';el('researchRateNumerator').value='Booked';el('researchRateDenominator').value='Consumer Opportunities';");
    assert.equal(await h.run('saveResearchCalculatedRate()'),true);
    const mapped=plain(await h.run('evaluateResearchItemAsync(currentResearchItemFromEditor())'));assert.equal(mapped.data[0].values[0],45);
    h.run('const persistedMetric=normalizeMetric(JSON.parse(JSON.stringify(state.metrics.at(-1))));');
    assert.equal(h.run('persistedMetric.mode'),'representative_rate');assert.equal(h.run('persistedMetric.percentOfField'),'Consumer Opportunities');
    assert.equal(h.run('formatResearchValue(.5,{...currentResearchItemFromEditor(),decimals:1},{field:els.researchValueField.value,showAsPercent:true})'),'0.5%');
    for(const old of ['team','coach']){h.context.old=old;assert.deepEqual(plain(h.run('(()=>{const item=normalizeResearchItem({source:"weeklyRetail",guidedSubject:"coaches",guidedPercentageUnit:"coaches",guidedBreakdown:old});return [item.guidedSubject,item.guidedPercentageUnit,item.guidedBreakdown,item.showLinesFor];})()')),['teams','teams','coach','teams']);}
    assert.equal(h.run("[...els.guidedResearchSubject.options].filter(o=>/Coach|Team/.test(o.textContent)).length"),1);
    assert.equal(h.run("[...els.guidedBreakdown.options].filter(o=>/Coach|Team/.test(o.textContent)).length"),1);
    assert.deepEqual(h.errors,[]);console.log('PASS direct rates, missing-field diagnosis and mapping, persisted custom rate, percentage scale, safe Coach/Team migration');
  }finally{h.close();}
}
async function manyLinesAndMissing(){
  const h=fixture(23);try{
    h.run("state.data.weeklyRetail.rows=rows.filter(row=>!(row.Sheet===coaches[1]&&row.Date===dates[5]));const manyItem=setupRate();");
    const result=plain(await h.run('evaluateResearchItemAsync(manyItem)'));h.context.manyResult=result;
    assert.equal(result.data.length,275);assert.equal(result.perf.calculationDiagnostics.chartSeries,23);
    const chart=plain(h.run('AllStarCharts.buildDataset({type:"line",secondary:true,y:[0]},manyResult)'));
    assert.equal(chart.baseSeries,23);assert.equal(chart.series[1].points[5].value,null);
    assert.equal(h.run('researchLineSeries(manyResult.data,true).series[1].points[5]'),null,'legacy card/canvas projection preserves the same missing period');
    h.run('const lineSvg=renderResearchLineChart(manyItem,manyResult);');
    assert.equal(h.run('(lineSvg.match(/<circle/g)||[]).length'),275,'no fabricated zero markers');
    assert.equal(h.run('(lineSvg.match(/<path fill="none"/g)||[]).length'),24,'one missing period splits its series into two paths');
    assert.ok(h.run('lineSvg.includes(coaches[22])'),'last coach remains in legend');
    assert.deepEqual(h.errors,[]);console.log('PASS 23 coach lines across 12 weeks, null gap in both chart paths, every coach shown');
  }finally{h.close();}
}
async function uniquePercentageUi(){
  const h=fixture(23);try{
    h.run(`
      state.data.weeklyRetail.rows.push(...dates.flatMap(Date=>coaches.map(Sheet=>({Date,Sheet,Name:Sheet+' Third Person','Consumer Opportunities':0,_sourceKey:'weeklyRetail'}))));
      setupRate();els.guidedResearchQuestion.value='percentage';els.guidedPercentageUnit.value='unique_reps';
      state.editingGuidedResearchConditions=[{source:'weeklyRetail',field:'Consumer Opportunities',operator:'greater_than',value:1}];
      syncGuidedResearchToAdvanced();const uniqueItem=currentResearchItemFromEditor();
    `);
    assert.doesNotMatch(h.run('els.guidedCalculationGrid.textContent'),/Rep calculation/);
    const result=plain(await h.run('evaluateResearchItemAsync(uniqueItem)'));h.context.uniqueResult=result;
    assert.equal(result.data.length,23*12);assert.ok(result.data.every(row=>Math.abs(row.values[0]-200/3)<1e-9));
    assert.equal(h.run('AllStarCharts.buildDataset({type:"line",secondary:true,y:[0]},uniqueResult).baseSeries'),23);
    const snapshot=h.run('researchCompactRenderedResult(uniqueItem,uniqueResult)');h.context.snapshot=snapshot;
    h.run('const savedItem={...uniqueItem,renderedResult:{outputType:"line",renderedAt:new Date().toISOString(),result:snapshot}};');
    assert.doesNotMatch(h.run('researchStoredResultBody(savedItem)'),/Results may be stale/);
    h.run("noteCategorizationSourceVersion('weeklyRetail');");
    assert.match(h.run('researchStoredResultBody(savedItem)'),/Results may be stale — Run to refresh/);
    assert.equal(h.run('normalizePercentBuilder({unit:"unique_coaches"}).unit'),'unique_teams');
    assert.deepEqual(h.errors,[]);console.log('PASS full UI → definition → 66.7% unique representatives → 23 coach series, retained result diagnostics and stale-source status');
  }finally{h.close();}
}
async function setupAndPreviewBudgets(){
  const h=fixture(2);try{
    h.run(`
      const huge=Array.from({length:50000},(_,i)=>({...rows[i%rows.length]}));let reads=0,queries=0;
      state.data.weeklyRetail.rows=new Proxy(huge,{get(target,key,receiver){if(/^\\d+$/.test(String(key)))reads++;return Reflect.get(target,key,receiver);}});
      state.dataIndex={dirty:true,sources:{},reps:[],teamCounts:[]};state.teamIndexCache=null;
      const originalQuery=buildQueryPlan;buildQueryPlan=(...args)=>{queries++;return originalQuery(...args);};
      const coldItem=setupRate();
      state.editingResearchPopulationScope={includeOrgs:['Retail Coaches']};renderResearchPopulationEditor();updateGuidedResearchUi();
      els.researchTypedMeasure.value='insurance_appointment_rate';renderResearchTypedMeasureMeta();applyResearchTypedMeasureToEditor();
      el('researchShowLinesFor').value='representatives';el('researchShowLinesFor').dispatchEvent(new Event('change',{bubbles:true}));
      els.guidedDisplay.value='bar';activateGuidedResearch();els.guidedDisplay.value='line';activateGuidedResearch();
      els.guidedMeasureField.value='[Consumer Appointments] / [Consumer Opportunities]';activateGuidedResearch();
      state.editingResearchFilters=[{type:'team_is',teamInput:'$Retail Coaches'},{field:'Sheet',op:'contains',value:''}];renderResearchFiltersEditor();
      const filterInput=els.researchFilters.querySelector('[data-rf="value"]');if(filterInput){filterInput.value='Coach';filterInput.oninput();}
      state.editingResearchFilters=[];renderResearchFiltersEditor();
      state.researchItems=[{...coldItem,id:'saved',renderedResult:{outputType:'line',renderedAt:new Date().toISOString(),result:{data:[],columns:[],warnings:[],valueOnly:true,hasSecondary:true}}}];
    `);
    await h.run('renderResearchCanvasAsync({reason:"open"})');
    h.run('persistResearchItemsToLocalStorage();');
    await h.run('openResearchWorkspace()');
    await new Promise(resolve=>setTimeout(resolve,300));
    assert.equal(h.run('reads'),0,'opening, metric/formula/series/display/organization edits and saved results use metadata only');assert.equal(h.run('queries'),0);
    h.run('reads=0;');await h.run('renderResearchFoundPreview()');assert.equal(h.run('reads'),500);assert.equal(h.run('queries'),0);
    assert.match(h.run('els.researchFoundPreview.textContent'),/Sample Preview — not full results/);
    assert.match(h.run('els.researchFoundPreview.textContent'),/sample series/);
    h.run("reads=0;els.researchTypedMeasure.value='cash_appointment_rate';");await h.run('previewResearchMeasureSamples()');assert.equal(h.run('reads'),500,'rate preview has the same hard source-row budget');assert.equal(h.run('queries'),0);
    assert.match(h.run('els.researchMeasureSamplePreview.textContent'),/Sample Preview — not full results/);
    assert.deepEqual(h.errors,[]);console.log('PASS cold workspace and all setup changes read zero statistical rows; both previews read exactly 500 of 50,000 and do not run a full query');
  }finally{h.close();}
}
module.exports={fixture};
if(require.main===module)(async()=>{await calculationsAndUi();await mappingDirectAndSaved();await manyLinesAndMissing();await uniquePercentageUi();await setupAndPreviewBudgets();})().catch(error=>{console.error(error);process.exitCode=1;});
