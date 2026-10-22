'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {Worker:NodeWorker}=require('node:worker_threads');
const XLSX=require('../../../vendor/xlsx.full.min.js');
const monthly=require('../../../shared/coachtools-monthly.js');
const source=fs.readFileSync(path.join(__dirname,'../js/import-jobs.js'),'utf8');
const vendor=fs.readFileSync(path.join(__dirname,'../../../vendor/xlsx.full.min.js'),'utf8');
const monthlySource=fs.readFileSync(path.join(__dirname,'../../../shared/coachtools-monthly.js'),'utf8');
function harness(){
  const scripts=new Map(),progress=[],stats={workers:0,terminated:0,revoked:0,mainParses:0},state={activeImportJob:{label:'QA',stage:'Parsing'}};
  class WorkerBlob{constructor(parts){this.code=parts.join('');}}
  class WorkerURL extends URL{static createObjectURL(blob){const url='blob:test-'+scripts.size;scripts.set(url,blob.code);return url;}static revokeObjectURL(url){scripts.delete(url);stats.revoked++;}}
  class Worker{
    constructor(url){
      stats.workers++;
      this.worker=new NodeWorker(`const {parentPort}=require('node:worker_threads');globalThis.self=globalThis;self.postMessage=m=>parentPort.postMessage(m);parentPort.on('message',data=>self.onmessage({data}));\n(function(){var module=undefined,exports=undefined;${scripts.get(url)}\n})();`,{eval:true});
      this.worker.on('message',data=>this.onmessage?.({data}));this.worker.on('error',error=>this.onerror?.({message:error.message}));
    }
    postMessage(message,transfer){this.worker.postMessage(message,transfer);}
    terminate(){stats.terminated++;this.worker.terminate();}
  }
  const api=new Function('document','Worker','Blob','URL','XLSX','state','updateProgress','yieldToBrowser','window',source+'\nreturn {parseAllStarWorkbook,cancelAllStarImport};')(
    {baseURI:'file:///C:/Allstar-Portable.html',querySelector:selector=>({textContent:selector.includes('data-allstar-vendor')?vendor:monthlySource})},Worker,WorkerBlob,WorkerURL,
    {read(){stats.mainParses++;throw new Error('Workbook parsing ran on the UI thread');}},state,(text,pct)=>progress.push({text,pct}),async()=>{},{});
  return {...api,state,stats,progress};
}
function arrayBuffer(value){if(Array.isArray(value))value=Uint8Array.from(value);return value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength);}
(async()=>{
  for(const type of ['xlsx','xls','ods','csv','txt']){
    const book=XLSX.utils.book_new();
    const sheet=XLSX.utils.aoa_to_sheet([['Agent Name','Team','Score %','Interaction Start Time','Notes'],['Doe, Jane','Coach One',.975,new Date(2026,8,1),'Quoted, value\ncontinued'],[],['Another Agent','Coach Two',0,'2026-09-02','']]);
    sheet.C2.z='0.0%';sheet.D2.z='yyyy-mm-dd';
    XLSX.utils.book_append_sheet(book,sheet,'QA');
    if(!['csv','txt'].includes(type)) XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([]),'Empty');
    const bytes=XLSX.write(book,{type:'buffer',bookType:type});
    const expected=XLSX.read(bytes,{type:'buffer',cellDates:true,raw:false}),h=harness();
    const actual=await h.parseAllStarWorkbook(arrayBuffer(bytes));
    assert.deepEqual(actual.SheetNames,expected.SheetNames,type);
    for(const name of expected.SheetNames)assert.deepEqual(actual.__coachToolsAoaBySheet[name],XLSX.utils.sheet_to_json(expected.Sheets[name],{header:1,defval:'',raw:false}),type+' '+name);
    assert.deepEqual(actual.Sheets,{});assert.equal(h.stats.mainParses,0);assert.equal(h.stats.terminated,1);assert.equal(h.stats.revoked,1);
  }
  const monthlyText='Employee Full Name\tWipers Accepted\tWipers Offered\nDoe, Jane\t003\t4';
  const rawBook=XLSX.utils.book_new(),rawSheet=XLSX.utils.aoa_to_sheet([['Date','Name','Consumer Appointment Rate','Count'],[46200,'Jane Doe',.56789,2]]);
  rawSheet.A2.z='m/d/yy';rawSheet.C2.z='0%';rawSheet.D2.z='0"% literal"';XLSX.utils.book_append_sheet(rawBook,rawSheet,'Weekly');
  const rawBytes=XLSX.write(rawBook,{type:'buffer',bookType:'xlsx'}),rawHarness=harness();
  const rawResult=await rawHarness.parseAllStarWorkbook(arrayBuffer(rawBytes),{raw:true,cellDates:false,cellNF:true});
  assert.deepEqual(rawResult.__coachToolsAoaBySheet.Weekly[1],[46200,'Jane Doe',.56789,2]);
  assert.equal(rawResult.Sheets.Weekly.C2.z,'0%');assert.equal(rawResult.Sheets.Weekly.D2,undefined,'quoted percent text is not a percentage unit');
  const monthlyHarness=harness(),monthlyBook=await monthlyHarness.parseAllStarWorkbook(arrayBuffer(Buffer.from(monthlyText)));
  assert.deepEqual(monthlyBook.SheetNames,['Monthly Export']);
  assert.deepEqual(monthlyBook.__coachToolsAoaBySheet['Monthly Export'],monthly.delimited(monthlyText));
  for(const fixture of [{name:'QA.csv',csv:'Agent Name,Team,Score %\nJane Doe,Coach Alpha,97%'},{name:'Retail Weekly Stats.csv',csv:'Date,Name,Coach,Rate\n2026-09-13,Jane Doe,Coach Alpha,56.789%'}]){
    const shared=harness(),actual=await shared.parseAllStarWorkbook(arrayBuffer(Buffer.from(fixture.csv)),{allstarSharedFile:{name:fixture.name,csv:true}});
    const expected=XLSX.read(fixture.csv,{type:'string',cellNF:true,raw:fixture.name.includes('Weekly')});
    assert.deepEqual(actual.SheetNames,expected.SheetNames);
    assert.deepEqual(XLSX.utils.sheet_to_json(actual.Sheets.Sheet1,{header:1,defval:''}),XLSX.utils.sheet_to_json(expected.Sheets.Sheet1,{header:1,defval:''}),'shared chooser keeps its original raw workbook contract');
  }
  const large=harness(),csv=['Agent Name,Team,Score %',...Array.from({length:12001},(_,i)=>`Agent ${i},Coach ${i%10},90%`)].join('\n');
  const parsed=await large.parseAllStarWorkbook(arrayBuffer(Buffer.from(csv)));
  assert.equal(parsed.__coachToolsAoaBySheet.Sheet1.length,12002);assert.ok(large.progress.length>=7,'large worksheet arrives in bounded batches');
  const cancelled=harness(),pending=cancelled.parseAllStarWorkbook(arrayBuffer(Buffer.from(csv)));
  assert.equal(cancelled.cancelAllStarImport(),true);
  await assert.rejects(pending,error=>error.cancelled&&/previous data was kept/.test(error.message));
  assert.equal(cancelled.stats.terminated,1);assert.equal(cancelled.stats.revoked,1);
  const broken=harness();
  await assert.rejects(broken.parseAllStarWorkbook(arrayBuffer(Buffer.from([0x50,0x4b,3,4,0,0,0,0]))));
  assert.equal(broken.stats.terminated,1);assert.equal(broken.stats.revoked,1);assert.equal(broken.stats.mainParses,0);
  console.log('PASS compact worker: XLSX, XLS, ODS, CSV, TSV, dates, formatting, blank sheets, monthly text, batched delivery, cancellation and errors');
})().catch(error=>{console.error(error);process.exitCode=1;});
