#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm'), path=require('node:path');
const {parseHTML}=require('linkedom');
const engine=require('../qualtrics/individual-messages.js'), workflow=require('../qualtrics/workflow.js');
const XLSX=require('../../../vendor/xlsx.full.min.js'), JSZip=require('../../../vendor/jszip.min.js');
const html=fs.readFileSync(path.join(__dirname,'../qualtrics/generator.html'),'utf8');
const ui=fs.readFileSync(path.join(__dirname,'../qualtrics/individual-ui.js'),'utf8');
const {document,Event}=parseHTML(html);
const els=Object.fromEntries([...document.querySelectorAll('[id]')].map(el=>[el.id,el]));
const reps=['Negative Person','Mixed Person','Positive Person','No Finding'].map((fullName,i)=>({fullName,repKey:String(i)}));
const rosterRows=reps.map(rep=>{const [first,last]=rep.fullName.split(' ');return {'First Name':first,'Last Name':last,Username:`rep${rep.repKey}@example.com`};});
const side=(source)=>({enabled:true,sourceType:'stat',source,operator:'gt',threshold:'0',message:`${source} (FullName)`});
const rules=[{id:'a',title:'Outcome',individualMessage:{concern:side('concern'),strength:side('strength')}}];
const template={...engine.DEFAULT_TEMPLATE,includeGeneric:true,genericMessage:'Weekly note'};
const resolver={resolveVariable(){return {missing:true};},resolveObservation(rep,side){const value=(side.source==='concern'?['0','1']:['1','2']).includes(rep.repKey)?1:0;return {value,raw:value,formatted:String(value),missing:false};}};
const evaluated=engine.evaluateAll({representatives:reps,rosterRows,rules,template,resolver});
evaluated.results=engine.sortReviewResults(evaluated.results);
assert.deepEqual(evaluated.results.map(engine.reviewCategory),['attention','mixed','strength','noFinding']);
const results=[...evaluated.results,...evaluated.results.slice(0,3).map((r,i)=>({...r,fullName:`Blocked ${i}`,repKey:`blocked${i}`,sendReady:false,errors:['Invalid email or template'],status:'Template Error'}))];
let workbook,downloads=[],notices=[],zipPause=null;
function CaptureZip(){const zip=new JSZip();return {file:zip.file.bind(zip),async generateAsync(){if(zipPause) await zipPause();return zip.generateAsync({type:'nodebuffer'});}};}
const state={individualResults:results,individualEvaluation:{summary:engine.summarize(results)},individualTemplate:template,individualRunCache:{signature:'unchanged'},individualResultsStale:false};
const context=vm.createContext({autoSaveRuleEdit(){},state,document,els,QualtricsIndividualMessages:engine,QualtricsWorkflow:workflow,window:{XLSX,JSZip:CaptureZip},XLSX:{...XLSX,writeFile(wb){workbook=wb;}},JSZip:CaptureZip,console,toast:m=>notices.push(m),downloadBlob:(data,name)=>downloads.push({data,name}),ymd:()=> '2026-10-05',sanitizeFile:s=>s.replace(/[^a-z0-9]/gi,'_'),esc:s=>String(s||''),Map,Set,Date,AbortController,performance,URLSearchParams,location:{search:''},setTimeout:fn=>{fn();},requestAnimationFrame:fn=>fn(),cancelAnimationFrame(){}});
vm.runInContext(ui,context);
context.bindIndividualMessages();
context.renderIndividualExportSelection();
assert.deepEqual([...context.individualExportCategories()],engine.EXPORT_CATEGORIES,'all three default on');
assert.equal(els.exportFinalEmailBtn.textContent,'Export 3 Messages');
assert.match(els.individualExportNote.textContent,/3 additional representatives are blocked/);
for(const count of document.querySelectorAll('[data-individual-export-count]')) assert.equal(count.textContent,'(1)');
async function main(){
 for(let mask=0;mask<8;mask++){
  for(const [i,category] of engine.EXPORT_CATEGORIES.entries()){
   const input=document.querySelector(`[data-individual-export-category="${category}"]`);
   input.checked=!!(mask&(1<<i));input.dispatchEvent(new Event('change'));
  }
  const expected=results.slice(0,3).filter((r,i)=>mask&(1<<i));
  assert.equal(state.individualResultsStale,false);assert.equal(state.individualRunCache.signature,'unchanged','checkbox does not invalidate review');
  assert.equal(els.exportFinalEmailBtn.disabled,!expected.length);assert.equal(els.exportIndividualEmailsBtn.disabled,!expected.length);
  workbook=null;downloads=[];context.exportFinalIndividualEmails();await context.exportIndividualEmails();
  if(!expected.length){assert.equal(workbook,null);assert.equal(downloads.length,0);continue;}
  const roundTrip=XLSX.read(XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});
  const rows=XLSX.utils.sheet_to_json(roundTrip.Sheets['Email Messages'],{header:1});
  assert.deepEqual(rows[0],workflow.EMAIL_COLUMNS);assert.deepEqual(rows.slice(1).map(r=>r[0]),expected.map(r=>r.fullName));
  const zip=await JSZip.loadAsync(downloads[0].data);
  assert.deepEqual(Object.keys(zip.files),expected.map(r=>context.sanitizeFile(r.fullName)+'.eml'),'ZIP and workbook include the exact same people');
  for(const result of expected) assert.match(await zip.file(context.sanitizeFile(result.fullName)+'.eml').async('string'),new RegExp(`To: ${result.email}`));
 }
 // Exercise the actual summary-tile handler; view filtering cannot change exports.
 let viewRenders=0;context.renderIndividualResultFacets=()=>{};context.renderIndividualReview=()=>viewRenders++;
 Object.defineProperty(els.individualResultFilter,'value',{writable:true,value:'all'});
 context.renderIndividualSummary();
 document.querySelector('[data-individual-summary-filter="attention"]').click();
 assert.equal(els.individualResultFilter.value,'attention');assert.equal(viewRenders,1);
 assert.equal(context.individualExportSelection().ready.length,3);
 context.invalidateIndividualRunCache('template changed');
 assert.equal(els.exportFinalEmailBtn.disabled,true);assert.equal(els.exportIndividualEmailsBtn.disabled,true);assert.match(els.individualExportNote.textContent,/Review messages again/);
 workbook=null;downloads=[];context.exportFinalIndividualEmails();await context.exportIndividualEmails();assert.equal(workbook,null);assert.equal(downloads.length,0);
 state.individualResultsStale=false;state.individualReviewRun={};context.renderIndividualExportSelection();context.exportFinalIndividualEmails();await context.exportIndividualEmails();assert.equal(workbook,null);assert.equal(downloads.length,0,'active evaluation blocks both paths');
 state.individualReviewRun=null;
 zipPause=async()=>context.setIndividualExportCategory('mixed',false);await context.exportIndividualEmails();assert.equal(downloads.length,0,'changing export selection while ZIP builds cancels obsolete download');zipPause=null;
 // Run the real async review orchestration twice, including its cache-hit path.
 let historyWrites=0;Object.assign(context,{queueConcernHistory:async fn=>fn(),incrementConcernAppearances:async()=>historyWrites++,uid:()=> 'run',renderIndividualScopeSummary(){},setIndividualReviewProgress(){},individualYieldToBrowser:async()=>{},individualScopeIndex:()=>({}),individualResolvedScope:()=>reps,individualSelectedRules:()=>rules,individualSelectedReportFiles:()=>[],individualTemplateFromForm:()=>template,parseDate:()=>new Date('2026-10-05'),individualReviewSignature:()=> 'same-review',buildIndividualRunContext:async()=>({}),createIndividualResolver:()=>resolver,renderIndividualSummary(){},renderIndividualPerformance(){},setStatus(){}});
 state.individualRosterRows=rosterRows;state.individualRunCache=null;
 await context.evaluateIndividualMessages();assert.equal(state.individualPerformance.cacheHit,false);
 await context.evaluateIndividualMessages();assert.equal(state.individualPerformance.cacheHit,true);
 assert.equal(historyWrites,0,'full and cached review never record historical emails');
 console.log('PASS Qualtrics export selection: all combinations, XLSX/ZIP parity, counts, view isolation, stale/busy/race guards, read-only reruns');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
