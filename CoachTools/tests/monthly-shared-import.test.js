'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const idb=require('fake-indexeddb'),{parseHTML}=require('linkedom');
const {document}=parseHTML('<html><body><button data-action="clean-upload-data">Clean</button><button data-action="update-data">Update</button><input id="quickDataInput"></body></html>');
const values=new Map(),context=vm.createContext({...idb,document,console,setTimeout,clearTimeout,queueMicrotask,structuredClone,TextDecoder,TextEncoder,XLSX:require('../vendor/xlsx.full.min.js'),location:{protocol:'file:'},localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},addEventListener(){},removeEventListener(){},dispatchEvent(){},CustomEvent:function(type,init){this.type=type;this.detail=init?.detail;},confirm(){return true;}});context.window=context;context.parent=context;
for(const name of ['storage','sync','monthly','monthly-review','import','source-scope','remembered-scope'])vm.runInContext(fs.readFileSync(path.join(__dirname,`../shared/coachtools-${name}.js`),'utf8'),context);
const M=context.CoachToolsMonthly,api=context.CoachToolsImport,data=context.CoachToolsData;
const plain=x=>JSON.parse(JSON.stringify(x));
const op=[['','','',...Array(9).fill('OPPORTUNITY_LATEST_SEGMENT')],['','','',...['COMMERCIAL','CONSUMER','INSURANCE'].flatMap(s=>[s,s,s])],['','','',...Array.from({length:3},()=>['Opportunities','Appointments','Appt Rate']).flat()],['Coach A','Rep A','',10,8,'80.0%',10,8,'80.0%',10,8,'80.0%']];
const wipe=[['REPORT DATE','EMPLOYEE_FULL_NAME','WIPERS_ACCEPTED','WIPERS_OFFERED'],['9/27/2026','Rep A',4,10]];
function csv(name,rows){const bytes=Buffer.concat([Buffer.from([255,254]),Buffer.from(rows.map(r=>r.join('\t')).join('\r\n'),'utf16le')]);return {name,size:bytes.length,lastModified:1,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length)};}
let reviews=0;context.CoachToolsMonthlyReview.review=async options=>{reviews++;let b=M.asUndated(options.bundle);for(const source of options.sources)b=M.add(b,source).bundle;b.scope='mixed';b.partialAcknowledged=true;b.consumerAsCash=true;b.importedAt=new Date().toISOString();return b;};
(async()=>{
 await data.ready();
 await data.importDataset('qa',{meta:{fileName:'qa'},workbook:{sheets:['QA'],data:{QA:{aoa:[['Team','Agent Name','Score %'],['Coach A','Rep A',90]]}}}},{originalFileName:'qa',rowCount:1});
 document.querySelector('[data-action="clean-upload-data"]').click();
 const clean=await api.analyzeFiles([csv('opportunity.csv',op),csv('wiper.csv',wipe)]);assert.equal(clean.errors.length,0,clean.errors.map(e=>e.error?.stack||String(e.error)).join('\n'));assert.equal(clean.recognized.length,1);assert.equal(reviews,1);
 const candidate=await api.prepareRecognizedEntry(clean.recognized[0],{scope:{mode:'all',label:'All people'}});
 const legacy=plain(candidate.dataset);delete legacy.meta.monthlyBundle;
 await data.importDataset('monthlyRetail',legacy,{importedAt:'2025-01-01T00:00:00Z',detectedPeriod:{label:'Future legacy period',periodKey:'2099-12',sortKey:'2099-12'},scopedFingerprint:'legacy-future-period'});
 assert.equal((await data.getCurrent('monthlyRetail',{includeRecord:true})).detectedPeriod.periodKey,'2099-12');
 const inspection=await data.inspectDataset('monthlyRetail',candidate.dataset,{detectedPeriod:clean.recognized[0].classification.detectedPeriod,scopedFingerprint:candidate.scopedFingerprint});
 assert.equal(inspection.becomesCurrent,true,JSON.stringify(inspection));assert.match(inspection.reason,/date loaded/);
 for(const e of clean.recognized)await api.saveRecognizedEntry(e,{scope:{mode:'all',label:'All people'}});
 const saved=await data.getCurrent('monthlyRetail',{includeRecord:true});assert.equal(saved.data.meta.monthlyBundle.wipers.length,1);assert.equal(M.compile(saved.data.meta.monthlyBundle).reps[0].wiper.accepted,4);assert.ok(await data.getCurrent('qa'));assert.equal(saved.detectedPeriod.label,'Non-dated');assert.equal(saved.data.meta.monthlyPeriod,null);assert.equal(saved.data.meta.detectedPeriod.periodKey,'undated');assert.equal(saved.data.meta.monthlyBundle.coachAreas['coach a'],undefined);assert.equal(M.compile(saved.data.meta.monthlyBundle).reps[0].area,'retail');
 const extra=await api.analyzeFiles([csv('second wiper.csv',[wipe[0],['9/20/2026','rep a',6,20]])]);assert.equal(extra.recognized.length,1);assert.equal(extra.recognized[0].parsed.meta.monthlyBundle.wipers.length,2);
 const prepared=await api.prepareRecognizedEntry(extra.recognized[0],{scope:{mode:'all',label:'All people'}});assert.equal(M.compile(prepared.dataset.meta.monthlyBundle).reps[0].wiper.accepted,10);
 await api.saveRecognizedEntry(extra.recognized[0],{scope:{mode:'all',label:'All people'}});
 const latest=await data.getCurrent('monthlyRetail',{includeRecord:true});assert.equal(M.compile(latest.data.meta.monthlyBundle).reps[0].wiper.offered,30);
 const duplicate=await api.analyzeFiles([csv('renamed (2).csv',wipe)]);assert.equal(duplicate.recognized[0].parsed.meta.monthlyBundle.wipers.length,2);
 // New undated Wiper data remains additive without reporting-period assignments.
 const updated=await api.analyzeFiles([csv('third.csv',[wipe[0],['not a date','rep a',1,5]])]);
 await api.saveRecognizedEntry(updated.recognized[0],{scope:{mode:'all',label:'All people'}});
 const nonDated=await data.getCurrent('monthlyRetail',{includeRecord:true});assert.equal(nonDated.detectedPeriod.periodKey,'undated');assert.equal(M.compile(nonDated.data.meta.monthlyBundle).reps[0].wiper.accepted,11);
 const raw=await api.parseFile(csv('opportunity.csv',op));assert.throws(()=>api.prepareScopedDataset(raw,'monthlyRetail',{mode:'all'}),/review/i);
 const scoped=api.prepareScopedDataset(latest.data,'monthlyRetail',{mode:'coach',coaches:['Coach A'],label:'Coach A'});assert.equal(scoped.valid,true);assert.deepEqual(plain(scoped.dataset.meta.monthlySelection),[['Rep A','Coach A']]);
 const zero=api.prepareScopedDataset(latest.data,'monthlyRetail',{mode:'coach',coaches:['Other Coach'],label:'Other'});assert.equal(zero.valid,false);
 const hierarchy=require('../apps/allstar/tests/fixtures/monthly-hierarchy.js');
 const modern=await api.analyzeFiles([csv('new-op.csv',hierarchy.opportunity),csv('new-wiper.csv',hierarchy.wiper)]);assert.equal(modern.errors.length,0);assert.equal(modern.recognized.length,2);
 for(const entry of modern.recognized){const staged=await api.prepareRecognizedEntry(entry,{scope:{mode:'all',label:'All people'}});assert.equal(staged.dataset.meta.monthlySelection,null);await api.saveRecognizedEntry(entry,{scope:{mode:'all',label:'All people'}});}
 const modernSaved=await data.getCurrent('monthlyRetail',{includeRecord:true}),modernOut=M.compile(modernSaved.data.meta.monthlyBundle);assert.equal(modernOut.overall.wiper.accepted,20);assert.equal(modernOut.teams.find(t=>t.coach==='Coach A').segments.consumer.opportunities,15);assert.equal(modernOut.managers.reduce((n,m)=>n+(m.wiper.accepted||0),0),20);
 assert.ok(await data.getCurrent('qa'));
 console.log('PASS manager exports through shared Clean Upload / Update Data, full-scope subtotal authority and unresolved Wiper retention');
 console.log('PASS real shared Clean Upload, UTF-16 intake, staged monthly review, additive updates, duplicate prevention, scope preservation, QA retention');
})().catch(e=>{console.error(e);process.exitCode=1;});
