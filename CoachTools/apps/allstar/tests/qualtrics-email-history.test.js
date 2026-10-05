#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {indexedDB}=require('fake-indexeddb'),{parseHTML}=require('linkedom');
const insights=require('../qualtrics/insights.js'),XLSX=require('../../../vendor/xlsx.full.min.js');
const html=fs.readFileSync(path.join(__dirname,'../qualtrics/generator.html'),'utf8');
const section=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));
const {document}=parseHTML(html),els=Object.fromEntries([...document.querySelectorAll('[id]')].map(el=>[el.id,el]));
const key='concernHistoryLoadedFile.v1';
function historyFile(name,rows,header='Name'){
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows,{header:[header]}),'Names');
 return {name,bytes:XLSX.write(wb,{type:'buffer',bookType:'xlsx'})};
}
async function main(){
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('email-history-workflow',1);r.onupgradeneeded=()=>{r.result.createObjectStore('settings',{keyPath:'key'});r.result.createObjectStore('history',{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const getAll=store=>new Promise((resolve,reject)=>{const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const state={db,history:[],rules:[{id:'rule'}],dashboardFiles:[],selectedOtherRuleIds:new Set(),report:{reportDate:'2026-10-05',runId:'review',flagged:['Alex One','Blair Two','Casey Three'].map((repName,i)=>({repName,repKey:String(i),ruleId:'rule'}))}};
 let renders=0;const notices=[];
 const context=vm.createContext({state,els,Map,Set,Date,Promise,QualtricsInsights:insights,STORES:{settings:'settings',history:'history'},CONCERN_HISTORY_LOAD_KEY:key,getAll,window:{confirm:()=>true},console:{error(){}},toast:m=>notices.push(m),renderReport:()=>renders++,displayName:v=>String(v||'').trim().replace(/\s+/g,' '),repKey:insights.normalizeConcernName,headerKey:v=>String(v||'').toLowerCase().replace(/[^a-z0-9]/g,''),parseDate:v=>v?new Date(v):null,ymd:d=>d instanceof Date&&!isNaN(d)?d.toISOString().slice(0,10):'',coachMatch:()=>({recentMatchCount:0}),esc:v=>String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;'),historyRowsForCurrentReport:()=>[],isCoreDataRule:()=>false,
 readFileAsWorkbookRows:async file=>{if(file.bad)throw new Error('Invalid workbook');const wb=XLSX.read(file.bytes,{type:'buffer'});return {fileName:file.name,sheets:wb.SheetNames.map(sheetName=>({sheetName,headers:XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{header:1})[0]||[],rows:XLSX.utils.sheet_to_json(wb.Sheets[sheetName])}))};}});
 vm.runInContext(section('function normalizeConcernHistoryRow','function historyStats')+section('function concernHistoryNameHeader','function debounce'),context);
 context.renderConcernHistoryStatus();assert.equal(els.emailHistoryFile.textContent,'No history loaded');assert.equal(els.concernHistoryStatusBtn.disabled,true);assert.match(context.emailHistoryStatusText(),/No history loaded/);
 const file=historyFile('Concern History.xlsx',[{Name:'Alex One'},{Name:'Blair Two'},{Name:' BLAIR  TWO '},{Name:'Casey Three'},{Name:'Casey Three'},{Name:'Casey Three'}]);
 await context.importProblemReps(file);
 assert.equal(renders,1,'loading refreshes the existing report automatically');
 assert.deepEqual(state.report.flagged.map(r=>r.concernHistory.appearanceLabel),['1X','2X','3X']);
 assert.deepEqual(state.report.flagged.map(r=>r.concernHistory.statusKey),['new','undercoached','undercoached']);
 assert.equal(els.emailHistoryTitle.textContent,'Email History ✓');assert.equal(els.emailHistoryFile.textContent,file.name);assert.match(els.emailHistoryCount.textContent,/3 usable names checked • 6 prior entries/);
 assert.equal(els.emailHistoryLoadLabel.textContent,'Replace');assert.equal(els.concernHistoryStatusBtn.disabled,false);assert.equal(els.concernHistoryViewer.classList.contains('hidden'),true,'successful load stays compact until View is chosen');
 assert.match(els.concernHistoryNameList.textContent,/Blair Two — 2X/);
 const replacement=historyFile('Replacement.xlsx',[{'Agent Name':'Alex One',Count:3},{'Agent Name':'Blair Two',Count:1},{'Agent Name':'Casey Three',Count:2}],'Agent Name');
 await context.importProblemReps(replacement);assert.equal(renders,2);assert.deepEqual(state.report.flagged.map(r=>r.concernHistory.appearanceLabel),['3X','1X','2X']);assert.equal(els.emailHistoryFile.textContent,'Replacement.xlsx');
 const saved=JSON.stringify(await getAll('settings')),previous=state.concernHistoryLoad;
 for(const invalid of [historyFile('Empty.xlsx',[]),historyFile('Wrong.xlsx',[{Unknown:'Alex One'}],'Unknown'),historyFile('Bad counts.xlsx',[{Name:'Alex One',Count:'oops'}]),{name:'Corrupt.xlsx',bad:true}]){
  await context.importProblemReps(invalid);assert.equal(state.concernHistoryLoad,previous);assert.equal(JSON.stringify(await getAll('settings')),saved);assert.equal(els.emailHistoryFile.textContent,'Replacement.xlsx');assert.equal(els.importProblemRepsInput.value,'');
 }
 assert.equal(notices.filter(m=>m.includes('could not be loaded')).length,4);
 state.concernHistoryLoad=null;await context.loadConcernHistorySnapshot();context.renderConcernHistoryStatus();
 assert.equal(state.concernHistoryLoad.counts.get('alex one'),3);assert.equal(state.concernHistoryLoad.fileName,'Replacement.xlsx');assert.equal(state.concernHistoryLoad.sheetName,'Names');assert.ok(state.concernHistoryLoad.loadedAt);
 assert.equal((await getAll('settings'))[0].key,key);assert.equal((await getAll('settings'))[0].version,2);
 // Compact status reaches the normal generated email without altering its report structure.
 Object.assign(context,{makeEmailHtmlLegacy:()=>'<html><body><div style="color:#64748b;font-weight:700;margin-bottom:10px">Report date: 2026-10-05</div></body></html>',emailIntroHtml:()=>'',urgencyExecutiveCenterpieceHtml:()=>'',teamUrgencySummaryHtml:()=>''});
 vm.runInContext(section('function makeEmailHtml(title','async function exportUrgencyEmailPdf'),context);
 assert.match(context.makeEmailHtml('Test',[]),/History checked — 6 prior entries/);
 // Existing explicit history recording is idempotent; review and download do not record.
 await context.queueConcernHistory(()=>context.incrementConcernAppearances(state.report.flagged,state.report));
 await context.queueConcernHistory(()=>context.incrementConcernAppearances(state.report.flagged,state.report));
 assert.equal(state.concernHistoryLoad.counts.get('alex one'),4);
 await context.clearConcernHistory();assert.equal(els.emailHistoryFile.textContent,'No history loaded');assert.match(context.makeEmailHtml('Test',[]),/No history loaded — history frequency was not applied/);
 vm.runInContext(section('function renderEmailWorkflowStatus','function concernHistoryAppearanceExportRows'),context);
 state.rules=[{id:'stats',ruleType:'statRule'}];state.selectedOtherRuleIds.add('stats');context.isCoreDataRule=()=>true;
 context.renderEmailWorkflowStatus();assert.equal(els.emailDataStatus.textContent,'Data needed: Weekly Stats');
 state.masterRows={weeklyStats:[{}]};context.renderEmailWorkflowStatus();assert.match(els.emailDataStatus.textContent,/Data Ready/);
 let downloads=0;Object.assign(context,{setProgress(){},generateReport:async()=>{state.report={flagged:[],byCoach:new Map()};},exportEmails:async()=>downloads++});
 await context.runEmailWorkflow(true);assert.equal(downloads,1);assert.equal(state.emailWorkflowRunning,false);
 context.generateReport=async()=>{};await context.runEmailWorkflow(true);assert.equal(downloads,1,'validation returning early never exports old report');
 context.generateReport=async()=>{throw new Error('read failure');};await context.runEmailWorkflow(true);assert.equal(state.emailWorkflowRunning,false);assert.equal(els.generateReportBtn.disabled,false);
 assert.ok(!section('async function generateReport(){','function summaryStats').includes('incrementConcernAppearances'),'report generation preserves the loaded source counts');
 // Controls remain in their own workspace and optional settings stay collapsed.
 assert.equal(els.exportFinalEmailBtn.closest('section.view').id,'view-individual');assert.equal(els.emailIntroEditor.closest('details').hasAttribute('open'),false);
 assert.equal(document.querySelectorAll('#individualExportPanel input[type="checkbox"]').length,3);
 const ids=[...document.querySelectorAll('[id]')].map(el=>el.id);assert.equal(new Set(ids).size,ids.length,'no duplicate controls');
 db.close();console.log('PASS Email History: automatic name-column load/replace, 1X/2X/3X, rollback, metadata reload, email status, explicit recording, one-click output');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
