'use strict';
const assert=require('node:assert/strict');
const {createHarness,plain}=require('./modernization-compatibility.test.js');

function fixture(){
  const h=createHarness();
  h.run(`
    const weeks=['2026-09-06','2026-09-13','2026-09-20','2026-09-27'];
    const headers=['Date','Name','Sheet','Consumer Appointments','Consumer Opportunities','Rate'];
    const weekly=(Name,week,n,d)=>({Name,Date:weeks[week],Sheet:'Coach Alpha','Consumer Appointments':n,'Consumer Opportunities':d,_sourceKey:'weeklyRetail'});
    const weeklyRows=[
      weekly('Alice Able',0,'22','50'),weekly('Able, Alice',1,'47','100'),weekly('Alice Able',2,'56','100'),weekly('Alice Able',3,'21','50'),
      weekly('Bob Baker',0,30,50),weekly('Bob Baker',1,20,50),weekly('Bob Baker',2,30,50),weekly('Bob Baker',3,30,50),
      weekly('Carla Zero',0,0,0),weekly('Dana Missing',0,5,''),weekly('Eli Missing',0,'',20),
      weekly('Fran Invalid',0,'18 calls',42),{...weekly('Invalid Date',0,1,10),Date:''}
    ];
    state.data.weeklyRetail={headers,rows:weeklyRows,config:window.AllStarDatedStats.defaultConfig('weeklyRetail',headers)};
    const coachingHeaders=['Representative','Coach','Coaching Date','Description'];
    state.data.documented_coaching={headers:coachingHeaders,rows:[
      ['Alice Able','2026-09-09','Coached'],['Alice Able','2026-09-23','Coached'],
      ['Alice Able','2026-09-30','Coached'],['Bob Baker','2026-09-09','Coached'],
      ['Bob Baker','2026-09-23','Coached']
    ].map(([Representative,date,Description])=>({Representative,Coach:'Coach Alpha','Coaching Date':date,Description,_sourceKey:'documented_coaching'}))};
    state.researchSourceMappings={documented_coaching:{rep:'Representative',coach:'Coach',date:'Coaching Date',text:'Description'}};
    state.sourceMeta.weeklyRetail={sourceVersion:1};
    state.sourceMeta.documented_coaching={sourceVersion:1};
    markDataIndexDirty('population fixture',{sources:['weeklyRetail','documented_coaching']});
    const ratio='![weeklyRetail].[Consumer Appointments] / ![weeklyRetail].[Consumer Opportunities]';
    const populationItem=normalizeResearchItem({id:'population-test',source:'weeklyRetail',outputType:'line',analysisGrain:'representatives',guidedEnabled:true,guidedSubject:'representatives',guidedQuestion:'percentage',guidedPercentageUnit:'unique_reps',guidedDisplay:'line',guidedBreakdown:'coach',showLinesFor:'teams',guidedTimeGrouping:'weekly',dateColumn:'Date',groupField:'Date',dateGrouping:'weekly',valueMode:'percent',percentBuilder:{unit:'unique_reps',denominator:'displayed_group'},populationFilterMode:'dynamic',populationFilterPeriod:'weekly',filters:[{field:ratio,include:'include',conditionResult:'true',type:'',op:'less than',value:'0.5'}],guidedConditions:[{source:'documented_coaching',field:'Description',operator:'contains',value:'Coached'}]});
    const planFor=(changes={})=>{const item=effectiveResearchItem(normalizeResearchItem({...populationItem,...changes}));return buildQueryPlan(item.source,{item,filters:item.filters,dateColumn:item.dateColumn,startDate:item.startDate,endDate:item.endDate});};
  `);
  return h;
}
async function weeklyAcceptance(){
  const h=fixture();
  try{
    assert.equal(h.run('parseResearchSourceFieldRef(ratio)'),null,'a whole formula must never resolve to its numerator field');
    const plan=plain(h.run('planFor()'));
    assert.deepEqual(plan.rows.map(row=>[row.Name,row.Date]),[
      ['Alice Able','2026-09-06'],['Able, Alice','2026-09-13'],['Alice Able','2026-09-27'],['Bob Baker','2026-09-13']
    ]);
    const diagnostic=plan.plan.populationFilters[0];
    assert.equal(diagnostic.checked,12);assert.equal(diagnostic.usable,8);assert.equal(diagnostic.matching,4);assert.equal(diagnostic.uniqueQualifyingEntities,2);
    assert.equal(diagnostic.zeroDenominator,1);assert.equal(diagnostic.missingDenominator,1);assert.equal(diagnostic.missingNumerator,2);assert.equal(diagnostic.missingDate,0,'invalid weekly dates are already removed before population evaluation');
    const sync=plain(h.run('evaluateResearchItem(populationItem)')),asyncResult=plain(await h.run('evaluateResearchItemAsync({...populationItem,id:"population-async"})'));
    assert.deepEqual(asyncResult.data,sync.data);
    assert.deepEqual(sync.data.map(point=>[point.label,point.values[0]]),[['2026-09-06',100],['2026-09-13',0],['2026-09-27',100]]);
    h.run('const week2=planFor().rows.filter(row=>row.Date===weeks[1]),trace={warnings:[]};evaluatePercentBuilder(effectiveResearchItem(populationItem),week2,{},trace);');
    assert.deepEqual(plain(h.run('[trace.percentBuilderTrace.numerator,trace.percentBuilderTrace.denominator]')),[0,2],'another week coaching cannot satisfy the numerator');
    h.run('const allTrace={};evaluatePercentBuilder({...effectiveResearchItem(populationItem),percentBuilder:{...populationItem.percentBuilder,denominator:"all_reps"}},week2,{},allTrace);');
    assert.deepEqual(plain(h.run('[allTrace.percentBuilderTrace.numerator,allTrace.percentBuilderTrace.denominator]')),[0,2],'advanced all-reps denominators also honor the current eligible week');
    h.run('const totalTrace={};evaluatePercentBuilder(effectiveResearchItem(populationItem),planFor().rows,{},totalTrace);');
    assert.deepEqual(plain(h.run('[totalTrace.percentBuilderTrace.numerator,totalTrace.percentBuilderTrace.denominator]')),[2,4],'totals retain person-period outcomes instead of treating one coached week as every week');
    const qualified=plain(h.run('applyGuidedConditionsToRows(planFor().rows,{...effectiveResearchItem(populationItem),guidedQuestion:"count"})'));
    assert.deepEqual(qualified.map(row=>row.Date),['2026-09-06','2026-09-27'],'grouped individual conditions cannot carry eligibility or coaching to another period');
    h.run('const normalTrace={};evaluatePercentBuilder({...effectiveResearchItem(populationItem),guidedConditions:[],percentBuilder:{unit:"unique_reps",fromMode:"source",qualifierSource:"documented_coaching",rules:[{field:"Description",operator:"contains",value:"Coached"}],operator:"contains",value:"Coached",denominator:"displayed_group"}},week2,{},normalTrace);');
    assert.deepEqual(plain(h.run('[normalTrace.percentBuilderTrace.numerator,normalTrace.percentBuilderTrace.denominator]')),[0,2],'the existing Percent Builder also joins evidence within the qualifying week');
    assert.deepEqual(h.errors,[]);
    console.log('PASS weekly appointments/opportunities eligibility and same-week documented coaching denominator, sync and async');
  }finally{h.close();}
}
async function staticAndComparisons(){
  const h=fixture();
  try{
    const staticPlan=plain(h.run('planFor({populationFilterMode:"static"})'));
    assert.equal(staticPlan.rows.length,4);assert.ok(staticPlan.rows.every(row=>/Alice/.test(row.Name)),'Static keeps every selected-period row for the qualifying rep, including the improved week');
    assert.equal(staticPlan.plan.populationFilters[0].checked,6);
    assert.ok(Math.abs(staticPlan.plan.populationFilters[0].samples[0].value-146/300)<1e-12,'Static uses a ratio of paired totals across the selected range');
    const pct=plain(h.run('planFor({filters:[{...populationItem.filters[0],value:"50%"}]})'));
    assert.deepEqual(pct.rows,plain(h.run('planFor().rows')));
    assert.equal(h.run('planFor({filters:[{...populationItem.filters[0],field:"[Consumer Appointments] / [Consumer Opportunities]"}]}).rows.length'),4);
    assert.equal(h.run('planFor({filters:[{...populationItem.filters[0],field:"!weeklyRetail.Consumer Appointments / !weeklyRetail.Consumer Opportunities"}]}).rows.length'),4,'loose qualified formulas cannot be mistaken for one field either');
    assert.equal(h.run('planFor({filters:[{...populationItem.filters[0],field:"SUM([Consumer Appointments]) / SUM([Consumer Opportunities])"}]}).rows.length'),4);
    assert.equal(h.run('planFor({filters:[{...populationItem.filters[0],op:"is",value:".44"}]}).rows.length'),1,'calculated equality is numeric');
    assert.equal(h.run('planFor({filters:[{...populationItem.filters[0],conditionResult:"false"}]}).rows.length'),4,'missing and zero denominators cannot match inverted conditions');
    assert.equal(h.run('planFor({filters:[{...populationItem.filters[0],include:"exclude"}]}).rows.length'),8,'Exclude removes matching entity-periods only, leaving unknown values unevaluated');
    assert.equal(h.run('planFor({filters:[{...populationItem.filters[0],include:"exclude",conditionResult:"false"}]}).rows.length'),8);
    assert.equal(h.run('planFor({startDate:weeks[2],populationFilterMode:"static"}).rows.length'),0,'Static calculations honor the selected date range');
    const old=plain(h.run('planFor({populationFilterMode:"static",filters:[{field:"Consumer Appointments",op:"less than",value:"25",conditionResult:"true",include:"include"}]}).rows'));
    assert.equal(old.length,6,'legacy single-field numerical conditions remain row filters');
    assert.equal(h.run('planFor({populationFilterMode:"static",filters:[{field:"Name",op:"is",value:"Bob Baker",conditionResult:"false",include:"include"}]}).rows.length'),8,'inverted simple conditions must bypass positive-only indexes');
    assert.notEqual(h.run('researchItemCacheKey(populationItem,"agg")'),h.run('researchItemCacheKey({...populationItem,populationFilterMode:"static"},"agg")'));
    assert.notEqual(h.run('researchQueryFilterCacheKey("weeklyRetail",{item:populationItem,filters:populationItem.filters})'),h.run('researchQueryFilterCacheKey("weeklyRetail",{item:{...populationItem,populationFilterPeriod:"monthly"},filters:populationItem.filters})'));
    console.log('PASS Static paired totals, selected date range, percentages, numerical operators, inversion and legacy Normal Filters');
  }finally{h.close();}
}
async function grainsAndAlignment(){
  const h=fixture();
  try{
    const weeks=plain(h.run('weeks'));
    const coach=plain(h.run('planFor({populationFilterGrain:"teams"})'));
    assert.deepEqual(coach.rows.map(row=>[row.Name,row.Date]),[['Able, Alice',weeks[1]],['Bob Baker',weeks[1]]],'Per Coach compares the paired coach totals, not each rep separately');
    assert.equal(h.run('planFor({populationFilterPeriod:"monthly"}).rows.length'),4,'Monthly eligibility is independent of weekly eligibility');
    assert.equal(h.run('planFor({populationFilterPeriod:"daily"}).rows.length'),4);
    assert.equal(h.run('planFor({populationFilterPeriod:"period"}).rows.length'),4);
    assert.equal(h.run('effectiveResearchItem({...populationItem,populationFilterPeriod:"monthly"}).dateGrouping'),'monthly','displayed date grain follows explicit dynamic eligibility');
    h.run(`
      const splitHeaders=['Date','Name','Sheet','Opportunities'];
      state.data.weeklyReferral={headers:splitHeaders,rows:[
        {Date:weeks[0],Name:'Alice Able',Sheet:'Coach Alpha',Opportunities:'50',_sourceKey:'weeklyReferral'},
        {Date:weeks[1],Name:'Alice Able',Sheet:'Coach Alpha',Opportunities:'100',_sourceKey:'weeklyReferral'},
        {Date:weeks[2],Name:'Alice Able',Sheet:'Coach Alpha',Opportunities:'100',_sourceKey:'weeklyReferral'},
        {Date:weeks[3],Name:'Alice Able',Sheet:'Coach Alpha',Opportunities:'50',_sourceKey:'weeklyReferral'},
        {Date:weeks[0],Name:'Other Rep',Sheet:'Coach Alpha',Opportunities:'1,000',_sourceKey:'weeklyReferral'}
      ],config:window.AllStarDatedStats.defaultConfig('weeklyReferral',splitHeaders)};
      state.sourceMeta.weeklyReferral={sourceVersion:1};markDataIndexDirty('cross-source denominator',{sources:['weeklyReferral']});
      const crossFilters=[{...populationItem.filters[0],field:'![weeklyRetail].[Consumer Appointments] / ![weeklyReferral].[Opportunities]'}];
    `);
    const cross=plain(h.run('planFor({filters:crossFilters})'));
    assert.deepEqual(cross.rows.map(r=>[r.Name,r.Date]),[['Alice Able',weeks[0]],['Able, Alice',weeks[1]],['Alice Able',weeks[3]]]);
    const crossCoach=plain(h.run('planFor({filters:crossFilters,populationFilterGrain:"teams"})'));
    const first=crossCoach.plan.populationFilters[0].samples[0];
    assert.equal(first.numerator,22);assert.equal(first.denominator,50,'another rep on the same team must not supply a denominator');
    h.run(`state.data.weeklyRetail.rows.push({...weekly('Alice Able',0,500,''),Date:weeks[0]});noteCategorizationSourceVersion('weeklyRetail');markDataIndexDirty('incomplete pair',{sources:['weeklyRetail']});`);
    const paired=plain(h.run('planFor().plan.populationFilters[0].samples[0]'));
    assert.equal(paired.numerator,22);assert.equal(paired.denominator,50,'a missing denominator row cannot contaminate a valid paired total');
    h.run(`
      const itemHeaders=['Date','Name','Item ID','Done','Possible'];
      state.data.checklist={headers:itemHeaders,rows:[{Date:'2026-09-06',Name:'Alice Able','Item ID':'I1',Done:4,Possible:10},{Date:'2026-09-13',Name:'Alice Able','Item ID':'I1',Done:6,Possible:10},{Date:'2026-09-06',Name:'Bob Baker','Item ID':'I2',Done:2,Possible:10}]};
      markDataIndexDirty('items',{sources:['checklist']});
      const itemPlan=planFor({source:'checklist',populationFilterGrain:'items',populationFilterEntityField:'Item ID',filters:[{field:'[Done]/[Possible]',op:'less than',value:'.5'}]});
    `);
    assert.deepEqual(plain(h.run('itemPlan.rows.map(row=>[row["Item ID"],row.Date])')),[['I1','2026-09-06'],['I2','2026-09-06']]);
    h.run("state.data.comp_calls={headers:['Date','Item ID','Description'],rows:[{Date:'2026-09-09','Item ID':'I1',Description:'First item'},{Date:'2026-09-16','Item ID':'I1',Description:'Later item'},{Date:'2026-09-09','Item ID':'I2',Description:'Second item'}]};markDataIndexDirty('item evidence',{sources:['comp_calls']});const itemQuestion=normalizeResearchItem({...populationItem,source:'checklist',populationFilterGrain:'items',populationFilterEntityField:'Item ID'});");
    assert.deepEqual(plain(h.run('researchRowsForCohort("comp_calls",itemPlan.rows,"checklist",itemQuestion).map(row=>row.Description)')),['First item','Second item'],'item evidence joins by Item ID and period even without people columns');
    console.log('PASS coach/item grains, daily/monthly/period modes, per-person cross-source alignment, and incomplete pairs');
  }finally{h.close();}
}
async function uiAndRoundtrip(){
  const h=fixture();
  try{
    h.run('state.researchItems=[populationItem];openResearchItemEditor(populationItem.id);');
    assert.equal(h.run('el("researchPopulationFilterMode").value'),'dynamic');
    assert.equal(h.run('el("researchPopulationPeriodField").classList.contains("hidden")'),false);
    assert.equal(h.run('currentResearchItemFromEditor().populationFilterPeriod'),'weekly');
    assert.equal(h.run('researchPopulationPeriod({...populationItem,populationFilterPeriod:"auto"})'),'weekly');
    assert.match(h.run('researchSamplePreview(populationItem).notes.join(" ")'),/Run population preview/,'small samples must not claim to evaluate an incomplete entity-period population');
    await h.run('el("researchPopulationPreviewBtn").onclick()');
    assert.match(h.run('el("researchPopulationFilterPreview").textContent'),/Population Preview/);
    assert.match(h.run('el("researchPopulationFilterPreview").textContent'),/44.0%/);
    assert.match(h.run('el("researchPopulationFilterPreview").textContent'),/NOT EVALUATED/);
    assert.equal(h.run('el("researchPopulationPreviewBtn").disabled'),false);
    h.run('el("researchPopulationFilterMode").value="static";el("researchPopulationFilterMode").onchange();');
    assert.equal(h.run('el("researchPopulationPeriodField").classList.contains("hidden")'),true);
    assert.equal(h.run('currentResearchItemFromEditor().populationFilterMode'),'static');
    h.run('const uiResult=evaluateResearchItem(populationItem);');
    assert.match(h.run('renderResearchResultByDisplay(populationItem,uiResult)'),/Population Preview/);
    h.context.resultForStorage=plain(h.run('uiResult'));
    await h.run('researchRenderedResultPut(populationItem,resultForStorage,"2026-10-06T13:00:00Z")');
    const saved=plain(await h.run('researchRenderedResultGet(populationItem.id)'));
    assert.equal(saved.perf.queryPlan.populationFilters[0].matching,4);
    assert.deepEqual(h.errors,[]);
    console.log('PASS saved mode/period, intelligent weekly default, compact explicit preview, and persisted diagnostics');
  }finally{h.close();}
}
(async()=>{await weeklyAcceptance();await staticAndComparisons();await grainsAndAlignment();await uiAndRoundtrip();})().catch(error=>{console.error(error);process.exitCode=1;});
