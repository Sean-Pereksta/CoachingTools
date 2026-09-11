'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const context=vm.createContext({console,setTimeout});context.window=context;
vm.runInContext(fs.readFileSync(path.join(__dirname,'../shared/coachtools-import.js'),'utf8'),context);
const api=context.CoachToolsImport;
const parsed=rows=>({meta:{totalRows:rows.length},workbook:{sheets:['Data'],data:{Data:{aoa:rows}}}});
for(const type of ['weeklyRetail','weeklyReferral']){
 const rows=type==='weeklyRetail'?[['Sheet','Representative','Cash Opps'],['Angela Johnson','Jane Doe',12]]:[['Representative','Coach','Scheduled'],['Jane Doe','Angela Johnson',0]];
 for(const scope of [{mode:'coach',coaches:['Angie Johnson'],coachKeys:['angie johnson'],label:'Angie Johnson'},{mode:'coach',coaches:[],coachKeys:[]}]){
  const result=api.prepareScopedDataset(parsed(rows),type,scope);
  assert(result.valid);assert.equal(result.dataset.workbook.data.Data.aoa.length,2);assert(result.diagnostics.warnings.length);
 }
 assert.throws(()=>api.prepareScopedDataset(parsed([['Unrelated'],['Bad file']]),type,{mode:'all'}),/Missing|column|header/i);
}
const correct=api.prepareScopedDataset(parsed([['Sheet','Representative'],['Angela Johnson','Jane Doe'],['Different Coach','Other Rep']]),'weeklyRetail',{mode:'coach',coaches:['Angela Johnson'],coachKeys:['angela johnson']});
assert.equal(correct.dataset.workbook.data.Data.aoa.length,2,'An available weekly source selection is respected');
console.log('PASS authoritative weekly scope fallback and corrupt-header protection');
