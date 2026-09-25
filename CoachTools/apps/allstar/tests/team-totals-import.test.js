'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const XLSX=require('../../../vendor/xlsx.full.min.js');
const {createHarness}=require('./modernization-compatibility.test.js');

function statsFile(area,rate='61%'){
  const wb=XLSX.utils.book_new();
  const add=(name,rows)=>XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),name);
  add('Control',[['Team Name','Tab Name'],['Madison Ellis','Ellis'],['John Smith','Smith']]);
  // Real cell positions must survive a used range beginning after A1.
  for(const [tab,key,rep] of [['Ellis','M.ELLIS','Alice Able'],['Smith','J.SMITH','Bob Baker']]){
    const rows=[]; rows[1]=[]; rows[1][26]=key; rows[5]=[rep]; add(tab,rows);
  }
  const summary=area==='retail'?'Appt Summary':'KPI Summary';
  add(summary,[[],[],['User','Cash Appointment Rate','','Other KPI'],['M.ELLIS','','',''],['M.ELLIS',rate,'','42%'],['J.SMITH',0,'','12%']]);
  const statHeaders=['','','Agent_Firstname','Agent_Surname','Team','Cash Apps','Cash Opps'];
  add('sv2',area==='retail'?[[],[],[],statHeaders,['','','Alice','Able','Madison Ellis',1,10]]:[statHeaders,['','','Alice','Able','Madison Ellis',1,10]]);
  add('sv2 wiper',[['Representative','Team','Count','Jobs'],['Alice Able','Madison Ellis',2,10]]);
  const bytes=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
  return {name:area+' Stats.xlsx',size:bytes.length,lastModified:1,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
}

function assertTotals(h,area,rate){
  const data=h.run(`state.data.${area}.teamTotals`);
  assert.equal(data.rows.length,2,JSON.stringify(data.diagnostics));
  assert.equal(data.diagnostics.summaryRowsMatched,2);
  assert.equal(data.diagnostics.teamsWithNoExtractedRow.length,0);
  assert.ok(data.headers.includes('Other KPI'),'headers after spacers remain available');
  const row=data.rows.find(r=>r._team==='Madison Ellis');
  assert.equal(row.User,'Madison Ellis');
  assert.equal(row._summaryLookupKey,'M.ELLIS');
  assert.equal(row._summaryDisplayName,'M.ELLIS');
  assert.equal(row._summaryRowNumber,5,'lineage uses the actual Excel row');
  assert.equal(row['Cash Appointment Rate'],rate+'%');
  assert.equal(data.rows.find(r=>r._team==='John Smith')['Cash Appointment Rate'],'0');
  assert.equal(h.run(`state.data.${area}.controlRoster.find(row=>row._team==='Madison Ellis')._rep`),'Alice Able','A6 roster survives blank leading rows');
  assert.equal(h.run(`state.data.${area}.sv2[0]._rep`),'Alice Able','stat headers retain their absolute starting column');
  assert.equal(h.run(`state.data.${area}.sv2[0]['Cash Apps']`),'1');
  assert.equal(h.run(`criterionValue({...emptyCriterion(),source:'${area}_sv2',trueValueEnabled:true,trueValueSource:'${area}_team_totals',trueValueColumn:'Cash Appointment Rate'},{kind:'team',name:'Madison Ellis',team:'Madison Ellis'},{})`),rate,'true team value comes from the summary, not representative aggregation');
  assert.equal(h.run(`teamTotalsExportAoa(state.data.${area}.teamTotals)[1][0]`),'Madison Ellis');
  assert.ok(h.run(`document.getElementById('teamTotalsImportControls').textContent`).includes('2/2 teams matched'),'match panel refreshes without reopening Import');
  assert.equal(h.run(`document.getElementById('download${area==='retail'?'Retail':'Referral'}TeamTotalsBtn').disabled`),false);
  assert.ok(h.run(`els.${area}FileName.textContent`).includes('2/2 teams matched'),'match count survives file-label refresh');
}

async function main(){
  const historical=createHarness();
  try{
    historical.run(`const sparseBook={SheetNames:['Coach'],Sheets:{Coach:{'!ref':'AA2:AA2',AA2:{t:'s',v:'M.ELLIS'}}}};`);
    assert.equal(historical.run("sheetAoa(sparseBook,'Coach')[1][26]"),'M.ELLIS');
    assert.equal(historical.run("sheetAoaPreview(sparseBook,'Coach')[1][26]"),'M.ELLIS');
    assert.equal(historical.run("coachToolsParsedFromWorkbook({},sparseBook).workbook.data.Coach.aoa[1][26]"),'M.ELLIS');
    historical.run(fs.readFileSync(path.join(__dirname,'regression-tests.js'),'utf8'));
    assert.equal(await historical.run('window.runTeamTotalsRegressionTests()'),true);
    console.log('PASS historical summary matching, aliases, zeros, duplicate rows, and canonical exports');
  }finally{historical.close();}
  const h=createHarness();
  try{
    h.run('renderImportWorkspace();');
    h.context.retailFile=statsFile('retail'); h.context.referralFile=statsFile('referral','73%');
    h.run(`window.CoachToolsImport={SOURCES:{monthlyRetail:{label:'Retail'},monthlyReferral:{label:'Referral'}}};
      state.coachToolsImportBatch={recognized:[{file:retailFile,classification:{id:'monthlyRetail'}},{file:referralFile,classification:{id:'monthlyReferral'}}]};`);
    await h.run('importCoachToolsBatch()');
    assertTotals(h,'retail',61); assertTotals(h,'referral',73);
    assert.equal(h.run('state.importJobHistory.length'),2,JSON.stringify(h.errors));
    console.log('PASS real XLSX batch imports preserve AA2, row-3 summaries, A6 rosters, and live match controls');
    h.context.replacement=statsFile('retail','68%');
    assert.equal(await h.run('loadRetailFile(replacement)'),true,JSON.stringify(h.errors));
    assertTotals(h,'retail',68); assertTotals(h,'referral',73);
    console.log('PASS individual replacement refreshes team totals and calculated values');
    const reopened=createHarness(h.storage,h.db);
    try{
      assert.equal(await reopened.run('loadImportedDataFromIndexedDB({deferRender:true})'),true);
      reopened.run('renderImportWorkspace();');
      assertTotals(reopened,'retail',68); assertTotals(reopened,'referral',73);
      console.log('PASS summary totals and lineage survive IndexedDB reopening');
    }finally{reopened.close();}
  }finally{h.close();}
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={statsFile};
