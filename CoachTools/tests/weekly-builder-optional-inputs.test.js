'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {parseHTML}=require('linkedom');
const C=require('../shared/weekly-data-builder-core.js');
const html=fs.readFileSync(path.join(__dirname,'../apps/weekly-data-builder.html'),'utf8');
const appointments=[['Coach','Name','Consumer Opportunities','Consumer Appointments','Consumer Appointment Rate','Notes'],
  ['Coach Zebra','Zoe','10','5','50%','Appointment note'],['Coach Alpha','Amy','8','4','50%',''],['Coach Alpha','Bob','2','0','0%','']];
const wipers=[['Report Date','Coach','Employee Full Name','Wipers Accepted','Wipers Offered'],
  ['9/27/2026','Coach Beta','Ben','1','3'],['9/27/2026','Coach Alpha','Aaron','2','4'],['9/27/2026','Coach Alpha','Amy','0','2'],['9/27/2026','','Unassigned','1','2']];
const history=[['Date','Sheet','Name','Consumer Opportunities','Consumer Appointments','Consumer Appointment Rate','Wiper Count','Wiper Jobs','Notes'],
  ['9/20/2026','Prior Coach','Previous Rep','09','0','0%','','','Keep history']];
const input=(sources,withHistory=false)=>({appointmentRows:sources.includes('appointments')?appointments:undefined,wiperRows:sources.includes('wipers')?wipers:undefined,weeklyRows:withHistory?history:undefined,date:'2026-10-04'});
const cell=(result,name,column)=>result.newRecords.find(r=>r.name===name).values[result.header.indexOf(column)];

for(const sources of [['appointments'],['wipers'],['appointments','wipers']])for(const withHistory of [false,true]){
  test(sources.join(' + ')+(withHistory?' appends to optional history':' builds without a weekly file'),()=>{
    const data=input(sources,withHistory),before=structuredClone(data),result=C.assemble(data);
    assert.deepEqual(data,before,'source rows are never changed');
    assert.equal(result.stats.oldRecords,withHistory?1:0);
    assert.deepEqual(result.previousRows,withHistory?history:[result.header]);
    assert.deepEqual(result.newRecords.map(r=>r.name),sources.length===2?['Aaron','Amy','Bob','Ben','Zoe','Unassigned']:sources[0]==='wipers'?['Aaron','Amy','Ben','Unassigned']:['Amy','Bob','Zoe']);
    assert.equal(result.stats.coaches,sources.length===2?3:2,'coach count includes wiper-only coaches');
    assert.ok(result.newRecords.every(r=>r.values[result.analyses.weekly.dims.date]==='10/4/2026'));
    assert.deepEqual(C.parseDelimited(C.csv(result.allRows)).rows.filter(r=>!C.blankRow(r)),result.allRows,'export uses the sorted result');
    assert.equal(C.analyze(result.allRows,'weekly').dims.name,result.analyses.weekly.dims.name,'generated output is a reusable weekly file');
    if(sources.includes('appointments')){
      assert.equal(cell(result,'Bob','Consumer Appointments'),'0');
      assert.equal(cell(result,'Amy','Consumer Appointment Rate'),withHistory?'50%':'0.5');
      assert.equal(cell(result,'Zoe','Notes'),'Appointment note');
    }
    if(sources.includes('wipers')){
      assert.equal(cell(result,'Amy','Wiper Count'),'0');
      assert.equal(cell(result,'Amy','Wiper Jobs'),'2');
      assert.equal(cell(result,'Aaron','Consumer Opportunities'),'');
    }else assert.equal(cell(result,'Amy','Wiper Count'),'');
  });
}

test('wiper-only builds include their rows even if the old unmatched option was off',()=>{
  const result=C.assemble({...input(['wipers']),options:{includeWiperOnly:false}});
  assert.equal(result.newRows.length,4);assert.equal(result.stats.includedWiperOnly,4);
});
test('both-source builds retain the explicit unmatched-wiper exclusion',()=>{
  const result=C.assemble({...input(['appointments','wipers']),options:{includeWiperOnly:false}});
  assert.deepEqual(result.newRecords.map(r=>r.name),['Amy','Bob','Zoe']);
  assert.equal(result.stats.includedWiperOnly,0);
});
test('new output retains supplied manager and extra wiper fields',()=>{
  const result=C.assemble({wiperRows:[['Manager','Coach','Name','Wipers Accepted','Wipers Offered','Notes'],['Manager One','Coach One','Rep One','3','5','Wiper note']],date:'2026-10-04'});
  assert.equal(cell(result,'Rep One','Manager'),'Manager One');
  assert.equal(cell(result,'Rep One','Notes'),'Wiper note');
});
test('missing sources, invalid supplied files and ambiguous source periods still block a build',()=>{
  assert.throws(()=>C.assemble({date:'2026-10-04'}),/appointment report, a wiper report/);
  assert.throws(()=>C.assemble({...input(['appointments']),wiperRows:[['Invalid']]}),/header/);
  assert.throws(()=>C.assemble({...input(['wipers']),weeklyRows:[['Invalid']]}),/weekly header/);
  assert.throws(()=>C.assemble({...input(['wipers']),wiperRows:[...wipers,['9/20/2026','Coach Alpha','Other','1','2']]}),/Choose one source period/);
  assert.throws(()=>C.assemble({...input(['appointments']),options:{mode:'modify'}}),/empty/,'Modify still needs the file being modified');
});

test('build readiness accepts either source, optional history, and rejects unfinished selected files',()=>{
  const state={mode:'add',sources:{}},nodes={publicationDate:{value:'2026-10-04'}};
  const context=vm.createContext({state,$:id=>nodes[id],definitions:{appointments:{},wipers:{},weekly:{}},CoachToolsStatsDirectory:{ready:Promise.resolve()},syncButtons:()=>{},status:()=>{}});
  vm.runInContext(html.slice(html.indexOf('function sourceReady('),html.indexOf('function updateModeUI(')),context);
  vm.runInContext('statsSettingsLoaded=true;',context);
  const loaded=(key,rows)=>({fileName:key+'.csv',rows,analysis:C.analyze(rows,key)});
  for(const sources of [['appointments'],['wipers'],['appointments','wipers']])for(const withHistory of [false,true]){
    state.sources={};for(const key of sources)state.sources[key]=loaded(key,key==='wipers'?wipers:appointments);
    if(withHistory)state.sources.weekly=loaded('weekly',history);
    assert.equal(vm.runInContext('ready()',context),true);
  }
  state.sources={wipers:loaded('wipers',wipers),appointments:{fileName:'reading.csv',loading:true}};
  assert.equal(vm.runInContext('ready()',context),false);
  state.sources.appointments={fileName:'bad.csv',error:'Bad file'};
  assert.equal(vm.runInContext('ready()',context),false);
  delete state.sources.appointments;state.mode='modify';assert.equal(vm.runInContext('ready()',context),false);
  state.sources.weekly=loaded('weekly',history);assert.equal(vm.runInContext('ready()',context),true);
  nodes.publicationDate.value='';assert.equal(vm.runInContext('ready()',context),false);
});

test('snapshot groups appointment and wiper-only representatives under their actual coaches',()=>{
  const {document}=parseHTML(html),nodes=new Map(),result=C.assemble(input(['appointments','wipers']));
  const $=id=>{if(!nodes.has(id))nodes.set(id,document.getElementById(id));return nodes.get(id);};
  $('searchInput').value='';
  // The DOM emulator has read-only select.value; values are supplied through the same UI boundary.
  for(const [id,value] of [['coachFilter',''],['matchFilter',''],['pageSize','25']])nodes.set(id,{value});
  const context=vm.createContext({$,C,state:{result,tab:'snapshot',page:1},esc:value=>String(value??''),fmt:value=>String(value)});
  vm.runInContext(html.slice(html.indexOf('function filteredPreview('),html.indexOf('function renderReview(')),context);
  vm.runInContext('renderPreview()',context);
  assert.deepEqual([...$('previewTable').querySelectorAll('.group-row')].map(row=>row.textContent.replace(/\d+ in current view$/,'')),['Coach Alpha','Coach Beta','Coach Zebra','No source coach']);
  assert.equal($('previewTable').querySelector('.group-row span').textContent,'3 in current view');
});
