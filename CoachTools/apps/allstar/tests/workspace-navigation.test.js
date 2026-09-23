#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {parseHTML}=require('linkedom');
const navigation=require('../js/workspace-navigation.js');

const sources=[
  {id:'retail_sv2',label:'Retail SV2',headers:['Consumer Appointments','Consumer Opportunities'],rowCount:100000,fileName:'Retail Weekly.xlsx',updatedAt:'2026-09-23T10:00:00Z'},
  {id:'nondate',label:'Non-Dated',headers:['Representative'],rowCount:40,categorized:true},
  {id:'date',label:'Dated',headers:['Date'],rowCount:120,categorized:true}
];
let statisticalReads=0;
const unscannable=new Proxy([],{get(target,key){statisticalReads++;throw new Error('Navigation must not read statistical rows: '+String(key));}});
const app={models:[{id:'appointments',name:'Appointment Rate',criteria:[{id:'cash',name:'Cash appointments'}]}],researchItems:[{id:'trend',title:'12 Week Trend',outputType:'line'}],metrics:[{id:'cashRate',name:'Cash Appointment Rate',field:'Consumer Appointments / Consumer Opportunities'}],orgs:[{id:'north',name:'North',coachNames:['Coach A']}],teams:['Coach A'],data:{retail:{controlRoster:[{_rep:'Catherine Mock',_team:'Coach A'},{_rep:'Catherine Mock',_team:'Coach B'}],sv2:unscannable}},categorized:{stale:true,warnings:['Review date column']},identityConflicts:[{name:'conflict'}]};
const catalog=navigation.buildCatalog(app,sources,[{id:'report1',modelName:'August report'}],[{id:'chart1',title:'Cash trend'}]);
assert.equal(statisticalReads,0,'Search uses metadata and roster indexes, never statistical rows');
assert.equal(navigation.searchCatalog(catalog,'run appointment rate')[0].id,'run:appointments');
assert.equal(navigation.searchCatalog(catalog,'consumer opportunities')[0].id,'column:retail_sv2:Consumer Opportunities');
assert.equal(navigation.searchCatalog(catalog,'find catherine mock').length,2,'Same-name representatives on different teams stay separate');
assert.equal(navigation.searchCatalog(catalog,'open research')[0].id,'action:research');
assert.equal(navigation.searchCatalog(catalog,'cash trend')[0].id,'chart:chart1');
assert.equal(navigation.searchCatalog(catalog,'august report')[0].id,'report:report1');
assert.equal(navigation.searchCatalog(catalog,'',{favorites:['research:trend']})[0].id,'research:trend');
assert.equal(navigation.searchCatalog([{id:'accent',label:'José',category:'Representatives'}],'jose')[0].id,'accent');
const summary=navigation.sourceSummary(app,sources);
assert.equal(summary.rows,100000,'Home must not double-count categorized copies of source rows');
assert.equal(summary.categorizedRows,160);
assert.equal(summary.loaded,1);
assert.equal(summary.identityCount,1);
assert.equal(summary.warningCount,1);
assert.equal(summary.stale,true);
assert.deepEqual(navigation.readPreferences({getItem(){throw new Error('Storage blocked');}}),{favorites:[],recent:[]});
assert.deepEqual(navigation.readPreferences({getItem(){return '{broken';}}),{favorites:[],recent:[]});

async function integration(){
  const {window,document}=parseHTML('<html><body><div class="toolbar"><select id="categoriesDrop"><option value="">Categories</option><option value="models">Models</option></select><button id="runBtn">Run</button><div id="topStatus">Ready</div></div><div id="workArea"><div class="empty"></div></div><div id="modelsModal" class="modalBackdrop"><div id="modelList"></div></div><div id="editModelModal" class="modalBackdrop"></div><select id="runModelSelect"><option value="appointments">Appointment Rate</option></select><div id="criteriaList"></div><div id="importModal" class="modalBackdrop"></div><div id="researchEditorModal" class="modalBackdrop"></div><input id="researchEditId"><div id="teamsModal" class="modalBackdrop"></div><input id="teamRepSearch"></body></html>');
  const storage=new Map(), calls=[];
  Object.assign(window,{console,setTimeout,clearTimeout,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)}});
  let focused=document.body;
  Object.defineProperty(document,'activeElement',{get:()=>focused});
  window.HTMLElement.prototype.focus=function(){focused=this;};
  window.HTMLElement.prototype.scrollIntoView=function(){};
  const legacy=document.getElementById('categoriesDrop');
  // Linkedom exposes select.value as read-only; browsers implement both accessor sides.
  Object.defineProperty(document.getElementById('runModelSelect'),'value',{value:'appointments',writable:true,configurable:true});
  legacy.onchange=()=>calls.push(['legacy']);
  document.getElementById('runBtn').onclick=()=>calls.push(['run']);
  document.getElementById('runModelSelect').onchange=()=>calls.push(['selected',document.getElementById('runModelSelect').value]);
  const context=vm.createContext({window,document,console,setTimeout,clearTimeout});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/workspace-navigation.js'),'utf8'),context);
  const api=window.AllStarWorkspaceNavigation.createController({document,storage:window.localStorage,getState:()=>app,getSources:()=>sources,actions:{
    openModal:id=>{calls.push(['open',id]);document.getElementById(id)?.classList.add('open');},
    closeModal:id=>{calls.push(['close',id]);document.getElementById(id)?.classList.remove('open');},
    renderModelList:()=>calls.push(['renderModels']),
    openEditModel:id=>{calls.push(['editModel',id]);app.editOriginalId=id;document.getElementById('editModelModal').classList.add('open');},
    openResearchItemEditor:id=>calls.push(['research',id]),
    openTeamsImported:()=>calls.push(['teams']),loadTeamDetails:team=>calls.push(['team',team]),
    openSavedReport:id=>calls.push(['report',id]),
    listSavedReports:async()=>[{id:'report1',modelName:'August report',report:{huge:'Excluded from navigation metadata'}}]
  }});
  api.init();api.init();
  assert.equal(document.querySelectorAll('#asWorkspaceHeader').length,1,'Repeated initialization is harmless');
  assert.equal(document.getElementById('categoriesDrop'),legacy,'Original controls are moved, never recreated');
  legacy.dispatchEvent(new window.Event('change'));
  assert.ok(calls.some(x=>x[0]==='legacy'),'Existing handlers survive the navigation upgrade');
  assert.ok(document.getElementById('asLegacyTools').contains(legacy),'All legacy entries remain reachable');
  assert.equal(document.querySelectorAll('[data-as-section]').length,9);
  assert.equal(document.getElementById('workArea').hidden,true);

  await api.execute('model:appointments');
  assert.ok(calls.some(x=>x[0]==='editModel'&&x[1]==='appointments'));
  assert.equal(api.getPreferences().recent[0].id,'model:appointments');
  api.toggleFavorite('model:appointments');
  assert.ok(JSON.parse([...storage.values()][0]).favorites.includes('model:appointments'));
  assert.ok(document.getElementById('asWorkspacePanel').textContent.includes('Appointment Rate'));
  await api.execute('research:trend');
  assert.ok(calls.some(x=>x[0]==='research'&&x[1]==='trend'));
  assert.ok(calls.some(x=>x[0]==='close'&&x[1]==='editModelModal'),'Switching destination uses existing close hooks so old modals cannot obscure it');
  await api.execute('action:settings');
  await api.execute('model:appointments');
  document.getElementById('editModelModal').classList.remove('open');
  await new Promise(resolve=>setTimeout(resolve,140));
  assert.ok(document.getElementById('asWorkspacePanel').textContent.includes('Settings and tools'),'Closing a modal preserves the underlying workspace');

  const opener=document.querySelector('[data-as-open-palette]');opener.focus();
  const keyboard=(key,extra={},target=document)=>{const event=new window.Event('keydown',{bubbles:true,cancelable:true});Object.assign(event,{key,...extra});target.dispatchEvent(event);return event;};
  keyboard('k',{ctrlKey:true});
  assert.equal(document.getElementById('asCommandPalette').hidden,false,'Ctrl+K opens search');
  const input=document.getElementById('asCommandInput');
  assert.equal(document.activeElement,input);
  keyboard('Tab',{},input);
  assert.equal(document.activeElement,document.getElementById('asCommandFavorite'));
  keyboard('Tab',{},document.activeElement);
  assert.equal(document.activeElement,document.getElementById('asCommandClose'));
  keyboard('Tab',{},document.activeElement);
  assert.equal(document.activeElement,input,'Tab stays in the command dialog');
  keyboard('Tab',{shiftKey:true},input);
  assert.equal(document.activeElement,document.getElementById('asCommandClose'),'Reverse Tab wraps within the dialog');
  input.focus();
  input.value='run appointment rate';input.dispatchEvent(new window.Event('input',{bubbles:true}));
  assert.ok(document.getElementById('asCommandResults').textContent.includes('Run Appointment Rate'));
  assert.equal(input.getAttribute('aria-activedescendant'),'asCommandOption0');
  keyboard('Enter',{},input);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(document.getElementById('asCommandPalette').hidden,true,'Enter launches and closes search');
  assert.ok(calls.some(x=>x[0]==='run'),'Run command reaches existing setup');
  assert.ok(calls.some(x=>x[0]==='selected'&&x[1]==='appointments'),'Run selects requested model through existing change handler');
  assert.equal(document.activeElement,opener,'Closing search restores keyboard focus');
  keyboard('k',{metaKey:true});
  keyboard('ArrowDown',{},input);
  assert.equal(input.getAttribute('aria-activedescendant'),'asCommandOption1');
  keyboard('Escape',{},input);
  assert.equal(document.getElementById('asCommandPalette').hidden,true);

  await api.execute('action:reports');
  assert.equal(document.getElementById('workArea').hidden,false);
  assert.equal(document.getElementById('asWorkspacePanel').hidden,true);
  assert.ok(document.querySelector('[data-as-report-empty]'),'Empty report workspace teaches next action');
  await api.loadReportMetadata(true);
  await api.execute('report:report1');
  assert.ok(calls.some(x=>x[0]==='report'&&x[1]==='report1'));
  assert.ok(!JSON.stringify(api.getCatalog()).includes('Excluded from navigation metadata'));
  const persisted=navigation.readPreferences(window.localStorage);
  assert.ok(persisted.favorites.includes('model:appointments'));
  assert.equal(statisticalReads,0);
  api.destroy();
}
integration().then(()=>console.log('All-Star workspace navigation: search, compatibility, no-scan status, persistence and keyboard tests passed.')).catch(error=>{console.error(error);process.exitCode=1;});
