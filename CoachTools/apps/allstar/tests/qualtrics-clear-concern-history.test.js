#!/usr/bin/env node
'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const generator=fs.readFileSync(path.join(__dirname,'../qualtrics/generator.html'),'utf8');
assert.match(generator,/<button class="btn bad" id="clearConcernHistoryBtn" type="button">Clear Concern History<\/button>/);
assert.match(generator,/els\.clearConcernHistoryBtn\.onclick=clearConcernHistory/);

const start=generator.indexOf('async function clearConcernHistory(){');
const end=generator.indexOf('async function loadConcernHistorySnapshot(){',start);
assert.ok(start>=0&&end>start,'The dedicated clearConcernHistory function must be present.');
const functionSource=generator.slice(start,end);

function makeHarness(confirmResult=true){
  const stores={
    problemHistory:new Map([
      ['one',{id:'one',repName:'John Smith',ruleId:'rule-a'}],
      ['two',{id:'two',repName:'John Smith',ruleId:'rule-a'}],
      ['three',{id:'three',repName:'Jane Doe',ruleId:'rule-b'}]
    ]),
    settings:new Map([
      ['concernHistoryLoadedFile.v1',{key:'concernHistoryLoadedFile.v1',names:[{name:'John Smith',count:2}]}],
      ['report-settings',{key:'report-settings',audience:'all'}]
    ]),
    rules:new Map([
      ['rule-a',{id:'rule-a',title:'Rule A',coaching:{mode:'descriptionContains',descriptionPhrases:['Needs follow-up']}}],
      ['rule-b',{id:'rule-b',title:'Rule B'}]
    ])
  };
  const sourceRows={qaRows:[1,2],coachingRows:[1,2,3],checklistRows:[1],weeklyStatsRows:[1,2,3,4]};
  const state={
    history:[...stores.problemHistory.values()],
    historyIndex:{occurrences:new Map([['old',{}]]),nameCounts:new Map([['john smith',2]]),reportCounts:new Map([['john smith\u001fname:rule a',2]]),rowsByRepRule:new Map([['john\u001frule-a',[{}]]])},
    concernHistoryLoad:{fileName:'loaded.xlsx',counts:new Map([['john smith',2]])},
    concernHistoryExpanded:true,
    historyWarnings:['old warning'],
    report:{flagged:[{repName:'John Smith',concernHistory:{appearanceCount:3,appearanceLabel:'3X',status:'Undercoached'}}]},
    ...sourceRows
  };
  const events=[], viewerClasses=new Set(), attributes={};
  const context={
    window:{confirm:()=>{ events.push('confirm'); return confirmResult; }},
    console,
    STORES:{history:'problemHistory',settings:'settings',rules:'rules'},
    CONCERN_HISTORY_LOAD_KEY:'concernHistoryLoadedFile.v1',
    state,
    els:{
      concernHistoryViewer:{classList:{add:value=>viewerClasses.add(value)}},
      concernHistoryStatusBtn:{setAttribute:(key,value)=>{ attributes[key]=value; }}
    },
    clearStore:async store=>{ events.push(`clear:${store}`); stores[store].clear(); },
    del:async (store,key)=>{ events.push(`delete:${store}:${key}`); stores[store].delete(key); },
    rebuildConcernHistoryIndex:()=>{
      events.push('rebuild');
      state.historyIndex={occurrences:new Map(),nameCounts:new Map(),reportCounts:new Map(),rowsByRepRule:new Map()};
    },
    renderConcernHistoryStatus:()=>events.push('status'),
    refreshReportConcernHistory:()=>{
      events.push('refresh');
      state.report.flagged[0].concernHistory={appearanceCount:1,appearanceLabel:'1X',status:'New'};
    },
    toast:message=>events.push(`toast:${message}`)
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource}\nthis.runClear=clearConcernHistory;`,context);
  return {context,stores,state,events,viewerClasses,attributes,sourceRows};
}

(async()=>{
  const cancelled=makeHarness(false);
  const cancelledSnapshot=JSON.stringify([...cancelled.stores.problemHistory]);
  await cancelled.context.runClear();
  assert.deepEqual(cancelled.events,['confirm'],'Cancel must perform no work or show a success toast.');
  assert.equal(JSON.stringify([...cancelled.stores.problemHistory]),cancelledSnapshot);
  assert.ok(cancelled.stores.settings.has('concernHistoryLoadedFile.v1'));
  assert.equal(cancelled.state.report.flagged[0].concernHistory.appearanceLabel,'3X');

  const cleared=makeHarness(true);
  const rulesBefore=structuredClone([...cleared.stores.rules]);
  const sourcesBefore=Object.fromEntries(Object.entries(cleared.sourceRows).map(([key,rows])=>[key,rows.length]));
  await cleared.context.runClear();
  assert.equal(cleared.stores.problemHistory.size,0,'Saved detailed history must be cleared.');
  assert.ok(!cleared.stores.settings.has('concernHistoryLoadedFile.v1'),'The loaded spreadsheet snapshot must be deleted.');
  assert.deepEqual(cleared.stores.settings.get('report-settings'),{key:'report-settings',audience:'all'},'Unrelated settings must remain.');
  assert.deepEqual([...cleared.stores.rules],rulesBefore,'Rules, including description phrases, must remain byte-for-byte equivalent.');
  assert.deepEqual(Object.fromEntries(Object.entries(cleared.sourceRows).map(([key,rows])=>[key,rows.length])),sourcesBefore,'All source row collections must remain unchanged.');
  assert.equal(cleared.state.history.length,0);
  assert.equal(cleared.state.concernHistoryLoad,null);
  assert.equal(cleared.state.concernHistoryExpanded,false);
  assert.equal(cleared.state.historyWarnings.length,0);
  for(const key of ['occurrences','nameCounts','reportCounts','rowsByRepRule']) assert.equal(cleared.state.historyIndex[key].size,0,`${key} must be empty.`);
  assert.equal(cleared.state.report.flagged[0].concernHistory.appearanceLabel,'1X','The current report must recalculate from an empty baseline.');
  assert.ok(cleared.viewerClasses.has('hidden'));
  assert.equal(cleared.attributes['aria-expanded'],'false');
  assert.ok(cleared.events.includes('toast:Concern History cleared. Rules and source data were kept.'));

  const alreadyEmpty=makeHarness(true);
  alreadyEmpty.stores.problemHistory.clear();
  alreadyEmpty.stores.settings.delete('concernHistoryLoadedFile.v1');
  alreadyEmpty.state.history=[];
  alreadyEmpty.state.concernHistoryLoad=null;
  await assert.doesNotReject(()=>alreadyEmpty.context.runClear());
  console.log('PASS Qualtrics clear Concern History tests');
})().catch(error=>{ console.error(error); process.exitCode=1; });
