'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHarness,plain}=require('./modernization-compatibility.test.js');
function fixture(source='weeklyRetail'){
  const h=createHarness();
  h.run(`
    const weeklySource=${JSON.stringify(source)},weeklyArea=weeklySource==='weeklyReferral'?'referral':'retail';
    const weeklyHeaders=['Date','Name','Sheet','Manager','Consumer Opportunities'];
    const weeklyDates=Array.from({length:12},(_,i)=>ymd(new Date(Date.UTC(2026,6,19+i*7))));
    const weeklyRow=(name,coach,week,value)=>({Date:weeklyDates[week],Name:name,Sheet:coach,Manager:'Manager Z','Consumer Opportunities':value,_sourceKey:weeklySource,_sourceArea:weeklyArea});
    const weeklyRows=[];
    for(let i=11;i>=0;i--){
      weeklyRows.push(weeklyRow(i===0?'Able, Alice':'Alice Able','Coach Alpha',i,i%2?1:2),weeklyRow('Bob Baker','Coach Alpha',i,0),weeklyRow('Dana Direct','COACH ALPHA',i,3),weeklyRow('Eli Outside','Coach Gamma',i,5));
      if(i!==6)weeklyRows.push(weeklyRow('Carla Canonical','Coach Alpha',i,i===4?0:2));
      if(i<3)weeklyRows.push(weeklyRow('Sam Short','Coach Beta',i,5));
    }
    weeklyRows.push(weeklyRow('Alice Able','Coach Alpha',0,0),weeklyRow('','Coach Alpha',0,20));
    state.data[weeklySource]={fileName:'Weekly test.xlsx',headers:weeklyHeaders,rows:weeklyRows,config:window.AllStarDatedStats.defaultConfig(weeklySource,weeklyHeaders)};
    state.data[weeklyArea].controlRoster=[['Alice Able','Coach Alpha'],['Bob Baker','Coach Alpha'],['Carla Canonical','Coach Beta'],['Eli Outside','Coach Gamma']].map(([name,team])=>({_rep:name,_repKey:fullNameIdentityKey(name),_team:team,sourceArea:weeklyArea,rosterId:name}));
    state.sourceMeta[weeklySource]={sourceVersion:1,lastImportedAt:'2026-10-01T17:00:00Z'};
    state.orgs=[normalizeOrg({id:'retail-coaches',name:'Retail Coaches',coachNames:['Coach Alpha','Coach Beta']})];
    invalidateRosterIndex('weekly fixture');rebuildTeams();markDataIndexDirty('weekly fixture',{sources:[weeklySource]});
    const weeklyItem=normalizeResearchItem({id:'weekly-research',source:weeklySource,outputType:'line',analysisGrain:'representatives',groupField:'Name',dateColumn:'Date',guidedEnabled:true,guidedSubject:'representatives',guidedQuestion:'percentage',guidedPercentageUnit:'unique_reps',guidedBreakdown:'coach',guidedDisplay:'line',guidedConditions:[{id:'opps',source:weeklySource,field:'Consumer Opportunities',operator:'greater_than',value:1}],valueMode:'percent',percentBuilder:{unit:'unique_reps',denominator:'displayed_group',qualifierSource:weeklySource},sort:'default',populationScope:{includeOrgs:['$Retail Coaches']}});
  `);
  return h;
}
async function weeklyPopulation(source){
  const h=fixture(source);
  try{
    h.run('const weeklyResultSync=evaluateResearchItem(weeklyItem);');
    const sync=plain(h.run('weeklyResultSync')),result=plain(await h.run('evaluateResearchItemAsync({...weeklyItem,id:"async-weekly"})'));
    assert.deepEqual(result.data,sync.data,'sync and async grouping agree');
    assert.equal(result.hasSecondary,true);
    assert.deepEqual(plain(h.run('(()=>{const i=effectiveResearchItem(weeklyItem);return [i.groupField,i.secondaryGroupField,i.weeklyTimeAxis];})()')),['Date','_team',true]);
    assert.equal(result.data.length,23,'two coach series, with one missing coach/week');
    const dates=plain(h.run('weeklyDates'));
    assert.deepEqual([...new Set(result.data.map(r=>r.label))],dates,'natural order is chronological even across September/October');
    const alpha=result.data.find(r=>r.label===dates[0]&&r.secondary==='Coach Alpha');
    assert.ok(Math.abs(alpha.values[0]-200/3)<1e-9,'duplicate Alice row does not change the three-person denominator');
    const beta=result.data.find(r=>r.label===dates[0]&&r.secondary==='Coach Beta');
    assert.equal(beta.values[0],100,'trusted assignment overrides a stale Sheet value');
    assert.equal(h.run("getCoachIdentity(weeklyRows.find(r=>r.Name==='Dana Direct'),weeklySource).displayName"),'Coach Alpha','unmatched rep retains configured Sheet coach');
    assert.equal(h.run("getCoachIdentity(weeklyRows.find(r=>r.Name==='Carla Canonical'),weeklySource).displayName"),'Coach Beta');
    assert.equal(h.run("rowTeam(weeklyRows.find(r=>r.Name==='Dana Direct'))"),'Coach Alpha','Reports/Models share weekly Research identity');
    assert.equal(h.run("inOrg(rowTeam(weeklyRows.find(r=>r.Name==='Dana Direct')),'Retail Coaches')"),true);
    assert.deepEqual(plain(h.run("knownCoachNames().filter(name=>orgCoachSet(state.orgs[0]).has(coachNameKey(name)))")),['Coach Alpha','Coach Beta'],'Report and Research expand the same canonical organization coaches');
    h.run("const traceContext={warnings:[]};evaluatePercentBuilder(effectiveResearchItem(weeklyItem),weeklyRows.filter(r=>r.Date===weeklyDates[0]&&researchRowTeam(r,weeklySource)==='Coach Alpha'),{},traceContext);");
    assert.deepEqual(plain(h.run('[traceContext.percentBuilderTrace.numerator,traceContext.percentBuilderTrace.denominator]')),[2,3]);
    h.run(`
      const originalScopedRows=percentBuilderScopedRows;
      let percentageSourceScans=0;
      percentBuilderScopedRows=(...args)=>{percentageSourceScans++;return originalScopedRows(...args);};
      const alphaWeekRows=weeklyRows.filter(r=>r.Date===weeklyDates[0]&&researchRowTeam(r,weeklySource)==='Coach Alpha');
      evaluatePercentBuilder(effectiveResearchItem(weeklyItem),alphaWeekRows,{},{});
    `);
    assert.equal(h.run('percentageSourceScans'),0,'coach/week percentages do not rescan the full source for every point');
    h.run(`
      evaluatePercentBuilder({...weeklyItem,percentBuilder:{...weeklyItem.percentBuilder,denominator:'all_reps'}},alphaWeekRows,{},{});
      evaluatePercentBuilder({...weeklyItem,percentBuilder:{...weeklyItem.percentBuilder,denominator:'coach_full_team'}},alphaWeekRows,{},{});
      percentBuilderScopedRows=originalScopedRows;
    `);
    assert.equal(h.run('percentageSourceScans'),2,'advanced full-source denominators still expand beyond the displayed group');
    const flow=result.perf.queryPlan.populationFlow;
    assert.equal(flow.selectedCoachCount,2);assert.equal(flow.presentSelectedCoaches,2);assert.equal(flow.representedCoaches,2);assert.equal(flow.periods,12);assert.ok(flow.directOrganizationRows>0);
    h.run('const chartProjection=AllStarCharts.buildDataset({type:"line",secondary:true,y:[0]},weeklyResultSync);');
    assert.equal(h.run('chartProjection.baseSeries'),2);
    assert.equal(h.run("chartProjection.series.find(s=>s.name.startsWith('Coach Beta')).points[6].value"),null,'missing week is null, never forward-filled');
    h.run('const coverageItem={...weeklyItem,id:"coverage",weeklyCoverage:{enabled:true,minWeeks:8}};');
    const covered=plain(await h.run('evaluateResearchItemAsync(coverageItem)'));
    assert.equal(covered.perf.queryPlan.coverage.availableWeeks,12);
    assert.equal(covered.perf.queryPlan.coverage.repsBefore,5);
    assert.equal(covered.perf.queryPlan.coverage.eligibleReps,4);
    assert.deepEqual(covered.perf.queryPlan.coverage.excluded,[{name:'Sam Short',weeks:3}]);
    assert.equal(covered.totalRowCount,48,'organization is applied before coverage; Eli is never eligible');
    const narrowed=plain(await h.run('evaluateResearchItemAsync({...coverageItem,id:"narrowed",startDate:weeklyDates[8]})'));
    assert.equal(narrowed.data.length,0);assert.equal(narrowed.perf.queryPlan.coverage.availableWeeks,4);assert.equal(narrowed.perf.queryPlan.coverage.eligibleReps,0,'date range controls coverage');
    h.run("state.orgs.push(normalizeOrg({id:'absent',name:'Absent Coaches',coachNames:['Coach Missing']}));");
    const empty=plain(await h.run('evaluateResearchItemAsync({...weeklyItem,id:"empty",populationScope:{includeOrgs:["Absent Coaches"]}})'));
    assert.equal(empty.data.length,0);
    h.run('const emptyHtml=researchWeeklyFlowHtml('+JSON.stringify(empty.perf.queryPlan)+');');
    assert.match(h.run('emptyHtml'),/contains 1 coaches, but 0/);assert.match(h.run('emptyHtml'),/Coach Missing/);
    assert.equal(h.run('effectiveResearchItem({...weeklyItem,guidedEnabled:false,groupField:"Sheet",secondaryGroupField:"Manager",useSecondaryGroup:true}).groupField'),'Sheet','explicit advanced axes remain unchanged');
    assert.equal(h.run('effectiveResearchItem({...weeklyItem,outputType:"bar"}).groupField'),'Name','saved bar behavior remains unchanged');
    console.log('PASS '+source+' organization joins, Sheet fallback, roster precedence, unique percentages, coverage, chronological series and missing points');
  }finally{h.close();}
}
async function mappingsAndUi(){
  const h=fixture();
  try{
    h.run("state.data.weeklyRetail={fileName:'Mapped.xlsx',headers:['Observed','Employee','Lead','Consumer Opportunities'],rows:[{Observed:'2026-09-20',Employee:'Dana Direct',Lead:'Coach Alpha','Consumer Opportunities':4,_sourceKey:'weeklyRetail'}],config:{...state.data.weeklyRetail.config,dateField:'Observed',repField:'Employee',coachField:'Lead'}};markDataIndexDirty('mapped weekly',{sources:['weeklyRetail']});");
    assert.deepEqual(plain(h.run("(()=>{const i=weeklySourceRowIdentity(state.data.weeklyRetail.rows[0],'weeklyRetail');return [i.repName,i.coach,i.dateField];})()")),['Dana Direct','Coach Alpha','Observed']);
    h.run('renderDatedStatsImportSummary();renderCoreSourceStatus();');
    const status=h.run("document.querySelector('[data-ds-summary=weeklyRetail]').textContent");
    assert.match(status,/Coach field identified: Lead/);assert.match(status,/1 coaches identified/);assert.match(status,/0 of 1 representatives/);assert.match(status,/2026-09-20/);
    for(const selector of ['#retailFile','#referralFile','[data-ds-upload=weeklyRetail]','[data-ds-upload=weeklyReferral]','#qaFile','#documentedCoachingFile','#checklistFile','#compCallsFile']){
      assert.equal(h.run(`document.querySelector(${JSON.stringify(selector)}).closest('details')===null`),true,'core upload is immediately visible: '+selector);
    }
    h.run('openResearchItemEditor(null);els.guidedPrimarySource.value="weeklyRetail";els.guidedResearchSubject.value="representatives";els.guidedResearchQuestion.value="percentage";els.guidedPercentageUnit.value="unique_reps";els.guidedBreakdown.value="coach";els.guidedDisplay.value="line";state.editingGuidedResearchConditions=[{source:"weeklyRetail",field:"Consumer Opportunities",operator:"greater_than",value:1}];syncGuidedResearchToAdvanced();');
    assert.deepEqual(plain(h.run('[els.researchGroupField.value,els.researchSecondaryGroupField.value,els.researchUseSecondaryGroup.value]')),['Observed','_team','yes']);
    assert.match(h.run('els.guidedCalculationGrid.textContent'),/X-axis = Observed/);
    const mappedResult=plain(await h.run('evaluateResearchItemAsync({...weeklyItem,id:"mapped-dates",dateColumn:"Observed",startDate:"2026-09-20",endDate:"2026-09-20"})'));
    assert.equal(mappedResult.data.length,1,'configured date maps participate in indexed range filtering');
    assert.equal(mappedResult.data[0].label,'2026-09-20');assert.equal(mappedResult.data[0].secondary,'Coach Alpha');assert.equal(mappedResult.data[0].values[0],100);
    h.run("state.data.weeklyRetail.rows.push({Observed:'',Employee:'Bob Baker',Lead:'Coach Alpha','Consumer Opportunities':0,_sourceKey:'weeklyRetail'});noteCategorizationSourceVersion('weeklyRetail');markDataIndexDirty('missing weekly date',{sources:['weeklyRetail']});");
    const advanced=plain(await h.run('evaluateResearchItemAsync({...weeklyItem,id:"advanced-missing-date",guidedEnabled:false,dateColumn:"Observed",groupField:"Observed"})'));
    const dated=plain(await h.run('evaluateResearchItemAsync({...weeklyItem,id:"guided-valid-date",dateColumn:"Observed"})'));
    assert.equal(advanced.totalRowCount,2,'advanced weekly queries retain their existing missing-date behavior');
    assert.equal(dated.totalRowCount,1,'guided time series do not reuse an advanced filter cache containing invalid dates');
    h.run("state.data.weeklyRetail.rows[0]._team='Coach Beta';state.data.weeklyRetail.rows[0]._teamAssignedManually=true;");
    assert.equal(h.run("getCoachIdentity(state.data.weeklyRetail.rows[0],'weeklyRetail').displayName"),'Coach Beta','manual Fix Teams mapping remains authoritative');
    h.run("el('researchWeeklyCoverageEnabled').checked=true;el('researchWeeklyCoverageMin').value=8;");
    assert.deepEqual(plain(h.run('currentResearchItemFromEditor().weeklyCoverage')),{enabled:true,minWeeks:8});
    console.log('PASS configured weekly identity fields, live upload status, visible core imports and guided chart interpretation');
  }finally{h.close();}
}
async function allCoachSeries(){
  const h=fixture();
  try{
    h.run(`
      const twentyThreeCoaches=Array.from({length:23},(_,i)=>'Coach '+String(i+1).padStart(2,'0'));
      state.orgs=[normalizeOrg({name:'Retail Coaches',coachNames:twentyThreeCoaches})];
      state.data.weeklyRetail={...state.data.weeklyRetail,rows:weeklyDates.slice().reverse().flatMap(Date=>twentyThreeCoaches.flatMap(Sheet=>[0,3].map((value,i)=>({Date,Sheet,Name:Sheet+' Rep '+i,'Consumer Opportunities':value,_sourceKey:'weeklyRetail'}))))};
      noteCategorizationSourceVersion('weeklyRetail');markDataIndexDirty('23 coaches',{sources:['weeklyRetail']});
    `);
    const result=plain(await h.run('evaluateResearchItemAsync({...weeklyItem,id:"all-23-coaches",weeklyCoverage:{enabled:true,minWeeks:8}})'));
    assert.equal(result.data.length,23*12);assert.ok(result.data.every(p=>p.values[0]===50));
    h.context.allCoachesResult=result;
    assert.equal(h.run('AllStarCharts.buildDataset({type:"line",secondary:true,y:[0]},allCoachesResult).baseSeries'),23);
    console.log('PASS 23 separate coach lines across 12 weeks with per-week unique percentages');
  }finally{h.close();}
}
async function monthlyAndAliases(){
  const h=fixture();
  try{
    h.run(`
      const monthlyCoachRow={Representative:'Alice Able',Coach:'Coach Alpha',Manager:'Manager Z',_rep:'Alice Able',_repKey:fullNameIdentityKey('Alice Able'),_team:'Coach Alpha',_monthly:true,_sourceKey:'retail_sv2'};
      state.data.retail.sv2=[monthlyCoachRow];state.data.retail.headers.sv2=['Representative','Coach','Manager'];
      markDataIndexDirty('monthly Research identity',{sources:['retail_sv2']});
    `);
    assert.equal(h.run("getCoachIdentity(monthlyCoachRow,'retail_sv2').displayName"),'Coach Alpha','monthly coach is not overwritten by its Manager column');
    assert.equal(h.run("researchCohortKeys([monthlyCoachRow],'retail_sv2').teams.has(normalizeIdentityName('Coach Alpha'))"),true);
    assert.equal(h.run("teamNameFromAnyRow(monthlyCoachRow)"),'Coach Alpha');
    const result=plain(await h.run("evaluateResearchItemAsync({id:'monthly-org',source:'retail_sv2',guidedEnabled:false,outputType:'table',groupField:'Coach',valueMode:'unique',valueField:'Representative',columns:[{field:'Representative',mode:'unique'}],populationScope:{includeOrgs:['Retail Coaches']}})"));
    assert.equal(result.totalRowCount,1,'monthly Research and Reports retain the same organization member');
    h.run(fs.readFileSync(path.resolve(__dirname,'../../../shared/coachtools-stats-directory.js'),'utf8'));
    h.run('window.CoachToolsStatsDirectory=CoachToolsStatsDirectory;');
    await h.run('CoachToolsStatsDirectory.ready');
    await h.run("CoachToolsStatsDirectory.save({...CoachToolsStatsDirectory.snapshot(),aliases:[{role:'coach',from:'Former Coach Name',to:'Coach Alpha'}]})");
    h.run("const aliasedWeeklyRow={Date:weeklyDates[0],Name:'Dana Direct',Sheet:'Former Coach Name',_sourceKey:'weeklyRetail'};");
    assert.equal(h.run("rowTeam(aliasedWeeklyRow)"),'Coach Alpha');
    assert.equal(h.run("getCoachIdentity(aliasedWeeklyRow,'weeklyRetail').displayName"),'Coach Alpha');
    assert.equal(h.run("inOrg('Former Coach Name','Retail Coaches')"),true,'shared coach aliases are respected by organization membership');
    h.run("state.orgs[0].coachNames=['Former Coach Name'];state.runIncludeOrgs=new Set([state.orgs[0].id]);updateRunOrgBadge();");
    assert.equal(h.run("inOrg('Coach Alpha','Retail Coaches')"),true,'saved organization aliases resolve to current coach names');
    assert.equal(h.run('els.runOrgBadge.textContent'),h.run('`1 orgs selected · 1 coaches · ${orgRepCount(state.orgs[0])} reps covered`'),'Report population badge agrees with canonical organization membership');
    console.log('PASS monthly Coach/Manager precedence and shared weekly/organization coach aliases');
  }finally{h.close();}
}
(async()=>{await weeklyPopulation('weeklyRetail');await weeklyPopulation('weeklyReferral');await mappingsAndUi();await allCoachSeries();await monthlyAndAliases();})().catch(error=>{console.error(error);process.exitCode=1;});
