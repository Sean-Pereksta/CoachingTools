'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const fn=(source,name)=>source.slice(source.indexOf(`function ${name}(`),source.indexOf('\n}',source.indexOf(`function ${name}(`))+2);
const generator=read('apps/allstar/qualtrics/generator.html');
const context=vm.createContext({});
vm.runInContext(fn(generator,'simpleQualtricsIdentifiedMeta'),context);
for(const [count,label] of [[0,'0–4'],[4,'0–4'],[5,'5–9'],[9,'5–9'],[10,'10–14'],[14,'10–14'],[15,'15–19'],[19,'15–19'],[20,'20+'],[100,'20+']]) assert.equal(context.simpleQualtricsIdentifiedMeta(count).label,label);
Object.assign(context,{simpleQualtricsRuleSources:()=>[{}],simpleQualtricsCoachedRepKeys:()=>new Set(),simpleQualtricsAnnotatedNames:(_,__,coached)=>coached?'COACHED':'NEEDING',simpleQualtricsNamesHtml:x=>x,esc:x=>x,simpleQualtricsRuleCoachingLabel:()=>'',simpleQualtricsRuleDescription:()=>'',simpleQualtricsCoachedTrendHtml:()=> 'TREND',simpleQualtricsUncoachedCell:()=> 'UNCOACHED_AVG'});
vm.runInContext(fn(generator,'simpleQualtricsRuleTableHtml'),context);
const table=context.simpleQualtricsRuleTableHtml([]);
for(const labels of [['Reps Needing Coaching','Average of Reps Not Coached','Has Been Coached','Coached Average &amp; Trend'],['NEEDING','UNCOACHED_AVG','COACHED</td>','TREND']]) {
  const positions=labels.map(label=>table.indexOf(label));assert(positions.every(p=>p>=0));assert.deepEqual(positions,[...positions].sort((a,b)=>a-b));
}
const ui=read('apps/allstar/qualtrics/individual-ui.js');let checked=false;
Object.assign(context,{document:{getElementById:()=>({checked})}});
vm.runInContext(ui.slice(ui.indexOf('function individualNameAllowed'),ui.indexOf('\nfunction individualRepresentativeCatalog')),context);
const reps=['123456',' 9876543 ','Jane 2','Anne-Marie',"O’Brien",'John Doe'];
assert(reps.every(fullName=>context.individualNameAllowed({fullName})));checked=true;
assert.deepEqual(reps.filter(fullName=>context.individualNameAllowed({fullName})),reps.slice(2));
const original=JSON.stringify(reps);checked=false;assert(context.individualNameAllowed({fullName:reps[0]}));assert.equal(JSON.stringify(reps),original);
// Both generated and source pages must retain compact, readable density rules.
for (const file of ['apps/performance-scorecard.html','shared/performance-scorecard-extras.css']) {
 const css=read(file);
 assert(css.includes('table{min-width:0;table-layout:fixed}'));
 assert(css.includes('.repBtn{font-size:12px;max-width:100%;white-space:normal}'));
 assert(css.includes('.metricInline{display:flex;flex-wrap:wrap;'));
 assert(!/condensed[^\n]+min-width:220px/.test(css));
 assert(css.includes('.tableWrap{max-height:none}'));
}
const importerContext=vm.createContext({setTimeout,console});importerContext.window=importerContext;
vm.runInContext(read('shared/coachtools-import.js'),importerContext);
const api=importerContext.CoachToolsImport;
const qa={meta:{totalRows:2},workbook:{sheets:['Data'],data:{Data:{aoa:[['Team','Agent Name','Score %'],['Coach A','Jane Doe',90]]}}}};
assert.equal(api.classifyFile({name:'Documented Coaching.xlsx'},qa).id,'qa','invalid filename guess must fall back to validated QA headers');
assert.equal(api.classifyFile({name:'QA.xlsx'}, {meta:{totalRows:1},workbook:{sheets:['Data'],data:{Data:{aoa:[['garbage']]}}}}).id,null);
let writes=[];
importerContext.CoachToolsData={importDataset:async(type,data)=>{writes.push(type);if(type==='qa')throw Error('Simulated storage failure');return {status:'imported'};}};
importerContext.XLSX={read:payload=>JSON.parse(payload),utils:{sheet_to_json:sheet=>sheet.aoa}};
const file=(name,aoa)=>({name,type:'text/csv',text:async()=>JSON.stringify({SheetNames:['Data'],Sheets:{Data:{aoa}}})});
(async()=>{
  const result=await api.saveRecognizedFiles([file('QA.csv',qa.workbook.data.Data.aoa),file('Checklist.csv',[['Coach Assigned','Associate Name','Action'],['A','Jane','Done']])],{scope:{mode:'all'}});
  assert.deepEqual(writes,['qa','checklist']);assert.equal(result.errors.length,1);assert.equal(result.errors[0].file.name,'QA.csv');assert.equal(result.results.length,1);
  const bad={file:{name:'QA.xlsx'},classification:{id:'qa'},parsed:{meta:{totalRows:1},workbook:{sheets:['Data'],data:{Data:{aoa:[['garbage']]}}}}};
  await assert.rejects(()=>api.saveRecognizedEntry(bad),/Expected QA fields/);assert.equal(writes.length,2,'invalid replacement must not reach storage');
  const dated={file:{name:'Retail Weekly.csv'},classification:{id:'weeklyRetail'},parsed:{meta:{totalRows:3},workbook:{sheets:['08-01 to 08-07 2026'],data:{'08-01 to 08-07 2026':{aoa:[['Sheet','Representative'],['A','Jane']]}}}}};
  await api.prepareRecognizedEntry(dated,{scope:{mode:'all'}});assert.equal(dated.classification.detectedPeriod.periodKey,'2026-08-01');
  importerContext.importer=api;importerContext.yieldMainThread=async()=>{};
  const updateSource=read('shared/coachtools-remembered-scope.js');
  vm.runInContext(updateSource.slice(updateSource.indexOf('  async function prepareUpdateDataset'),updateSource.indexOf('  function updateMetadata')),importerContext);
  const clean=await api.prepareRecognizedEntry({file:{name:'QA.csv'},classification:{id:'qa'},parsed:structuredClone(qa)},{scope:{mode:'all'}});
  const update=await importerContext.prepareUpdateDataset({file:{name:'QA.csv'},classification:{id:'qa'},parsed:structuredClone(qa)},{scope:{mode:'all'}});
  assert.equal(update.scopedFingerprint,clean.scopedFingerprint,'Clean and Update must produce identical scoped data');
  const storage=read('shared/coachtools-storage.js');
  vm.runInContext(storage.slice(storage.indexOf('  function compareCurrent'),storage.indexOf('  function cacheCurrentRecord')),context);
  assert(context.compareCurrent({periodKey:'current',importedAt:'2026-09-09'},{periodKey:'current'}),'legacy metadata without import time must not block valid current data');
  const undated={file:{name:'Retail Weekly.csv'},classification:{id:'weeklyRetail'},parsed:{meta:{totalRows:2},workbook:{sheets:['Data'],data:{Data:{aoa:[['Sheet','Representative'],['A','Jane']]}}}}};
  await api.prepareRecognizedEntry(undated,{scope:{mode:'all'}});
  assert.equal(undated.classification.detectedPeriod.periodKey,'current','Retail Weekly.csv must not require filename/report dates');
  let overrideWrites=0;
  importerContext.CoachToolsData={importDataset:async(type,data,metadata)=>{assert(metadata.forceSourceReplacement);overrideWrites++;return {status:'replacement'}}};
  const malformed=file('Checklist.csv',[['Unexpected Header'],['Incoming value']]);
  const overrideCandidate={file:malformed,classification:{id:'checklist'},parsed:{meta:{totalRows:2},workbook:{sheets:['Data'],data:{Data:{aoa:[['Unexpected Header'],['Incoming value']]}}}}};
  importerContext.confirm=()=>false;
  await assert.rejects(()=>api.overrideEntry(overrideCandidate,{scope:{mode:'all'}},new Error('Old data conflict')),/Old data conflict/);assert.equal(overrideWrites,0);
  importerContext.confirm=()=>true;
  await api.overrideEntry(overrideCandidate,{scope:{mode:'all'}},new Error('Old data conflict'));assert.equal(overrideWrites,1,'Other sources require approval before replacement');
  console.log('MyOne usability and shared import regressions passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
