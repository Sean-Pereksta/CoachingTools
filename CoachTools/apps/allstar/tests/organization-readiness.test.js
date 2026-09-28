'use strict';
const assert=require('node:assert/strict');
const {createHarness,plain}=require('./modernization-compatibility.test.js');
function fixture(){
 const h=createHarness();
 h.run(`
 state.data.retail.headers.sv2=['Representative','Team','Apps','Opps','Date'];
 state.data.retail.sv2=[
 {Representative:'Alice Able',Team:'Alpha',Apps:12,Opps:30,Date:'2026-08-02'},
 {Representative:'Bob Baker',Team:'Alpha',Apps:0,Opps:20,Date:'2026-08-08'},
 {Representative:'Cara Clark',Team:'Beta',Apps:99,Opps:100,Date:'2026-08-05'}
 ].map(r=>({...r,_rep:r.Representative,_repKey:fullNameIdentityKey(r.Representative),_team:r.Team,_sourceKey:'retail_sv2'}));
 state.sourceMeta.retail_sv2={sourceVersion:1};
 markDataIndexDirty('org fixture',{sources:['retail_sv2']});buildDataIndex('org fixture');
 state.orgs=[normalizeOrg({id:'alpha',name:'Alpha organization',coachNames:['Alpha']}),normalizeOrg({id:'overlap',name:'Overlap',coachNames:['Alpha']})];state.activeOrgId='alpha';
 const orgItem=normalizeResearchItem({id:'rate',title:'Appointment rate',source:'retail_sv2',dateColumn:'Date',startDate:'2026-08-02',endDate:'2026-08-08',analysisGrain:'representatives',groupField:'Representative',outputType:'table',columns:[{field:'[Apps] / [Opps]',mode:'expression',showAsPercent:true}],decimals:1});state.researchItems=[orgItem];
 `);
 return h;
}
async function run(){
 const h=fixture();
 try{
  const before=plain(h.run('orgItem'));
  const original=plain(await h.run('evaluateResearchItemAsync(orgItem)'));
  const report=await h.run('buildOrgReadiness(state.orgs[0],orgItem)');
  assert.equal(report.status,'Ready',JSON.stringify(report.issues));
  assert.deepEqual(plain(report.result.data.map(r=>r.values[0])),[.4,0]);
  assert.equal(report.cells[0].cells[0].inputs.length,2);
  assert.equal(report.cells[0].cells[0].inputs[0].value,12);
  assert.equal(report.cells[0].cells[0].inputs[1].value,30);
  assert.equal(report.cells[0].cells[0].display,'40.0%');
  assert.equal(report.coverage.count,2);
  assert.equal(h.run('orgHealthIssues()[1].items.length'),1);
  assert.deepEqual(plain(h.run('orgItem')),before,'no definition mutation');
  assert.deepEqual(plain((await h.run('evaluateResearchItemAsync(orgItem)')).data),original.data,'normal Research unchanged');
  h.context.report=report;h.run('renderOrgBuilder();renderOrgReadinessResult(report)');
  assert.match(h.run('document.getElementById("orgReadinessResults").textContent'),/Why included/);
  h.run('state.data.retail.sv2[0].Opps=0;markDataIndexDirty("zero denominator",{sources:["retail_sv2"]});buildDataIndex("zero denominator");');
  const zero=await h.run('buildOrgReadiness(state.orgs[0],orgItem)');
  assert.equal(zero.status,'Cannot evaluate reliably');
  assert.ok(zero.issues.some(i=>/denominator/i.test(i.text)));
  const missing=await h.run('buildOrgReadiness(state.orgs[0],{...orgItem,columns:[{mode:"expression",field:"[Missing] / [Opps]"}]})');
  assert.equal(missing.status,'Cannot evaluate reliably');
  console.log('PASS actual group inputs, 12/30 display, valid zero vs zero denominator, missing fields, unique coverage, overlap and report parity');
 }finally{h.close();}
 const m=fixture();
 try{
  m.run(`state.data.retail.monthlySummary={period:{start:'2026-08-01',end:'2026-08-31'}};state.sourceMeta.retail_sv2.monthlyPeriod='2026-08';state.data.retail.sv2.forEach(r=>{r._monthly=true;r.Date='';});markDataIndexDirty('monthly',{sources:['retail_sv2']});buildDataIndex('monthly');`);
  const mixed=await m.run('buildOrgReadiness(state.orgs[0],{...orgItem,dateColumn:""})');
  assert.equal(mixed.status,'Cannot evaluate reliably');assert.equal(mixed.audits[0].kind,'period');assert.ok(mixed.issues.some(i=>/mixed-period/.test(i.text)));
  const deliberate=await m.run('buildOrgReadiness(state.orgs[0],{...orgItem,dateColumn:""},{periodIntent:"mixed"})');
  assert.equal(deliberate.status,'Needs attention');
  m.run('state.sourceMeta.retail_sv2={};state.data.retail.sv2.forEach(r=>delete r._monthly);');
  const unknown=await m.run('buildOrgReadiness(state.orgs[0],{...orgItem,dateColumn:""})');assert.equal(unknown.audits[0].kind,'unknown');assert.equal(unknown.status,'Cannot evaluate reliably');
  const staticReport=await m.run('buildOrgReadiness(state.orgs[0],{...orgItem,dateColumn:""},{sources:{retail_sv2:{kind:"static"}}})');assert.equal(staticReport.audits[0].kind,'static');assert.equal(staticReport.status,'Needs attention');
  console.log('PASS monthly vs weekly windows, deliberate mixed comparison, unknown coverage, static reference classification');
 }finally{m.close();}
 const c=fixture();
 try{
  c.run(`
    state.data.retail.sv2.push({...state.data.retail.sv2[0],Apps:0,Opps:20,Date:'2026-08-08'});markDataIndexDirty('two rows',{sources:['retail_sv2']});buildDataIndex('two rows');
    const conditional={...orgItem,columns:[{mode:'count',field:''}],guidedEnabled:true,guidedSubject:'representatives',guidedQuestion:'count',guidedConditions:[{source:'retail_sv2',field:'Apps',operator:'greater_than',value:'10'},{source:'retail_sv2',field:'Opps',operator:'less_than',value:'25',logic:'and'}]};
  `);
  const differentRecords=await c.run('buildOrgReadiness(state.orgs[0],conditional)');
  assert.deepEqual(plain(differentRecords.result.data.map(r=>r.label)),['Alice Able']);
  assert.match(differentRecords.logic.level,/different records/);
  const sameRecord=await c.run('buildOrgReadiness(state.orgs[0],{...conditional,guidedSubject:"records"})');
  assert.equal(sameRecord.result.data.length,0);assert.equal(sameRecord.validZero,true);assert.equal(sameRecord.status,'Ready');
  const grouped=await c.run('buildOrgReadiness(state.orgs[0],{...conditional,guidedConditions:[...conditional.guidedConditions,{source:"retail_sv2",field:"Apps",operator:"equals",value:"0",logic:"or"}]})');
  assert.match(grouped.logic.grouping,/\(\(.+ AND .+\) OR /);
  const unresolved=await c.run('buildOrgReadiness(state.orgs[0],{...conditional,guidedConditions:[{source:"retail_sv2",field:"Missing evidence",operator:"is_blank"}]})');
  assert.equal(unresolved.status,'Cannot evaluate reliably');
  c.run(`state.data.retail.sv2[0].Date='not a date';state.data.retail.sv2[1].Date='';markDataIndexDirty('bad dates',{sources:['retail_sv2']});buildDataIndex('bad dates');`);
  const invalidDates=await c.run('buildOrgReadiness(state.orgs[0],orgItem)');
  assert.equal(invalidDates.audits[0].missing,1);assert.equal(invalidDates.audits[0].invalid,1);assert.notEqual(invalidDates.status,'Ready');
  console.log('PASS same-record vs same-representative evidence, nested AND/OR, missing conditions, valid no-qualifier zero, missing and invalid dates');
 }finally{c.close();}
 const j=fixture();
 try{
  j.run(`
    state.data.referral.headers.sv2=['Representative','Team','Extra','Date','Employee ID'];
    state.data.referral.sv2=[{Representative:'Alice Able',Team:'Alpha',Extra:3,Date:'2026-08-03','Employee ID':'a'}, {Representative:'Alice Able',Team:'Alpha',Extra:6,Date:'2026-08-03','Employee ID':'a'}].map(r=>({...r,_rep:r.Representative,_repKey:fullNameIdentityKey(r.Representative),_team:r.Team,_sourceKey:'referral_sv2'}));
    state.sourceMeta.referral_sv2={sourceVersion:1};markDataIndexDirty('joins',{sources:['retail_sv2','referral_sv2']});buildDataIndex('joins');
    const crossItem={...orgItem,columns:[{mode:'expression',field:'sum(![referral_sv2].[Extra])'}]};
  `);
  const joined=await j.run('buildOrgReadiness(state.orgs[0],crossItem)');
  const a=joined.audits.find(a=>a.source==='referral_sv2');assert.equal(a.used,2);assert.equal(a.duplicateIdentities,1);assert.equal(a.joined.missingRepIdentities.length,1);assert.equal(joined.result.data[0].values[0],9);
  j.run("state.data.referral.sv2[1]['Employee ID']='different';markDataIndexDirty('ambiguous',{sources:['referral_sv2']});buildDataIndex('ambiguous');");
  const ambiguous=await j.run('buildOrgReadiness(state.orgs[0],crossItem)');assert.equal(ambiguous.status,'Cannot evaluate reliably');
  j.run("state.data.referral.sv2[1]['Employee ID']='a';state.data.referral.sv2[1].Date='2026-08-31';markDataIndexDirty('out of period',{sources:['referral_sv2']});buildDataIndex('out of period');");
  const retained=await j.run('buildOrgReadiness(state.orgs[0],crossItem)');assert.ok(retained.issues.some(i=>/retains dated rows outside/.test(i.text)),'existing date defect disclosed without changing engine');
  console.log('PASS cross-source identities, repeated records without Cartesian multiplication, ambiguous IDs and existing date-path defect disclosure');
 }finally{j.close();}
 const refs=fixture();
 try{
  refs.run(`state.metrics=[normalizeMetric({id:'cash-rate',name:'Cash rate',source:'retail_sv2',mode:'percent_item',field:'Apps',percentOfField:'Opps',gear:{valuesEnabled:false}})];state.models=[normalizeModelForStorage({id:'rate-model',name:'Rate model',type:'both',criteria:[{...emptyCriterion(),id:'raw-apps',name:'Raw appointments',source:'retail_sv2',column:'Apps'}]})];`);
  const metric=await refs.run('buildOrgReadiness(state.orgs[0],{...orgItem,columns:[{mode:"expression",field:"@Cash rate + 1"}]})');
  assert.equal(metric.status,'Ready',JSON.stringify(metric.issues));assert.equal(metric.result.data[0].values[0],41);assert.ok(metric.cells[0].cells[0].inputs.some(i=>/denominator/.test(i.raw)));
  const model=await refs.run(`buildOrgReadiness(state.orgs[0],{...orgItem,columns:[{mode:'expression',field:'model("Rate model","Raw appointments") + 1'}]})`);
  assert.equal(model.result.data[0].values[0],13);assert.ok(model.cells[0].cells[0].inputs.some(i=>i.model));assert.notEqual(model.status,'Ready','model lineage limitation is disclosed');
  refs.run(`state.data.retail.sv2[0].Apps='40%';state.data.retail.sv2[1].Apps=0.4;markDataIndexDirty('units',{sources:['retail_sv2']});buildDataIndex('units');`);
  const units=await refs.run('buildOrgReadiness(state.orgs[0],{...orgItem,groupField:"Team",columns:[{mode:"avg",field:"Apps"}]})');
  assert.equal(units.result.data[0].values[0],20.2);assert.ok(units.issues.some(i=>/fractional values/.test(i.text)));
  console.log('PASS nested saved metrics, model entry-level explanations and mixed percentage units without coercion changes');
 }finally{refs.close();}

 const ui=fixture();
 try{
  ui.run('renderOrgBuilder();state.orgResearchItemId="rate";state.orgWorkspaceTab="readiness";renderOrgReadinessControls();');
  assert.equal(ui.run('orgReadinessSnapshot'),null,'opening does not calculate');
  await ui.run('checkOrgResearchSetup()');
  assert.equal(ui.run('orgReadinessSnapshot.report.status'),'Ready','explicit UI check completes');
  ui.run('saveOrgReadinessSettings("alpha","rate",{periodIntent:"mixed"})');
  assert.equal(ui.run('orgReadinessSnapshot'),null);assert.equal(ui.run('orgReadinessSettings("alpha","rate").periodIntent'),'mixed');
  assert.equal(ui.run('orgItem.periodIntent'),undefined,'validation notes do not change definition');
  await assert.rejects(ui.run('buildOrgReadiness(state.orgs[0],orgItem,{}, {token:{cancelled:true}})'),{name:'AbortError'});
  ui.run('createOrg();');assert.equal(ui.run('state.orgs.length'),3);assert.equal(ui.run('orgCoverage(activeOrg()).count'),0);
  ui.run('importOrgs(JSON.stringify({orgs:[{id:"imported",name:"Imported",coachNames:["Alpha"]}]}));');assert.equal(ui.run('state.orgs.find(o=>o.id==="imported").coachNames.length'),1);
  ui.run('state.activeOrgId="alpha";renderOrgBuilder();state.orgHealthSelection=1;renderOrgHealth();');
  assert.match(ui.run('document.getElementById("orgHealthDetails").textContent'),/Alpha/);
  console.log('PASS on-demand UI, independent settings, cancellation, invalidation, create/import and actionable health');
 }finally{ui.close();}

}
run().catch(e=>{console.error(e);process.exitCode=1;});
