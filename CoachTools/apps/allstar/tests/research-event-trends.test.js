'use strict';
const assert=require('node:assert/strict');
const {createHarness,plain}=require('./modernization-compatibility.test.js');

async function coachingTrends(){
  const h=createHarness();
  try{
    h.run(`
      window.AllStarResearchWorkspace.init();
      const headers=['Team Coaching','Associate name','Job Coach','Coaching Date','Documented Coaching Condition'];
      const input=[
        ['','Amy','Coach A','2026-08-03','save the sale'],
        ['Yes','Amy','Coach A','2026-08-05','STS'],
        ['','Ben','Coach B','2026-08-07','Saving the sale'],
        ['Yes','Amy','Coach A','2026-08-12','STS follow-up'],
        ['','Ben','Coach B','2026-08-13','save the sale'],
        ['','Ben','Coach B','2026-09-08','Saving the sale'],
        ['Yes','Ben','Coach B','2026-09-08','Cash rate'],
        ['','Cal','Coach C','2026-08-03','STS'],
        ['','Amy','Coach A','2026-07-01','STS']
      ];
      state.data.documented_coaching={headers,rows:input.map(values=>Object.fromEntries(headers.map((key,i)=>[key,values[i]])))};
      state.sourceMeta.documented_coaching={sourceVersion:1};
      state.orgs=[normalizeOrg({name:'Retail team',coachNames:['Coach A','Coach B']})];
      markDataIndexDirty('event trend fixture',{sources:['documented_coaching']});
      openResearchItemEditor(null);
      els.guidedPrimarySource.value='documented_coaching';els.guidedResearchSubject.value='records';
      els.guidedRecordType.value='documented_coaching';els.guidedResearchQuestion.value='count';
      els.guidedBreakdown.value='coach';els.guidedDisplay.value='line';els.guidedSort.value='default';
      el('researchGroupAggregation').value='weighted';
      state.editingResearchPopulationScope={includeOrgs:['Retail team']};
      state.editingGuidedResearchConditions=[{source:'documented_coaching',field:'Documented Coaching Condition',operator:'contains',value:'save the sale, STS, Saving the sale'}];
      els.researchStartDate.value='2026-08-01';els.researchEndDate.value='2026-09-30';
      state.editingGuidedResearchActive=true;syncGuidedResearchToAdvanced();
      els.researchTypedMeasure.value='record_count';renderResearchTypedMeasureMeta();applyResearchTypedMeasureToEditor();
      const item=currentResearchItemFromEditor();
    `);
    assert.deepEqual(plain(h.run('[item.dateColumn,item.groupField,item.secondaryGroupField,item.guidedTimeGrouping]')),['Coaching Date','Coaching Date','_team','weekly']);
    assert.equal(h.run('validateResearchEditor()'),true);
    assert.equal(h.run("el('researchGroupAggregation').closest('.field').classList.contains('hidden')"),true);
    assert.match(h.run('els.guidedCalculationGrid.textContent'),/no rate weighting/);
    const result=plain(await h.run('evaluateResearchItemAsync(item)'));h.context.result=result;
    assert.equal(result.data.reduce((sum,row)=>sum+row.values[0],0),6);
    assert.equal(h.run('AllStarCharts.buildDataset({type:"line",secondary:true,y:[0]},result).baseSeries'),2);
    assert.deepEqual(result.data.map(row=>[row.label,row.secondary,row.values[0]]),[
      ['2026-08-02','Coach A',2],['2026-08-02','Coach B',1],
      ['2026-08-09','Coach A',1],['2026-08-09','Coach B',1],['2026-09-06','Coach B',1]
    ]);
    for(const [grouping,points] of [['daily',6],['monthly',3],['quarterly',2],['period',2]]){
      h.context.grouping=grouping;
      const grouped=plain(await h.run('evaluateResearchItemAsync({...item,guidedTimeGrouping:grouping})'));
      assert.equal(grouped.data.length,points,grouping);
      assert.equal(grouped.data.reduce((sum,row)=>sum+row.values[0],0),6,grouping+' preserves count');
    }
    h.run("el('researchMappingSampleBtn').click();");
    assert.match(h.run("el('researchMappingSample').textContent"),/Coach A/);
    assert.equal(h.run("researchFieldValue(state.data.documented_coaching.rows[1],'_team','documented_coaching')"),'Coach A');
    assert.deepEqual(h.errors,[]);
    console.log('PASS actual record-count workflow: phrase alternatives, organization scope, dates on X, two coach lines, daily/weekly/monthly/quarter/period, misleading yes/no header ignored');
  }finally{h.close();}
}
async function explicitMappings(){
  const h=createHarness();
  try{
    h.run(`
      window.AllStarResearchWorkspace.init();
      const source='documented_coaching',headers=['Person coached','Delivered by','Logged at','Discussion'];
      state.data[source]={headers,rows:[{'Person coached':'Amy','Delivered by':'Coach A','Logged at':'2026-08-03',Discussion:'STS',_team:'Yes',_rep:'Wrong person',_repKey:'wrong person',_date:'2026-01-01'}]};
      markDataIndexDirty('mapped fixture',{sources:[source]});
      openResearchItemEditor(null);els.guidedPrimarySource.value=source;els.guidedResearchSubject.value='records';
      els.guidedResearchQuestion.value='count';els.guidedBreakdown.value='coach';els.guidedDisplay.value='line';
      syncGuidedResearchToAdvanced();
    `);
    assert.equal(h.run('validateGuidedResearch().ok'),false,'unrecognized coach/date columns require a choice');
    h.run(`
      for(const [key,value] of Object.entries({rep:'Person coached',coach:'Delivered by',date:'Logged at',text:'Discussion'})){
        const input=document.querySelector('[data-research-source-map="'+key+'"]');input.value=value;input.onchange();
      }
      const mappedItem=currentResearchItemFromEditor();
    `);
    assert.equal(h.run('validateGuidedResearch().ok'),true);
    assert.equal(h.run("JSON.parse(localStorage.getItem('allstar.research.sourceMappings.v1')).documented_coaching.coach"),'Delivered by');
    const result=plain(await h.run('evaluateResearchItemAsync(mappedItem)'));
    assert.deepEqual(result.data.map(r=>[r.label,r.secondary,r.values[0]]),[['2026-08-02','Coach A',1]]);
    assert.equal(h.run("datedStatsEvents(['documented_coaching'])[0].repId"),'amy');
    assert.equal(h.run("datedStatsEvents(['documented_coaching'])[0].date"),'2026-08-03');
    assert.equal(h.run("window.AllStarSentenceWorkspace.readSources('weeklyRetail',['documented_coaching']).documented_coaching.byRep.get('amy')[0].date"),'2026-08-03');
    h.run("const beforeMapping=researchExecutionDataSignature(mappedItem);saveResearchSourceMapping('documented_coaching',{...researchSourceMappings().documented_coaching,coach:'Person coached'});");
    assert.notEqual(h.run('researchExecutionDataSignature(mappedItem)'),h.run('beforeMapping'),'mapping edits invalidate saved result signatures');
    h.run("state.data.documented_coaching.rows[0]['Person coached']='';state.data.documented_coaching.rows[0]['Logged at']='';");
    assert.equal(h.run("datedStatsEvents(['documented_coaching']).length"),0,'blank explicitly mapped fields cannot use stale enriched identities/dates');
    assert.deepEqual(h.errors,[]);
    console.log('PASS user-selected rep/coach/date/text mappings persist, override stale enriched fields, reach both research engines and invalidate saved results');
  }finally{h.close();}
}
(async()=>{await coachingTrends();await explicitMappings();})().catch(error=>{console.error(error);process.exitCode=1;});
