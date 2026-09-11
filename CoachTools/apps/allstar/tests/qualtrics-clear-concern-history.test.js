#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {indexedDB}=require('fake-indexeddb');
const insights=require('../qualtrics/insights.js');
const source=fs.readFileSync(require('node:path').join(__dirname,'../qualtrics/generator.html'),'utf8');
function section(start,end){return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));}
const transaction=(db,store,action)=>new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');action(tx.objectStore(store));tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
(async()=>{
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('concern-test',1);r.onupgradeneeded=()=>{r.result.createObjectStore('settings',{keyPath:'key'});r.result.createObjectStore('problemHistory',{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const key='concernHistoryLoadedFile.v1';
 const read=store=>new Promise((resolve,reject)=>{const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const events=[],state={db,history:[],rules:[],report:null};let confirmed=true;
 const context=vm.createContext({console,Map,Set,Date,Promise,QualtricsInsights:insights,state,STORES:{settings:'settings',history:'problemHistory'},CONCERN_HISTORY_LOAD_KEY:key,
 displayName:v=>String(v||'').trim().replace(/\s+/g,' '),getAll:read,toast:message=>events.push(message),window:{confirm:()=>confirmed},
 els:{concernHistoryViewer:{classList:{add(){},remove(){}}},concernHistoryStatusBtn:{setAttribute(){}},importProblemRepsInput:{}},
 rebuildConcernHistoryIndex:()=>{},renderConcernHistoryStatus:()=>events.push('refresh'),refreshReportConcernHistory:()=>{},historyRowsForCurrentReport:()=>[],normalizeConcernHistoryRow:()=>null,
 readFileAsWorkbookRows:async file=>file.parsed,concernHistoryImportSheet:parsed=>({sheet:parsed.sheets[0],header:'Representative'})});
 vm.runInContext(section('function normalizeConcernHistoryLoad','function activeConcernHistoryNameSummary')+section('async function clearConcernHistory','function rebuildConcernHistoryIndex')+section('async function importProblemReps(file)','function debounce'),context);
 const run=(records,cycle={})=>context.queueConcernHistory(()=>context.incrementConcernAppearances(records,cycle));
 await transaction(db,'settings',store=>store.put({key:'rules-and-settings',value:'keep'}));
 await transaction(db,'problemHistory',store=>store.put({id:'stale',repName:'Old Rep'}));state.history=[{id:'stale',repName:'Old Rep'}];
 const imported={name:'history.xlsx',parsed:{fileName:'history.xlsx',sheets:[{sheetName:'Summary',rows:[{Representative:'John Doe',Count:'3X'},{Representative:'Jane Doe',Count:7},{Representative:'Alex Smith',Count:1},{Representative:'broken',Count:'oops'}]}]}};
 await context.importProblemReps(imported);
 assert.equal((await read('problemHistory')).length,0);
 assert.equal(state.concernHistoryLoad.counts.get('john doe'),3);assert.equal(state.concernHistoryLoad.counts.get('jane doe'),7);
 assert(events.some(e=>/1 invalid row/.test(e)));
 const cycle={};await run([{repName:' JOHN  DOE ',ruleId:'a'},{repName:'john doe',ruleId:'b'},{repName:'Jane Doe'}],cycle);
 assert.equal(state.concernHistoryLoad.counts.get('john doe'),4);assert.equal(state.concernHistoryLoad.counts.get('jane doe'),8);assert.equal(state.concernHistoryLoad.counts.get('alex smith'),1);
 await run([{repName:'John Doe'}],cycle);assert.equal(state.concernHistoryLoad.counts.get('john doe'),4);
 await run([{repName:'John Doe'}]);assert.equal(state.concernHistoryLoad.counts.get('john doe'),5);
 state.concernHistoryLoad=null;await context.loadConcernHistorySnapshot();assert.equal(state.concernHistoryLoad.counts.get('john doe'),5);
 await Promise.all([run([{fullName:'John Doe'}]),run([{repName:'John Doe'}])]);assert.equal(state.concernHistoryLoad.counts.get('john doe'),7);
 await context.importProblemReps(imported);assert.equal(state.concernHistoryLoad.counts.get('john doe'),3);
 confirmed=false;await context.clearConcernHistory();assert.equal(state.concernHistoryLoad.counts.get('john doe'),3);
 confirmed=true;await context.clearConcernHistory();assert.equal(state.concernHistoryLoad.counts.size,0);assert.equal((await read('problemHistory')).length,0);
 assert((await read('settings')).some(row=>row.key==='rules-and-settings'));
 await context.loadConcernHistorySnapshot();assert.equal(state.concernHistoryLoad.counts.size,0);
 await assert.rejects(()=>context.commitConcernHistory(()=>({names:[{key:'bad',name:'Bad',count:99}]}),{details:[{}]}));
 assert.equal(state.concernHistoryLoad.counts.size,0);
 await context.loadConcernHistorySnapshot();assert.equal(state.concernHistoryLoad.counts.size,0,'Aborted transaction rolls back saved totals');
 const savedDb=state.db;state.db={transaction(){throw new Error('storage unavailable');}};
 await assert.rejects(()=>run([{repName:'John Doe'}]),/storage unavailable/);assert.equal(state.concernHistoryLoad.counts.size,0);state.db=savedDb;
 const roundTrip=insights.canonicalConcernNames([{Representative:'John Doe',Count:'3X'},{Representative:'JOHN  DOE',Count:3},{Representative:'Zero Person',Count:0}]);
 assert.deepEqual(roundTrip.names.map(n=>n.count),[3,0]);
 const detail=insights.canonicalConcernNames([{Representative:'John Doe',RunID:'a',RuleID:'1',AppearanceCount:20},{Representative:'John Doe',RunID:'a',RuleID:'2'},{Representative:'John Doe',RunID:'b',RuleID:'1'}]);
 assert.equal(detail.names[0].count,2);
 assert(source.includes('await incrementConcernAppearances(flagged,report)'));
 db.close();console.log('PASS canonical Concern History: authoritative import, cycles, reload, concurrency, clear, failed writes, legacy counts');
})().catch(error=>{console.error(error);process.exitCode=1;});
