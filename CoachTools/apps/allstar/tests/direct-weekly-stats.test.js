'use strict';
const assert=require('node:assert/strict');
const E=require('../js/dated-stats.js');
const XLSX=require('../../../vendor/xlsx.full.min.js');
const {createHarness,plain}=require('./modernization-compatibility.test.js');

async function directFields(){
  const h=createHarness();
  try{
    h.run('initDatedStatsWorkspace();');
    const dates=['2026-09-13','2026-09-20','2026-09-27'];
    for(const source of E.SOURCES){
      const rows=dates.map((Date,i)=>({Date,Name:'Alice Able',Sheet:'Coach Alpha',Manager:'Manager One','Consumer Appointment Rate':[50,55,60][i]+'%','Other Value':[0,'',12][i]}));
      h.context.rows=rows;h.context.source=source;
      h.run(`constFixtureHeaders=Object.keys(rows[0]);fixtureWorkbook={SheetNames:['Weekly'],Sheets:{},__coachToolsAoaBySheet:{Weekly:[constFixtureHeaders,...rows.map(r=>constFixtureHeaders.map(h=>r[h]))]}};`);
      assert.equal(await h.run(`loadDatedStatsFile(source,{name:'weekly.csv',size:1},{workbook:fixtureWorkbook})`),true);
      assert.equal(h.run('state.data[source].config.calendar.reviewed'),false);
      assert.equal(h.run('state.metrics.length'),0,'an uploaded field is not saved as a custom metric');
      const definition=h.run(`datedStatsSelectMetric({groupBy:'representative'},datedStatsUploadedFields().find(m=>m.source===source&&m.field==='Consumer Appointment Rate'))`);
      h.context.definition=definition;
      h.run(`fixtureItem=normalizeResearchItem({id:source+'-question',title:'Direct AR',source,outputType:'line',datedStats:definition});`);
      const result=await h.run('evaluateDatedStatsResearch(fixtureItem)');
      assert.deepEqual(plain(result.data.map(p=>[p.label,p.value])),dates.map((d,i)=>[d,[50,55,60][i]]));
      assert.match(result.description,/Average of representative values/);
      assert.equal(h.run('fixtureItem.datedStats.metricId'),undefined);
      h.run('state.researchItems.push(fixtureItem);');
      assert.equal(await h.run('researchSaveRenderedResult(fixtureItem,'+JSON.stringify(plain(result))+')'),true);
      assert.equal(await h.run(`loadDatedStatsFile(source,{name:'reupload.csv',size:1},{workbook:fixtureWorkbook})`),true);
      assert.equal(h.run('state.data[source].rows.length'),3);
      assert.equal(h.run('state.data[source].lastImport.duplicates'),3);
      const other=h.run(`datedStatsSelectMetric({groupBy:'all'},datedStatsUploadedFields().find(m=>m.source===source&&m.field==='Other Value'))`);
      h.context.other=other;
      const missing=await h.run(`evaluateDatedStatsResearch({...fixtureItem,datedStats:other})`);
      assert.deepEqual(plain(missing.data.map(p=>p.value)),[0,null,12]);
      h.run(`state.data[source].config.calendar={reviewed:true,frequency:'week',label:'ending'};`);
      assert.deepEqual(plain((await h.run('evaluateDatedStatsResearch(fixtureItem)')).axisLabels),dates,'direct fields ignore custom calendar conversions');
    }
    assert.equal(h.run('state.data.retail.sv2.length'),0,'weekly history cannot replace or seed monthly statistics');
    const reopened=createHarness(h.storage,h.db);
    try{
      await reopened.run('loadImportedDataFromIndexedDB({deferRender:true})');
      reopened.context.definition=plain(h.run('fixtureItem.datedStats'));
      const result=await reopened.run(`evaluateDatedStatsResearch({id:'reopened',datedStats:definition})`);
      assert.deepEqual(plain(result.data.map(p=>p.value)),[50,55,60]);
      assert.deepEqual(plain((await reopened.run(`researchRenderedResultGet('weeklyReferral-question')`)).axisLabels),dates);
    }finally{reopened.close();}
    // Historical coaches/managers and event conditions use the same observations.
    h.run(`state.data.weeklyRetail.rows.push({...state.data.weeklyRetail.rows[0],Name:'Bob Baker',Sheet:'Coach Beta',Manager:'Manager Two','Consumer Appointment Rate':'30%'});noteCategorizationSourceVersion('weeklyRetail');`);
    h.run(`groupItem={id:'grouped',datedStats:datedStatsSelectMetric({groupBy:'coach'},datedStatsUploadedFields().find(m=>m.source==='weeklyRetail'&&m.field==='Consumer Appointment Rate'))};`);
    const grouped=await h.run('evaluateDatedStatsResearch(groupItem)');
    assert.equal(grouped.data.find(p=>p.line==='Coach Beta'&&p.label==='2026-09-13').value,30);
    assert.equal(grouped.data.find(p=>p.line==='Coach Beta'&&p.label==='2026-09-20').value,null,'history is never forward-filled');
    const managers=await h.run(`evaluateDatedStatsResearch({...groupItem,datedStats:{...groupItem.datedStats,groupBy:'manager',managerNames:['Manager One']}})`);
    assert.ok(managers.data.every(p=>p.line==='Manager One'));
    // Fixing a detected percentage unit takes effect without a review flag.
    h.run(`state.data.weeklyRetail.rows[0]['Consumer Appointment Rate']=50;state.data.weeklyRetail.config.fields['Consumer Appointment Rate']={kind:'percentage',behavior:'rate',inputUnit:'percentage-points',unitReviewed:true};markSourceCacheDirty('weeklyRetail','unit correction');`);
    await h.run(`flushImportCacheSave('unit correction')`);
    assert.equal((await h.run('evaluateDatedStatsResearch(groupItem)')).data[0].value,50);
    assert.deepEqual(h.errors,[]);
    console.log('PASS direct fields: exact source dates, no metrics/calendar setup, both sources, zeros/missing, grouping, correction, duplicate import and IndexedDB reopening');
  }finally{h.close();}
}

async function workbookFormats(){
  const h=createHarness();
  try{
    const ws=XLSX.utils.aoa_to_sheet([['Date','Name','Coach','Custom Success %','Other Value'],[46362,'Alice Able','Alpha',.005,7],[46369,'Alice Able','Alpha',0,'bad']]);
    ws.D2.z='0.0%';ws.D3.z='0.0%';
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Weekly');
    h.context.wb=XLSX.read(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),{type:'buffer',cellNF:true});
    assert.equal(await h.run(`loadDatedStatsFile('weeklyRetail',{name:'formatted.xlsx',size:1},{workbook:wb})`),true);
    const pack=h.run(`datedStatsCategory('weeklyRetail',true,true)`);
    assert.equal(pack.observations[0].values['Custom Success %'].value,.5,'sub-one percent keeps its declared spreadsheet scale');
    assert.equal(pack.observations[1].values['Custom Success %'].value,0);
    assert.equal(pack.observations[0].values['Other Value'].value,7);
    assert.equal(pack.observations[1].values['Other Value'].status,'invalid');
    assert.ok(pack.issues.some(i=>i.field==='Other Value'));
    assert.equal(h.run(`datedStatsConfig('weeklyRetail').coachField`),'Coach');
    console.log('PASS spreadsheet date serials, header aliases, declared percent formatting, sub-one percent and field-specific invalid values');
  }finally{h.close();}
}

assert.equal(E.iso(E.day('September 27, 2026')),'2026-09-27');
assert.equal(E.iso(E.day('9/27/26')),'2026-09-27');
assert.equal(E.iso(E.day(new Date('2026-09-27T00:00:00Z'))),'2026-09-27');
directFields().then(workbookFormats).catch(error=>{console.error(error);process.exitCode=1;});
