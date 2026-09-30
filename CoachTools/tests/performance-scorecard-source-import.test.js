'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../shared/weekly-data-builder-core.js');
const S=require('../shared/performance-scorecard-source-import.js');
const F=require('./fixtures/performance-scorecard-source-exports.js');
function parity(appointmentRows,wiperRows,options={}) {
 const sources={appointments:{rows:appointmentRows,period:options.appointmentPeriod||''},wipers:{rows:wiperRows,period:options.wiperPeriod||''}};
 const worksheet=S.importSources(sources);
 const builder=C.assemble({appointmentRows,wiperRows,weeklyRows:[S.header],date:'2026-09-27',options});
 assert.deepEqual(worksheet.result.newRows.map(r=>r.slice(1)),builder.newRows.map(r=>r.slice(1)));
 assert.deepEqual(worksheet.result.review,builder.review);
 return worksheet;
}
test('hierarchical multirow segments and current COUNT fields have builder parity',()=>{
 const r=parity(F.opportunities(),F.wipers());assert.equal(r.rows.length,1);
 assert.equal(r.rows[0].name,'Alex Reed');assert.equal(r.rows[0].coach,'Coach A');assert.equal(r.rows[0].manager,'Manager One');
 assert.equal(r.rows[0].metrics.consumer.value,.6);assert.equal(r.rows[0].metrics.insurance.value,.95);
 assert.equal(r.rows[0].metrics.commercial.value,.5);assert.equal(r.rows[0].metrics.wiper.num,3);assert.equal(r.rows[0].metrics.wiper.den,8);
 assert.equal(r.result.stats.skipped,5);
});
test('legacy identity and accepted/offered layouts have builder parity',()=>{
 const r=parity([['','','','CONSUMER','CONSUMER'],['','','','Opportunities','Appointments'],['Coach A','Alex Reed','Week',10,6]], [['Report Date','Employee Full Name','Wipers Accepted','Wipers Offered'],['Week','ALEX  REED',3,8]]);
 assert.equal(r.rows.length,1);assert.equal(r.rows[0].metrics.wiper.value,3/8);
});
test('duplicate names retain coach identity; coachless ambiguity is held for review',()=>{
 const a=F.opportunities([['Manager','Coach A','Same Name','Week',2,1,'50%',10,6,'60%',20,19,'95%'],['Manager','Coach B','Same Name','Week',2,1,'50%',10,7,'70%',20,19,'95%']]);
 const r=parity(a,F.wipers([['9/27/2026','Coach B','Same Name',7,14],['9/27/2026','Coach A','Same Name',3,8]]));
 assert.equal(new Set(r.rows.map(x=>x.key)).size,2);assert.equal(r.rows.find(x=>x.coach==='Coach B').metrics.wiper.num,7);
 const ambiguous=parity(a,[['Report Date','Employee Full Name','Wipers Accepted','Wipers Offered'],['9/27/2026','Same Name',7,14]]);
 assert.equal(ambiguous.result.stats.ambiguous,1);assert.ok(ambiguous.rows.every(x=>!x.metrics.wiper));
});
test('multiple source periods require a selection and source labels need not match',()=>{
 const w=F.wipers([['9/20/2026','Coach A','Alex Reed',1,2],['9/27/2026','Coach A','Alex Reed',3,8]]);
 assert.throws(()=>S.importSources({wipers:{rows:w}}),/Choose one source period/);
 assert.equal(parity(F.opportunities(),w,{wiperPeriod:'9/27/2026'}).rows[0].metrics.wiper.value,3/8);
});
test('missing fields, zeros, duplicates and conflicting records preserve builder parity',()=>{
 const detail=['Manager','Coach A','Alex Reed','Week',0,0,'',10,0,'0%',20,'',''];
 const r=parity(F.opportunities([detail,detail]),F.wipers([['9/27/2026','Coach A','Alex Reed',0,8]]));
 assert.equal(r.rows[0].metrics.consumer.value,0);assert.equal(r.rows[0].metrics.commercial.num,0);assert.equal(r.rows[0].metrics.commercial.den,0);
 assert.ok(Number.isNaN(r.rows[0].metrics.commercial.value));assert.equal(r.rows[0].metrics.wiper.value,0);assert.equal(r.rows[0].metrics.insurance.den,20);
 const conflict=parity(F.opportunities([detail,[...detail.slice(0,8),4,...detail.slice(9)]]),F.wipers());
 assert.equal(conflict.result.stats.conflicts,1);assert.ok(Number.isNaN(conflict.rows[0].metrics.consumer.num));
});
test('one-source imports remain separate from stored data; adding the other completes one identity',()=>{
 const a=S.importSources({appointments:{rows:F.opportunities()}});assert.equal(a.rows.length,1);assert.ok(!a.rows[0].metrics.wiper);
 const w=S.importSources({wipers:{rows:F.wipers([['9/27/2026','Coach B','Wiper Only',0,4]])}});assert.equal(w.rows[0].coach,'Coach B');assert.ok(!w.rows[0].metrics.consumer);assert.equal(w.rows[0].metrics.wiper.value,0);
 assert.equal(S.importSources({appointments:{rows:F.opportunities()},wipers:{rows:F.wipers()}}).rows.length,1);
});
test('saved name and coach replacements are shared with the builder',()=>{
 require('../shared/coachtools-stats-directory.js');
 const D=globalThis.CoachToolsStatsDirectory,old=D.resolve;
 // Use the real directory rewrite with explicit settings, without storing report data.
 const settings=D.validate({version:1,links:[],aliases:[{role:'name',from:'Old Name',to:'Alex Reed'},{role:'coach',from:'Old Coach',to:'Coach A'}]});
 const original=D.rewriteRows;D.rewriteRows=(rows,analysis)=>original(rows,analysis,settings);
 try {const r=parity(F.opportunities(),F.wipers([['9/27/2026','Old Coach','Old Name',5,12]]));assert.equal(r.rows.length,1);assert.equal(r.rows[0].metrics.wiper.num,5);}finally{D.rewriteRows=original;D.resolve=old;}
});
test('extracted core still supplies a standalone worker parser',()=>{
 const vm=require('node:vm');const context=vm.createContext({TextDecoder,TextEncoder});vm.runInContext(C.workerSource(),context);
 assert.equal(context.WeeklyCore.parseDelimited('A,B\n1,2').rows[1][1],'2');
});
