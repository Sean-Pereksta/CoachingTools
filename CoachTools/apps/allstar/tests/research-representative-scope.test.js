'use strict';
const assert=require('node:assert/strict');
const {createHarness,plain}=require('./modernization-compatibility.test.js');

function fixture(){
  const h=createHarness();
  h.run(`
    const populationPeople=[['Alice Able','Coach Alpha'],['Bob Baker','Coach Alpha'],['Cara Clark','Coach Beta'],['Zoe Zulu','Coach Alpha'],['Eli Outside','Coach Gamma']];
    state.data.retail.headers.sv2=['Representative','Coach','Metric','Date'];
    state.data.retail.sv2=populationPeople.map(([Representative,Coach],i)=>({Representative,Coach,Metric:(i+1)*10,Date:'2026-09-01',_rep:Representative,_repKey:fullNameIdentityKey(Representative),_team:Coach,_sourceKey:'retail_sv2'}));
    state.data.retail.controlRoster=populationPeople.map(([name,team])=>({_rep:name,_repKey:fullNameIdentityKey(name),_team:team,sourceArea:'retail',rosterId:name}));
    state.repTeams=new Map(populationPeople.map(([name,team])=>[fullNameIdentityKey(name),team]));
    state.sourceMeta.retail_sv2={sourceVersion:1};
    state.data.documented_coaching={headers:['Associate Name','Coach','Date','Description'],rows:[populationPeople[0],populationPeople[3],populationPeople[4]].map(([name,team])=>({'Associate Name':name,Coach:team,Date:'2026-09-01',Description:'Cash',_rep:name,_repKey:fullNameIdentityKey(name),_team:team,_sourceKey:'documented_coaching'}))};
    state.sourceMeta.documented_coaching={sourceVersion:1};
    state.orgs=[normalizeOrg({id:'org-ab',name:'Alpha and Beta',coachNames:['Coach Alpha','Coach Beta']})];
    state.researchGroups=[normalizeResearchGroup({id:'work-group',name:'Work group',repNames:['Alice Able','Bob Baker','Cara Clark','Eli Outside']}),normalizeResearchGroup({id:'other-group',name:'Other group',repNames:['Zoe Zulu']}),normalizeResearchGroup({id:'blocked-group',name:'Blocked group',repNames:['Alice Able']}),normalizeResearchGroup({id:'empty-group',name:'Empty group',repNames:[]})];
    invalidateRosterIndex('representative scope fixture');markDataIndexDirty('representative scope fixture',{sources:['retail_sv2','documented_coaching']});rebuildDataIndexSync('representative scope fixture');
    const populationScope={includeOrgs:['org-ab'],includeResearchGroups:['work-group']};
    const scopeItem=normalizeResearchItem({id:'representative-scope',source:'retail_sv2',outputType:'bar',analysisGrain:'teams',groupField:'_team',valueMode:'unique',valueField:'_rep',populationScope});
    const scopedNames=scope=>researchApplyPopulationScope(state.data.retail.sv2,{source:'retail_sv2',populationScope:scope}).map(r=>r.Representative).sort();
    const percentSettings={unit:'unique_reps',qualifierSource:'documented_coaching',operator:'contains',value:'Cash',rules:[{field:'Description',operator:'contains',value:'Cash'}],denominator:'displayed_group'};
    const coachingPercentage=normalizeResearchItem({...scopeItem,id:'coaching-percentage',outputType:'table',valueMode:'percent',percentBuilder:percentSettings,columns:[{label:'Coached',mode:'percent'}],totals:true});
  `);
  return h;
}

async function dimensionsAndCoachCharts(){
  const h=fixture();
  try{
    assert.deepEqual(plain(h.run('scopedNames(populationScope)')),['Alice Able','Bob Baker','Cara Clark'],'coach and representative dimensions must intersect');
    assert.deepEqual(plain(h.run('scopedNames({...populationScope,includeReps:["Zoe Zulu"]})')),['Alice Able','Bob Baker','Cara Clark','Zoe Zulu'],'individual representatives union with research group members');
    assert.deepEqual(plain(h.run('scopedNames({...populationScope,includeTeams:["Coach Gamma"]})')),['Alice Able','Bob Baker','Cara Clark','Eli Outside'],'individual coaches union with organization coaches');
    assert.deepEqual(plain(h.run('scopedNames({...populationScope,includeResearchGroups:["work-group","other-group"],excludeReps:["Bob Baker"],excludeResearchGroups:["blocked-group"]})')),['Cara Clark','Zoe Zulu'],'explicit and group exclusions override included populations');
    for(const ref of ['empty-group','deleted-group']){
      h.context.groupRef=ref;
      assert.deepEqual(plain(h.run('scopedNames({...populationScope,includeResearchGroups:[groupRef]})')),[],'empty or deleted included groups cannot widen the population');
      assert.deepEqual(plain(h.run('researchSamplePreview({...scopeItem,populationScope:{...populationScope,includeResearchGroups:[groupRef]}}).rows')),[],'preview must also fail closed');
    }
    assert.deepEqual(plain(h.run('scopedNames({...populationScope,excludeResearchGroups:["deleted-exclusion"]})')),[],'a missing excluded group must not silently broaden the saved population');
    const sync=plain(h.run('evaluateResearchItem(scopeItem)')),asyncResult=plain(await h.run('evaluateResearchItemAsync({...scopeItem,id:"async-representative-scope"})'));
    assert.deepEqual(asyncResult.data,sync.data);
    assert.deepEqual(sync.data.map(r=>[r.label,r.values[0]]),[['Coach Alpha',2],['Coach Beta',1]],'representative groups retain each member\'s coach for bar breakdowns');
    assert.deepEqual(plain(h.run('researchSamplePreview(scopeItem).rows.map(r=>r.Representative).sort()')),['Alice Able','Bob Baker','Cara Clark']);
    h.run('state.editingResearchPopulationScope=populationScope;');
    assert.match(h.run('researchCalculationPlan({guidedPrimarySource:"retail_sv2"})[0][1]'),/3 representatives.*2 selected coaches/);
    assert.deepEqual(h.errors,[]);
    console.log('PASS independent population intersections, union alternatives, exclusions, fail-closed groups, previews and retained coach bars');
  }finally{h.close();}
}

async function crossSourcePercentages(){
  const h=fixture();
  try{
    const result=plain(h.run('evaluateResearchItem(coachingPercentage)')),asyncResult=plain(await h.run('evaluateResearchItemAsync({...coachingPercentage,id:"async-coaching-percentage"})'));
    assert.deepEqual(asyncResult.data,result.data);
    assert.deepEqual(result.data.map(r=>[r.label,r.values[0]]),[['Coach Alpha',50],['Coach Beta',0]],'never-coached members stay in the denominator');
    assert.ok(Math.abs(result.totalValues[0]-100/3)<1e-9);
    h.run('const percentageTrace={};const eligibleAlpha=researchApplyPopulationScope(state.data.retail.sv2,scopeItem).filter(r=>r.Coach==="Coach Alpha");evaluatePercentBuilder({...coachingPercentage,percentBuilder:{...percentSettings,denominator:"all_reps"}},eligibleAlpha,{},percentageTrace);');
    assert.deepEqual(plain(h.run('[percentageTrace.percentBuilderTrace.numerator,percentageTrace.percentBuilderTrace.denominator]')),[1,3],'expanded denominators retain the selected representative scope');
    assert.deepEqual(plain(h.run('researchRowsForCohort("documented_coaching",eligibleAlpha,"retail_sv2",{...scopeItem,crossSourceJoinMode:"strict_team"}).map(r=>r._rep)')),['Alice Able'],'coach joins cannot reintroduce unselected teammates');
    h.run('state.researchGroups[0].repNames=["Alice Able"];');
    const changed=plain(await h.run('evaluateResearchItemAsync(coachingPercentage)'));
    assert.deepEqual(changed.data.map(r=>[r.label,r.values[0]]),[['Coach Alpha',100]],'membership edits invalidate full results and percentage caches');
    h.run('state.researchGroups=state.researchGroups.filter(g=>g.id!=="work-group");');
    const deleted=plain(await h.run('evaluateResearchItemAsync(coachingPercentage)'));
    assert.deepEqual(deleted.data,[]);
    assert.ok(deleted.warnings.some(w=>/research group not found/i.test(w)));
    assert.deepEqual(h.errors,[]);
    console.log('PASS cross-source coached percentages, uncoached denominators, coach joins, membership edits and deleted-group cache invalidation');
  }finally{h.close();}
}

async function coachingPrimaryDenominator(){
  const h=fixture();
  try{
    h.run('const coachingPrimary={...coachingPercentage,id:"coaching-primary",source:"documented_coaching",dateColumn:"Date",startDate:"2026-09-01",endDate:"2026-09-30",columns:[{label:"Coached",mode:"percent"},{label:"Actual coaching records",mode:"count"}]};');
    const sync=plain(h.run('evaluateResearchItem(coachingPrimary)')),asyncResult=plain(await h.run('evaluateResearchItemAsync({...coachingPrimary,id:"async-coaching-primary"})'));
    assert.deepEqual(asyncResult.data,sync.data);
    assert.deepEqual(sync.data.map(r=>[r.label,...r.values]),[['Coach Alpha',50,1],['Coach Beta',0,0]],'coaching-primary output includes zero-coached coaches and actual records only');
    assert.ok(Math.abs(sync.totalValues[0]-100/3)<1e-9,'one coached of three selected representatives is 33.3%');
    assert.equal(sync.totalValues[1],1);assert.equal(sync.totalRowCount,1);
    const mixedPercent=plain(await h.run('evaluateResearchItemAsync({...coachingPrimary,id:"mixed-percent",columns:[{label:"Representatives coached",mode:"percent"},{label:"Coaching records matching topic",mode:"percent",percentBuilder:{...percentSettings,unit:"rows"}},{label:"All coaching records matching topic",mode:"percent",percentBuilder:{...percentSettings,unit:"documented_coaching",denominator:"all_source_rows"}}]})'));
    assert.deepEqual(mixedPercent.data.map(r=>[r.label,...r.values]),[['Coach Alpha',50,100,100],['Coach Beta',0,0,0]],'denominator-only representatives never inflate record percentage denominators');
    const outsideDate=plain(await h.run('evaluateResearchItemAsync({...coachingPrimary,id:"outside-date",startDate:"2026-10-01",endDate:"2026-10-14"})'));
    assert.deepEqual(outsideDate.data.map(r=>[r.label,...r.values]),[['Coach Alpha',0,0],['Coach Beta',0,0]],'no coaching inside the date range yields zero rather than dropping representatives');
    assert.equal(outsideDate.totalRowCount,0);
    h.run('const guidedPrimary={...coachingPrimary,id:"guided-primary",guidedEnabled:true,guidedSubject:"representatives",guidedQuestion:"percentage",guidedPercentageUnit:"unique_reps",guidedConditions:[{source:"documented_coaching",field:"Description",operator:"contains",value:"Cash"}]};');
    const guided=plain(await h.run('evaluateResearchItemAsync(guidedPrimary)'));
    assert.deepEqual(guided.data.map(r=>[r.label,...r.values]),[['Coach Alpha',50,1],['Coach Beta',0,0]],'guided conditions never treat denominator-only anchors as coaching');
    const preview=plain(h.run('researchSamplePreview(guidedPrimary)'));
    assert.equal(preview.populationRows.length,3);assert.equal(preview.rows.length,1);assert.equal(preview.matchedRows,1,'preview never reports denominator anchors as source records');
    assert.deepEqual(plain(h.run('researchSampleCalculation(researchSamplePreview(guidedPrimary),guidedPrimary).data.map(r=>[r.label,r.values[0]]).sort((a,b)=>a[0].localeCompare(b[0]))')),[['Coach Alpha',50],['Coach Beta',0]],'sample percentage also retains never-coached representatives');
    const byWeek=plain(await h.run('evaluateResearchItemAsync({...guidedPrimary,id:"coaching-by-week",outputType:"line",guidedBreakdown:"coach",guidedTimeGrouping:"weekly",startDate:"2026-09-01",endDate:"2026-09-14"})'));
    assert.deepEqual(byWeek.data.map(r=>[r.label,r.secondary,r.values[0]]),[['2026-08-30','Coach Alpha',50],['2026-08-30','Coach Beta',0],['2026-09-06','Coach Alpha',0],['2026-09-06','Coach Beta',0],['2026-09-13','Coach Alpha',0],['2026-09-13','Coach Beta',0]],'selected representatives remain in each requested period, and coaching never qualifies another week');
    assert.equal(byWeek.totalRowCount,1);
    h.run('const dailyBase={...coachingPrimary,analysisGrain:"rows",groupField:"",dateGrouping:"daily",startDate:"2026-09-01",endDate:"2026-09-02",columns:[{mode:"percent"}]};evaluateResearchItem({...dailyBase,id:"table-before-line",outputType:"table"});const warmDaily=evaluateResearchItem({...dailyBase,id:"warm-daily-line",outputType:"line"});state.researchFilterResultCache.clear();const coldDaily=evaluateResearchItem({...dailyBase,id:"cold-daily-line",outputType:"line"});');
    assert.deepEqual(plain(h.run('warmDaily.data')),plain(h.run('coldDaily.data')),'table-to-line changes cannot reuse anchors from a different period context');
    const daily=plain(h.run('warmDaily.data'));
    assert.equal(daily.length,2);assert.equal(daily[0].label,'2026-09-01');assert.ok(Math.abs(daily[0].values[0]-100/3)<1e-9);assert.equal(daily[1].label,'2026-09-02');assert.equal(daily[1].values[0],0);
    const topicFiltered=plain(await h.run('evaluateResearchItemAsync({...coachingPrimary,id:"topic-filtered-primary",filters:[{field:"Description",op:"contains",value:"Cash",include:"include"}]})'));
    assert.deepEqual(topicFiltered.data.map(r=>[r.label,...r.values]),[['Coach Alpha',50,1],['Coach Beta',0,0]],'a coaching topic row filter narrows evidence without losing uncoached selected representatives');
    const identityFiltered=plain(await h.run('evaluateResearchItemAsync({...coachingPrimary,id:"identity-filtered-primary",filters:[{field:"Coach",op:"is",value:"Coach Beta",include:"include"}]})'));
    assert.deepEqual(identityFiltered.data.map(r=>[r.label,...r.values]),[['Coach Beta',0,0]],'explicit identity filters still restrict selected representative membership');
    h.run('state.data.documented_coaching.rows=[];state.sourceMeta.documented_coaching.sourceVersion++;markDataIndexDirty("empty coaching log",{sources:["documented_coaching"]});');
    const emptyLog=plain(await h.run('evaluateResearchItemAsync({...coachingPrimary,id:"empty-coaching-log"})'));
    assert.deepEqual(emptyLog.data.map(r=>[r.label,...r.values]),[['Coach Alpha',0,0],['Coach Beta',0,0]],'a completely empty coaching log retains the known selected representative denominator');
    assert.equal(emptyLog.totalValues[0],0);assert.equal(emptyLog.totalValues[1],0);assert.equal(emptyLog.totalRowCount,0);
    assert.deepEqual(h.errors,[]);
    console.log('PASS coaching-log primary denominators, never-coached representatives, zero-percent coaches, date ranges and actual coaching counts');
  }finally{h.close();}
}

async function savedDefinitionsAndWeeklyChoices(){
  const h=fixture();
  try{
    h.run('state.researchItems=[coachingPercentage];persistResearchItemsToLocalStorage();state.researchItems=[];loadResearchItems({definitionsOnly:true});');
    assert.deepEqual(plain(h.run('state.researchItems[0].populationScope.includeResearchGroups')),['work-group']);
    assert.deepEqual(plain(h.run('state.researchItems[0].populationScope.includeOrgs')),['org-ab']);
    h.run('let exportedConfig="";downloadText=(name,text)=>{exportedConfig=text;};exportResearchConfig();state.researchGroups=[];state.orgs=[];');
    await h.run('importResearchConfig(exportedConfig)');
    assert.equal(h.run('findResearchGroup("work-group").repNames.length'),4);
    assert.deepEqual(plain(h.run('findOrg("org-ab").coachNames')),['Coach Alpha','Coach Beta']);
    assert.deepEqual(plain(h.run('scopedNames(state.researchItems[0].populationScope)')),['Alice Able','Bob Baker','Cara Clark']);
    h.run('state.data.weeklyRetail={headers:["Name","Sheet","Date"],rows:[{Name:"Una Unrostered",Sheet:"Coach Direct",Date:"2026-09-06",_sourceKey:"weeklyRetail"}],config:window.AllStarDatedStats.defaultConfig("weeklyRetail",["Name","Sheet","Date"])};state.sourceMeta.weeklyRetail={sourceVersion:1};markDataIndexDirty("unrostered weekly",{sources:["weeklyRetail"]});');
    await h.run('ensureResearchSourceIndex("weeklyRetail")');
    assert.equal(h.run('researchPopulationChoices().reps.find(r=>r.name==="Una Unrostered").team'),'Coach Direct','weekly uploads without roster assignments remain searchable');
    assert.equal(h.run('buildResearchGroupRepIndex().entries.some(r=>r.name==="Una Unrostered")'),true);
    h.run('state.editModel={id:"unchanged-model",name:"Unmodified model",criteria:[],sourceSettings:{}};const modelBeforeChoices=JSON.stringify(state.editModel);researchPopulationChoices();');
    assert.equal(h.run('JSON.stringify(state.editModel)'),h.run('modelBeforeChoices'),'Research choices only read cached metadata and cannot add source defaults to an open model');
    assert.deepEqual(h.errors,[]);
    console.log('PASS saved scope roundtrip, config export/import dependencies and searchable direct weekly representatives');
  }finally{h.close();}
}

(async()=>{await dimensionsAndCoachCharts();await crossSourcePercentages();await coachingPrimaryDenominator();await savedDefinitionsAndWeeklyChoices();})().catch(error=>{console.error(error);process.exitCode=1;});
