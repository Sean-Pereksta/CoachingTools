'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../js/research-workspace.js'),'utf8');
const pure=vm.createContext({});vm.runInContext(source,pure);
const api=pure.AllStarResearchWorkspace;
const history=api.editHistory(3);history.reset({field:'original',rules:[{a:1}]});
const changed={field:'changed',rules:[{a:2}]};history.push(changed);changed.rules[0].a=99;
assert.equal(history.undo().field,'original');assert.equal(history.redo().rules[0].a,2);
history.undo();history.push({field:'branch'});assert.equal(history.canRedo,false);
history.push({field:'third'});history.push({field:'fourth'});history.undo();history.undo();assert.equal(history.canUndo,false);
assert.deepEqual(Array.from(api.searchFields([{label:'Cash Appointments',group:'Columns',detail:'Retail',value:'[Cash Appointments]'},{label:'Rate',group:'Metrics',detail:'Referral',value:'@Rate'}],'cash retail'),entry=>entry.label),['Cash Appointments']);
assert.equal(api.extraFilter('  Retail  ','starts with','ret'),true);
assert.equal(api.extraFilter('Retail','ends with','AIL'),true);
assert.equal(api.extraFilter(null,'is blank',''),true);
assert.equal(api.extraFilter(0,'is not blank',''),true);
assert.equal(api.extraFilter('Alpha','in list','Beta; ALPHA'),true);
assert.equal(api.extraFilter('Alpha','not in list','Beta; ALPHA'),false);
assert.equal(api.extraFilter('Alpha','is','Alpha'),undefined,'Old operators are delegated unchanged');
assert.equal(api.numericMetric([0,10,20,30,'',null],'median'),15);
assert.equal(api.numericMetric(['red','red','blue',null],'distinct'),2);
assert.equal(api.numericMetric([], 'median'),null);
assert.equal(api.numericMetric([9,3,1], 'min'),1);
assert.equal(api.numericMetric([9,3,1], 'max'),9);
assert.equal(api.buildFormula('ratio','Consumer Appointments','Consumer Opportunities'),'(sum([Consumer Appointments])) / (sum([Consumer Opportunities]))');
assert.match(api.buildFormula('change','@Current','@Previous'),/100/);
assert.throws(()=>api.buildFormula('ratio','','Calls'),/Choose both/);
assert.equal(api.metricMetadata({decimalPrecision:90,target:'no',preferredDirection:'bad'}).decimalPrecision,6);
console.log('PASS Research edit history, grouped field search, formula generation, explicit new operators, and metric aggregates');

const {createHarness,plain}=require('./modernization-compatibility.test.js');
async function integration(){
 const h=createHarness();
 try{
  h.run(`window.AllStarResearchWorkspace.init();
    state.data.retail.headers.sv2=['Representative','Team','Apps','Opps','Category'];
    state.data.retail.sv2=[
      {Representative:'Alice',Team:'A',Apps:20,Opps:100,Category:'x'},
      {Representative:'Bob',Team:'A',Apps:40,Opps:100,Category:'y'},
      {Representative:'Cara',Team:'B',Apps:0,Opps:50,Category:'x'}
    ].map(row=>({...row,_rep:row.Representative,_repKey:fullNameIdentityKey(row.Representative),_team:row.Team,_sourceKey:'retail_sv2'}));
    state.sourceMeta.retail_sv2={sourceVersion:1};markDataIndexDirty('workspace fixture',{sources:['retail_sv2']});rebuildDataIndexSync('workspace fixture');
    state.metrics=[normalizeMetric({id:'apps',name:'Appointments',source:'retail_sv2',mode:'sum',field:'Apps',gear:{valuesEnabled:false}}),normalizeMetric({id:'opps',name:'Opportunities',source:'retail_sv2',mode:'sum',field:'Opps',gear:{valuesEnabled:false}})];
    const rwRows=getRowsRaw('retail_sv2');
  `);
  assert.equal(h.run(`evaluateMetric(state.metrics[0],rwRows,'retail_sv2',[])`),60,'Legacy sum unchanged');
  assert.equal(h.run(`evaluateMetric({id:'median',source:'retail_sv2',mode:'median',field:'Apps'},rwRows,'retail_sv2',[])`),20);
  assert.equal(h.run(`evaluateMetric({id:'distinct',source:'retail_sv2',mode:'distinct',field:'Category'},rwRows,'retail_sv2',[])`),2);
  assert.equal(h.run(`evaluateMetric({id:'rate',source:'retail_sv2',mode:'formula',formula:'(@Appointments) / (@Opportunities) * 100'},rwRows,'retail_sv2',[])`),24,'Formula can reference reusable metrics');
  const zero=plain(h.run(`(()=>{const warnings=[];const value=evaluateMetric({id:'zero',source:'retail_sv2',mode:'formula',formula:'sum([Apps]) / 0'},rwRows,'retail_sv2',warnings);return {value,warnings};})()`));
  assert.equal(zero.value,null);assert(zero.warnings.some(message=>/denominator/i.test(message)));
  const cycle=plain(h.run(`(()=>{state.metrics.push(normalizeMetric({id:'cycle-a',name:'Cycle A',source:'retail_sv2',mode:'formula',formula:'(@Cycle B) + 1'}),normalizeMetric({id:'cycle-b',name:'Cycle B',source:'retail_sv2',mode:'formula',formula:'(@Cycle A) + 1'}));const warnings=[];const value=evaluateMetric(state.metrics.find(m=>m.id==='cycle-a'),rwRows,'retail_sv2',warnings);return {value,warnings};})()`));
  assert.equal(cycle.value,null);assert(cycle.warnings.some(message=>/Circular metric reference/.test(message)));
  assert.equal(h.run(`applyResearchFilters(rwRows,[{field:'Representative',op:'starts with',value:'A'}],{source:'retail_sv2'}).length`),1);
  assert.equal(h.run(`applyResearchFilters(rwRows,[{field:'Category',op:'not in list',value:'x'}],{source:'retail_sv2'}).length`),1);
  h.run(`state.researchItems=[normalizeResearchItem({id:'edit-test',title:'Existing analysis',source:'retail_sv2',groupField:'Team',columns:[{mode:'sum',field:'Apps',label:'Apps'}],guidedEnabled:false,guidedConditions:[{id:'keep-condition',source:'retail_sv2',field:'Apps',operator:'greater_than',value:'10'}],extension:{kept:true}})];openResearchItemEditor('edit-test');`);
  assert.equal(h.run(`currentResearchItemFromEditor().extension.kept`),true,'Unknown extension metadata survives the editor');
  assert.equal(h.run(`document.getElementById('researchEditorModal').dataset.workspaceMode`),'advanced');
  const before=h.run(`JSON.stringify(currentResearchItemFromEditor().columns)`);
  h.run(`document.querySelector('[data-rw-mode="guided"]').click();`);
  assert.equal(h.run(`JSON.stringify(currentResearchItemFromEditor().columns)`),before,'Mode switches never discard existing column calculations');
  assert.equal(h.run('currentResearchItemFromEditor().guidedConditions[0].field'),'Apps','Qualification conditions survive presentation switches');
  h.run(`document.querySelector('[data-rw-mode="advanced"]').click();els.researchTitleInput.value='Changed title';els.researchTitleInput.dispatchEvent(new Event('input',{bubbles:true}));`);
  await new Promise(resolve=>setTimeout(resolve,230));
  assert.match(h.run(`document.getElementById('rwSaveState').textContent`),/Unsaved/);
  assert(h.storage.has('allstar.research.editorDraft.v1'));
  h.run(`document.getElementById('rwUndo').click();`);
  assert.equal(h.run('els.researchTitleInput.value'),'Existing analysis');
  h.run(`document.getElementById('rwRedo').click();`);
  assert.equal(h.run('els.researchTitleInput.value'),'Changed title');
  h.run(`openMetricEditor('apps');document.getElementById('rwMetricFormat').value='number';document.getElementById('rwMetricTarget').value='30';document.getElementById('rwMetricDirection').value='higher';`);
  assert.equal(h.run('metricFromEditor().target'),30);
  assert.equal(h.run('metricFromEditor().preferredDirection'),'higher');
  h.run(`els.researchTitleInput.value='Immediate close';els.researchTitleInput.dispatchEvent(new Event('input',{bubbles:true}));closeModal('researchEditorModal');`);
  assert.equal(JSON.parse(h.storage.get('allstar.research.editorDraft.v1')).snapshot.controls.researchTitleInput,'Immediate close','Closing immediately flushes pending changes');
  h.run(`openMetricEditor(null);els.metricModeSelect.value='median';els.metricFieldInput.value='Apps';els.metricSourceSelect.value='retail_sv2';`);
  assert.equal(h.run(`evaluateMetric(metricFromEditor(),rwRows,'retail_sv2',[])`),20,'New metric defaults include source values until an explicit value filter is enabled');
  console.log('PASS live metric formulas, cycle protection, zero denominators, filter operators, metadata compatibility, mode preservation, undo/redo, and recoverable drafts');
 }finally{h.close();}
}
integration().catch(error=>{console.error(error);process.exitCode=1;});
