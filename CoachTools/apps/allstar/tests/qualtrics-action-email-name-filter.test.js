#!/usr/bin/env node
'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const bridge=fs.readFileSync(path.join(__dirname,'../js/qualtrics-bridge.js'),'utf8');
const start=bridge.indexOf('function qualtricsActionEmailNameFilterInstaller(){');
const end=bridge.indexOf('function installQualtricsActionEmailNameFilter(){',start);
assert.ok(start>=0&&end>start,'The Action Report email name-filter installer must be present.');
const functionSource=bridge.slice(start,end);

function makeHarness(savedValue=null){
  const eventListeners={};
  const storage=new Map();
  if(savedValue!==null) storage.set('coachingEmailGeneratorActionExcludeNumericNames',savedValue);
  let insertedLabel=null;
  const exportButton={
    insertAdjacentElement:(position,element)=>{
      assert.equal(position,'afterend');
      insertedLabel=element;
    },
    addEventListener:(type,handler,capture)=>{ eventListeners[type]={handler,capture}; }
  };
  const document={
    getElementById:id=>{
      if(id==='exportEmailsBtn') return exportButton;
      if(id==='actionExcludeInvalidNumericNames') return null;
      return null;
    },
    createElement:tag=>{
      if(tag==='label') return {className:'',style:{},title:'',children:[],append(...children){ this.children.push(...children); }};
      if(tag==='input') return {id:'',type:'',checked:false,listeners:{},addEventListener(type,handler){ this.listeners[type]=handler; }};
      throw new Error(`Unexpected element: ${tag}`);
    },
    createTextNode:text=>({textContent:text})
  };
  const state={report:{flagged:[
    {rep:'Jane Smith'},
    {rep:'12345'},
    {rep:'7.0'},
    {rep:'John23'},
    {rep:'Agent7'},
    {rep:'Mary Jones'}
  ]}};
  const originalFlagged=state.report.flagged;
  let exportedRows=null;
  const context={
    document,
    state,
    localStorage:{
      getItem:key=>storage.has(key)?storage.get(key):null,
      setItem:(key,value)=>storage.set(key,value)
    },
    exportEmails:async()=>{ exportedRows=state.report.flagged.map(row=>row.rep); },
    console
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource}\nthis.installFilter=qualtricsActionEmailNameFilterInstaller;`,context);
  context.installFilter();
  return {context,state,originalFlagged,eventListeners,storage,get insertedLabel(){ return insertedLabel; },get exportedRows(){ return exportedRows; }};
}

(async()=>{
  const harness=makeHarness();
  assert.ok(harness.insertedLabel,'The filter control should be placed next to Generate Emails.');
  const checkbox=harness.insertedLabel.children[0];
  assert.equal(checkbox.id,'actionExcludeInvalidNumericNames');
  assert.equal(checkbox.checked,true,'The Action Report exclusion should default on.');
  assert.equal(harness.insertedLabel.children[1].textContent,' Exclude Number-Only Names');
  assert.equal(harness.eventListeners.click.capture,true,'Filtering must run before the existing Generate Emails click handler.');

  const event={prevented:false,stopped:false,preventDefault(){ this.prevented=true; },stopImmediatePropagation(){ this.stopped=true; }};
  await harness.eventListeners.click.handler(event);
  assert.equal(event.prevented,true);
  assert.equal(event.stopped,true);
  assert.deepEqual(harness.exportedRows,['Jane Smith','Agent7','Mary Jones']);
  assert.equal(harness.state.report.flagged,harness.originalFlagged,'The full Action Report data must be restored after email generation.');

  checkbox.checked=false;
  checkbox.listeners.change();
  assert.equal(harness.storage.get('coachingEmailGeneratorActionExcludeNumericNames'),'false');

  const disabled=makeHarness('false');
  const disabledCheckbox=disabled.insertedLabel.children[0];
  assert.equal(disabledCheckbox.checked,false,'A saved opt-out should remain respected.');
  const disabledEvent={prevented:false,stopped:false,preventDefault(){ this.prevented=true; },stopImmediatePropagation(){ this.stopped=true; }};
  await disabled.eventListeners.click.handler(disabledEvent);
  assert.equal(disabledEvent.prevented,false);
  assert.equal(disabledEvent.stopped,false);
  assert.equal(disabled.exportedRows,null,'When disabled, the existing Generate Emails handler should be allowed to run normally.');

  console.log('qualtrics-action-email-name-filter tests passed');
})().catch(err=>{ console.error(err); process.exitCode=1; });
