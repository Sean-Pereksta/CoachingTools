'use strict';
const assert=require('node:assert/strict');
const {createHarness,plain}=require('./modernization-compatibility.test.js');
async function main(){
 const h=createHarness();
 try{
  h.run(`
   window.AllStarResearchWorkspace.init();window.AllStarModelWorkspace.init();
   state.data.retail.headers.sv2=['Representative','Team','Value','Opportunities','Label'];
   state.data.retail.sv2=[{Representative:'Alice',Team:'A',Value:10,Opportunities:2,Label:'One'},{Representative:'Bob',Team:'A',Value:30,Opportunities:3,Label:'Two'}].map(r=>({...r,_rep:r.Representative,_repKey:fullNameIdentityKey(r.Representative),_team:r.Team,_sourceKey:'retail_sv2'}));
   state.sourceMeta.retail_sv2={sourceVersion:1};markDataIndexDirty('creation views',{sources:['retail_sv2']});rebuildDataIndexSync('creation views');
   state.models.push(normalizeModelForStorage({id:'views-model',name:'Existing model',type:'both',criteria:[
    {...emptyCriterion(),id:'value',name:'Value',column:'Value',scoreType:'points',points:2},
    {...emptyCriterion(),id:'display',name:'Label',calcType:'displayColumn',lookupMatchColumn:'Representative',lookupReturnColumn:'Label',lookupSelection:'first'},
    {...emptyCriterion(),id:'custom',name:'Custom',calcType:'custom',expression:'[Value]/[Opportunities]',scoreType:'rank',weight:'2',filters:[{id:'only-a',source:'retail_sv2',column:'Team',values:['A']}]}
   ]}));
   const sourceRead=getRowsRaw;getRowsRaw=()=>{throw new Error('Overview must not read imported rows');};renderModelList();getRowsRaw=sourceRead;
   openEditModel('views-model');
   const openedModel=clonePlain(state.editModel),savedModel=clonePlain(findModel('views-model'));
  `);
  const inputCount=h.run('els.criteriaList.querySelectorAll("input,select,textarea").length');
  assert.equal(h.run('[...els.criteriaList.querySelectorAll(".modelCriterionBody")].filter(n=>!n.hidden).length'),1);
  assert.match(h.run('els.criteriaList.textContent'),/2.*filters|1 filters/);
  h.run(`window.AllStarModelWorkspace.focusCriterion('custom');const valueScan=uniqueValues;uniqueValues=()=>{throw new Error('View switches must not rescan source values');};document.getElementById('modelAllSettingsBtn').click();`);
  assert.equal(h.run('els.criteriaList.querySelectorAll("input,select,textarea").length'),inputCount);
  assert.deepEqual(plain(h.run('state.editModel')),plain(h.run('openedModel')),'All settings must not change the draft');
  h.run('document.getElementById("modelAllSettingsBtn").click();uniqueValues=valueScan;');
  assert.equal(h.run('els.criteriaList.querySelector("[data-crit=custom] .modelCriterionBody").hidden'),false);
  await h.run('window.AllStarModelWorkspace.preview()');
  const modelPreview=h.run('document.getElementById("modelSamplePreviewResult").innerHTML');
  h.run(`document.getElementById('modelCriterionSearch').value='Value';document.getElementById('modelCriterionSearch').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('modelCriterionSearch').oninput();window.AllStarModelWorkspace.focusCriterion('value');renderEditModel();`);
  assert.equal(h.run('document.getElementById("modelSamplePreviewResult").innerHTML'),modelPreview,'Search, focus, and no-op renders retain the sample');
  h.run('saveEditModel(false);');
  assert.deepEqual(plain(h.run('findModel("views-model")')),plain(h.run('savedModel')),'An unchanged save preserves the complete model');
  h.run(`const valueInput=els.criteriaList.querySelector('[data-crit="value"] [data-cfield="points"]');valueInput.value='3';valueInput.dispatchEvent(new Event('input',{bubbles:true}));`);
  assert.equal(h.run('state.editModel.criteria[0].points'),3);
  assert.deepEqual(plain(h.run('state.editModel.criteria.slice(1)')),plain(h.run('openedModel.criteria.slice(1)')),'One edit leaves other criteria intact');
  assert.match(h.run('document.getElementById("modelSamplePreviewResult").textContent'),/Definition changed/);
  h.run(`const normalStorage=localStorage.setItem;localStorage.setItem=(key,value)=>{if(key===MODEL_KEY)throw new Error('Storage full');return normalStorage(key,value);};saveEditModel(false);localStorage.setItem=normalStorage;`);
  assert.equal(h.run('findModel("views-model").criteria[0].points'),2,'Failed Model save retains the original');
  assert.equal(h.run('state.editModel.criteria[0].points'),3,'Failed Model save retains the draft');
  assert.match(h.run('document.getElementById("modelWorkspaceStatus").textContent'),/Save failed.*draft retained/);
  h.run(`state.metrics.push(window.AllStarDatedStats.normalizeMetric({id:'dated-view',name:'Dated value',source:'weeklyRetail',statistic:'consumer_ar'}));state.models.push(normalizeModelForStorage({id:'dated-view-model',name:'Dated view model',criteria:[{...emptyCriterion(),id:'dated-criterion',calcType:'datedStats',datedStatsMetricId:'dated-view'}]}));openEditModel('dated-view-model');const datedDraft=clonePlain(state.editModel),datedControlCount=els.criteriaList.querySelectorAll('[data-dsr],[data-dscr]').length;`);
  assert.ok(h.run('datedControlCount')>12,'Focused grouping must retain every dated criterion control');
  h.run('document.getElementById("modelAllSettingsBtn").click();document.getElementById("modelAllSettingsBtn").click();');
  assert.equal(h.run('els.criteriaList.querySelectorAll("[data-dsr],[data-dscr]").length'),h.run('datedControlCount'));
  assert.deepEqual(plain(h.run('state.editModel')),plain(h.run('datedDraft')));
  h.run(`
   state.metrics=[normalizeMetric({id:'views-metric',name:'Total Value',source:'retail_sv2',mode:'sum',field:'Value',percentOfField:'Opportunities',componentFields:['Value'],withinCompareField:'Opportunities',gear:{valuesEnabled:false},target:0,preferredDirection:'neutral',displayFormat:'number',decimalPrecision:3})];
   const originalMetric=clonePlain(state.metrics[0]);renderMetricList();openMetricEditor('views-metric');
  `);
  assert.deepEqual(plain(h.run('metricFromEditor()')),plain(h.run('originalMetric')),'No-edit Metric roundtrip includes optional metadata and retained inputs');
  assert.match(h.run('document.getElementById("metricRetainedInputs").textContent'),/denominator.*within comparison.*component/);
  assert.equal(h.run('document.getElementById("metricPercentOfField").closest(".field").classList.contains("hidden")'),true);
  h.run('renderMetricFoundPreview();');
  assert.match(h.run('document.getElementById("metricResultContext").textContent'),/40.000/);
  const metricPreview=h.run('document.getElementById("metricResultContext").textContent');
  h.run('document.getElementById("metricAllSettingsBtn").click();document.getElementById("metricAllSettingsBtn").click();');
  assert.deepEqual(plain(h.run('metricFromEditor()')),plain(h.run('originalMetric')));
  assert.equal(h.run('document.getElementById("metricResultContext").textContent'),metricPreview);
  await h.run('saveMetricFromEditor(false)');
  assert.deepEqual(plain(h.run('state.metrics[0]')),plain(h.run('originalMetric')));
  h.run(`const normalSaveMetrics=saveMetrics;saveMetrics=async()=>false;els.metricNameInput.value='Changed metric';`);
  assert.equal(await h.run('saveMetricFromEditor(false)'),false);
  assert.deepEqual(plain(h.run('state.metrics[0]')),plain(h.run('originalMetric')));
  assert.equal(h.run('metricFromEditor().name'),'Changed metric','Failed metric save retains its draft');
  assert.match(h.run('document.getElementById("metricDraftStatus").textContent'),/Save failed.*draft retained/);
  h.run('saveMetrics=normalSaveMetrics;');
  h.run(`
   state.researchItems=[normalizeResearchItem({id:'views-research',title:'Values by team',source:'retail_sv2',groupField:'Team',analysisGrain:'rows',outputType:'table',columns:[{label:'Value',mode:'sum',field:'Value'}],valueMode:'sum',valueField:'Value',guidedEnabled:false,extension:{preserved:true}})];
   openResearchItemEditor('views-research');const researchDefinition=clonePlain(currentResearchItemFromEditor()),researchSaved=clonePlain(state.researchItems[0]);
  `);
  h.run('document.getElementById("researchAllSettingsBtn").click();document.getElementById("researchAllSettingsBtn").click();');
  assert.deepEqual(plain(h.run('currentResearchItemFromEditor()')),plain(h.run('researchDefinition')),'Research layout changes preserve advanced columns and extension metadata');
  assert.equal(h.run('document.getElementById("researchTableDecimals").closest("#researchVisualOptions")!==null'),true);
  await h.run('window.AllStarCreationViews.previewQuestion()');
  assert.match(h.run('document.getElementById("researchDraftPreviewResult").textContent'),/40/,h.run('document.getElementById("researchDraftPreviewStatus").textContent'));
  assert.match(h.run('document.getElementById("researchDraftPreviewStatus").textContent'),/Current draft preview/);
  const performance=h.run('state.researchPerformanceRuns.length');
  h.run('document.getElementById("researchAllSettingsBtn").click();document.getElementById("researchTableDecimals").value="3";document.getElementById("researchTableDecimals").dispatchEvent(new Event("input",{bubbles:true}));');
  assert.equal(h.run('state.researchPerformanceRuns.length'),performance,'Appearance and section navigation reuse the calculated result');
  assert.equal(h.run('document.getElementById("researchDraftPreviewResult").classList.contains("creationStale")'),false);
  assert.match(h.run('document.getElementById("researchDraftPreviewResult").textContent'),/40\.000/,'Appearance reformats raw values without recalculating');
  assert.deepEqual(plain(h.run('state.researchItems[0]')),plain(h.run('researchSaved')),'Draft preview never saves appearance');
  await h.run('window.AllStarCreationViews.inspectValue(document.querySelector("#researchDraftPreviewResult [data-drilldown-id]").dataset.drilldownId)');
  assert.match(h.run('document.getElementById("researchDraftPreviewEvidence").textContent'),/Formula and calculation/);
  assert.equal(h.run('document.getElementById("researchCellFeedbackModal")'),null,'Evidence stays below the active editor');
  assert.deepEqual(h.errors,[]);
  console.log('PASS complete Model/Metric roundtrips, view-only previews, isolated edits, retained hidden inputs, save-failure drafts, and Research trace evidence');
 }finally{h.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
