'use strict';
const assert=require('node:assert/strict');
const {createHarness,plain}=require('./modernization-compatibility.test.js');

function fixture(){
  const h=createHarness();
  h.run(`
    const headers=['Date','Name','Sheet','Consumer Appointments','Consumer Opportunities'];
    const rows=[
      ['Alice Able','2026-09-06','18','42'],['Alice Able','2026-09-13',28,50],['Alice Able','2026-09-20',21,50],
      ['Bob Baker','2026-09-06',27,46],['Bob Baker','2026-09-13',19,40],['Bob Baker','2026-09-20',5,10],
      ['Cara Clark','2026-09-06',0,0],['Dan Delta','2026-09-06',2,''],['Eli Empty','2026-09-06','',10]
    ].map(([Name,Date,a,o])=>({Name,Date,Sheet:'Coach Alpha','Consumer Appointments':a,'Consumer Opportunities':o,_sourceKey:'weeklyRetail'}));
    state.data.weeklyRetail={headers,rows,config:window.AllStarDatedStats.defaultConfig('weeklyRetail',headers)};
    state.sourceMeta.weeklyRetail={sourceVersion:1};
    state.data.documented_coaching={headers:['Associate Name','Date','Notes'],rows:[
      ['Alice Able','2026-09-09'],['Alice Able','2026-09-15'],['Bob Baker','2026-09-23']
    ].map(([name,Date])=>({'Associate Name':name,Date,Notes:'Appointment coaching',_rep:name,_repKey:fullNameIdentityKey(name),_team:'Coach Alpha',_sourceKey:'documented_coaching'}))};
    state.sourceMeta.documented_coaching={sourceVersion:1};
    markDataIndexDirty('population fixture',{sources:['weeklyRetail','documented_coaching']});rebuildDataIndexSync('population fixture');
    const ratio='![Retail Weekly Stats].[Consumer Appointments] / ![Retail Weekly Stats].[Consumer Opportunities]';
    const filter={field:ratio,op:'less than',value:'0.5',include:'include',conditionResult:'true'};
    const item=normalizeResearchItem({id:'eligible-weeks',source:'weeklyRetail',analysisGrain:'representatives',populationFilterMode:'dynamic',populationFilterPeriod:'weekly',dateColumn:'Date',groupField:'Date',dateGrouping:'weekly',outputType:'table',filters:[filter],columns:[{label:'Eligible reps',mode:'unique',field:'Name'}]});
    const pairs=rs=>rs.map(r=>r.Name+'|'+r.Date).sort();
    const planned=()=>buildQueryPlan(item.source,{item,filters:item.filters,dateColumn:item.dateColumn});
  `);
  return h;
}

async function weeklyAcceptance(){
  const h=fixture();
  try{
    const expected=['Alice Able|2026-09-06','Alice Able|2026-09-20','Bob Baker|2026-09-13'];
    assert.deepEqual(plain(h.run('pairs(planned().rows)')),expected,'source-qualified ratios must find the three below-goal rep/weeks');
    h.run(`const coachingItem={...item,id:'coaching-rate',valueMode:'percent',columns:[{label:'Coached',mode:'percent'}],percentBuilder:{unit:'unique_reps',qualifierSource:'documented_coaching',rules:[{field:'Notes',operator:'is_not_blank'}],operator:'is_not_blank',denominator:'displayed_group'}};`);
    const sync=plain(h.run('evaluateResearchItem(coachingItem)'));
    const asyncResult=plain(await h.run('evaluateResearchItemAsync({...coachingItem,id:"async-coaching"})'));
    assert.deepEqual(asyncResult.data.map(r=>[r.label,r.values[0]]),[['2026-09-06',100],['2026-09-13',0],['2026-09-20',0]],'coaching in another week cannot qualify the eligible week');
    assert.deepEqual(asyncResult.data,sync.data,'sync and async must agree');
    const diag=asyncResult.perf.queryPlan.populationFilters[0];
    assert.equal(diag.checked,9);assert.equal(diag.usable,6);assert.equal(diag.matching,3);assert.equal(diag.uniqueQualifyingEntities,2);
    assert.equal(diag.missingDenominator,1);assert.equal(diag.zeroDenominator,1);assert.equal(diag.missingNumerator,1);
    assert.ok(diag.samples.some(s=>s.reason==='zero denominator'));
    const again=plain(await h.run('evaluateResearchItemAsync({...coachingItem,id:"async-coaching"})'));
    assert.equal(again.perf.cacheUsed,true);assert.deepEqual(again.perf.queryPlan.populationFilters,asyncResult.perf.queryPlan.populationFilters);
    h.run(`const guidedCoaching={...coachingItem,id:'guided-coaching',guidedEnabled:true,guidedSubject:'representatives',guidedQuestion:'percentage',guidedPercentageUnit:'unique_reps',guidedConditions:[{source:'documented_coaching',field:'Notes',operator:'is_not_blank'}]};`);
    assert.deepEqual(plain((await h.run('evaluateResearchItemAsync(guidedCoaching)')).data.map(r=>r.values[0])),[100,0,0]);
    console.log('PASS dynamic weekly ratio, exact coaching periods, missing/zero inputs, cache diagnostics, and sync/async parity');
  }finally{h.close();}
}

async function staticAndCompatibility(){
  const h=fixture();
  try{
    h.run(`const staticItem={...item,populationFilterMode:'static'};const staticPlan=buildQueryPlan(item.source,{item:staticItem,filters:staticItem.filters});`);
    assert.deepEqual(plain(h.run('pairs(staticPlan.rows)')),['Alice Able|2026-09-06','Alice Able|2026-09-13','Alice Able|2026-09-20'],'overall Alice rate qualifies and retains her above-goal week too');
    for(const value of ['0.5','50%']){
      h.context.threshold=value;
      assert.deepEqual(plain(h.run('pairs(buildQueryPlan(item.source,{item,filters:[{...filter,value:threshold}]}).rows)')),['Alice Able|2026-09-06','Alice Able|2026-09-20','Bob Baker|2026-09-13']);
    }
    for(const field of ['[Consumer Appointments] / [Consumer Opportunities]','Retail Weekly Stats.Consumer Appointments / Retail Weekly Stats.Consumer Opportunities','row["Consumer Appointments"] / row["Consumer Opportunities"]','sum([Consumer Appointments]) / sum([Consumer Opportunities])']){
      h.context.formula=field;
      assert.equal(h.run('buildQueryPlan(item.source,{item,filters:[{...filter,field:formula}]}).rows.length'),3,field);
    }
    for(const [include,condition,count] of [['include','false',3],['exclude','true',6],['exclude','false',6]]){
      h.context.action=include;h.context.condition=condition;
      assert.equal(h.run('buildQueryPlan(item.source,{item,filters:[{...filter,include:action,conditionResult:condition}]}).rows.length'),count,'missing values cannot become matches when inverted');
    }
    assert.equal(h.run('applyResearchFilters(state.data.weeklyRetail.rows,[{field:"Consumer Appointments",op:"less than",value:20}],{source:"weeklyRetail"}).length'),5,'legacy single-field numeric filters remain usable');
    assert.equal(h.run('buildQueryPlan(item.source,{item:{source:item.source},filters:[{field:"Name",op:"is",value:"Alice Able",conditionResult:"false"}]}).rows.length'),6,'indexed simple filters must respect false condition results');
    assert.equal(h.run('buildQueryPlan(item.source,{item:{source:item.source},filters:[filter]}).rows.length'),3,'saved calculated filters are fixed even without new mode settings');
    console.log('PASS static whole-person qualification, expression forms, percent thresholds, include/exclude inversion and legacy filters');
  }finally{h.close();}
}

async function grainsDatesAndJoins(){
  const h=fixture();
  try{
    assert.equal(h.run('buildQueryPlan(item.source,{item:{...item,populationFilterGrain:"teams"},filters:item.filters}).rows.length'),2,'coach eligibility is calculated independently each week');
    assert.equal(h.run('buildQueryPlan(item.source,{item:{...item,populationFilterMode:"static",populationFilterGrain:"teams"},filters:item.filters}).rows.length'),9,'static coach ratio keeps the entire qualifying team');
    h.run('state.data.weeklyRetail.rows.forEach(r=>r["Item ID"]=r.Name);state.data.weeklyRetail.headers.push("Item ID");markDataIndexDirty("items",{sources:["weeklyRetail"]});');
    assert.deepEqual(plain(h.run('pairs(buildQueryPlan(item.source,{item:{...item,populationFilterGrain:"items",populationFilterEntityField:"Item ID"},filters:item.filters}).rows)')),['Alice Able|2026-09-06','Alice Able|2026-09-20','Bob Baker|2026-09-13']);
    assert.equal(h.run('buildQueryPlan(item.source,{item:{...item,populationFilterPeriod:"monthly"},filters:item.filters}).rows.length'),3);
    assert.equal(h.run('buildQueryPlan(item.source,{item:{...item,populationFilterPeriod:"period"},filters:item.filters}).rows.length'),3);
    const weekly=h.run('researchRowsForCohort("documented_coaching",[state.data.weeklyRetail.rows[0]],item.source,item)');
    assert.equal(weekly.length,1);
    assert.equal(h.run('researchRowsForCohort("documented_coaching",[state.data.weeklyRetail.rows[0]],item.source,{...item,populationFilterPeriod:"daily"}).length'),0,'daily joins cannot reuse a weekly cached join');
    assert.equal(h.run('researchRowsForCohort("documented_coaching",[state.data.weeklyRetail.rows[0]],item.source,{...item,populationFilterPeriod:"monthly"}).length'),2,'monthly joins include only that entity/month');
    assert.equal(h.run('researchRowsForCohort("documented_coaching",[state.data.weeklyRetail.rows[0],state.data.weeklyRetail.rows[4]],item.source,item).length'),1,'a set of people plus a set of weeks cannot create cross-period matches');
    assert.equal(h.run('buildQueryPlan(item.source,{item:{...item,startDate:"2026-09-13",endDate:"2026-09-13",populationFilterMode:"static"},filters:item.filters,dateColumn:"Date",startDate:"2026-09-13",endDate:"2026-09-13"}).rows.length'),1,'static calculations honor the selected date range');
    h.run(`
      const referralHeaders=['Date','Name','Sheet','Consumer Opportunities'];
      state.data.weeklyReferral={headers:referralHeaders,rows:state.data.weeklyRetail.rows.filter(r=>!(r.Name==='Alice Able'&&r.Date==='2026-09-20')).slice().reverse().map(r=>({Date:r.Date,Name:r.Name,Sheet:r.Sheet,'Consumer Opportunities':r['Consumer Opportunities'],_sourceKey:'weeklyReferral'})),config:window.AllStarDatedStats.defaultConfig('weeklyReferral',referralHeaders)};
      state.sourceMeta.weeklyReferral={sourceVersion:1};markDataIndexDirty('cross operands',{sources:['weeklyReferral']});
      const crossFilter={...filter,field:'![weeklyRetail].[Consumer Appointments] / ![weeklyReferral].[Consumer Opportunities]'};
    `);
    assert.deepEqual(plain(h.run('pairs(buildQueryPlan(item.source,{item:{...item,filters:[crossFilter]},filters:[crossFilter]}).rows)')),['Alice Able|2026-09-06','Bob Baker|2026-09-13'],'shuffled operands must join by rep and period; missing weeks cannot borrow a denominator');
    h.run(`state.data.weeklyRetail.rows.push({...state.data.weeklyRetail.rows[0],'Consumer Appointments':'','Consumer Opportunities':100});markDataIndexDirty('partial pair',{sources:['weeklyRetail']});`);
    assert.equal(h.run('buildQueryPlan(item.source,{item,filters:[{...filter,value:"0.2"}]}).rows.length'),0,'a missing numerator row cannot dilute the valid pair into a false below-20% match');
    assert.equal(h.run('researchPopulationIsCalculation("[Consumer Appointments] + 3 / [Consumer Opportunities]",item)'),true);
    assert.equal(h.run('buildQueryPlan(item.source,{item,filters:[{...filter,field:"([Consumer Appointments] + 3) / [Consumer Opportunities]",value:"0.5"}]}).plan.populationFilters[0].matching'),1,'complex formulas must retain the full numerator expression');
    console.log('PASS rep/coach/item grains, day/month/period scopes, exact tuple joins, date ranges, aligned cross-source operands and partial pairs');
  }finally{h.close();}
}

async function uiPersistenceAndPreview(){
  const h=fixture();
  try{
    h.run('state.researchItems=[item];openResearchItemEditor(item.id);');
    assert.equal(h.run('el("researchPopulationFilterMode").value'),'dynamic');
    assert.equal(h.run('el("researchPopulationFilterPeriod").value'),'weekly');
    assert.equal(h.run('el("researchPopulationFilterPeriodWrap").classList.contains("hidden")'),false);
    h.run('el("researchPopulationFilterMode").value="static";el("researchPopulationFilterMode").dispatchEvent(new Event("change",{bubbles:true}));');
    assert.equal(h.run('el("researchPopulationFilterPeriodWrap").classList.contains("hidden")'),true);
    assert.equal(h.run('currentResearchItemFromEditor().populationFilterMode'),'static');
    h.run('el("researchPopulationFilterMode").value="dynamic";el("researchPopulationFilterMode").dispatchEvent(new Event("change",{bubbles:true}));el("researchPopulationFilterPeriod").value="auto";el("researchPopulationFilterPeriod").dispatchEvent(new Event("change",{bubbles:true}));');
    assert.match(h.run('el("researchPopulationFilterPeriod").selectedOptions[0].textContent'),/Week/);
    await h.run('renderResearchFoundPreview()');
    assert.match(h.run('el("researchPopulationFilterPreview").textContent'),/Population Preview.*sample/);
    assert.match(h.run('el("researchPopulationFilterPreview").textContent'),/42.9%.*MATCH/);
    assert.match(h.run('el("researchPopulationFilterPreview").textContent'),/zero denominator.*NOT EVALUATED/);
    const sample=plain(h.run('researchSamplePreview(item)'));
    assert.equal(sample.populationFilters[0].matching,3);
    h.run('state.researchItems=[currentResearchItemFromEditor()];persistResearchItemsToLocalStorage();state.researchItems=[];loadResearchItems({definitionsOnly:true});');
    assert.equal(h.run('state.researchItems[0].populationFilterMode'),'dynamic');
    assert.equal(h.run('state.researchItems[0].populationFilterPeriod'),'auto');
    assert.equal(h.run('state.researchItems[0].populationFilterVersion'),2);
    h.run('el("researchPopulationFilterPeriod").value="monthly";el("rwFilterName").value="Monthly under goal";el("rwSaveFilterSet").click();el("researchPopulationFilterPeriod").value="daily";el("rwFilterSet").value="0";el("rwApplyFilterSet").click();');
    assert.equal(h.run('el("researchPopulationFilterPeriod").value'),'monthly','reusable filters retain eligibility behavior');
    assert.deepEqual(h.errors,[]);
    console.log('PASS plain-language controls, weekly defaults, compact sample calculations, definition persistence and reusable filter sets');
  }finally{h.close();}
}
async function run(){await weeklyAcceptance();await staticAndCompatibility();await grainsDatesAndJoins();await uiPersistenceAndPreview();}
run().catch(error=>{console.error(error);process.exitCode=1;});
