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
app.researchGroups=[{id:'followup',name:'Follow-up work group',repNames:['Catherine Mock']}];
const catalog=navigation.buildCatalog(app,sources,[{id:'report1',modelName:'August report'}],[{id:'chart1',title:'Cash trend'}]);
assert.equal(statisticalReads,0,'Search uses metadata and roster indexes, never statistical rows');
assert.equal(navigation.searchCatalog(catalog,'run appointment rate')[0].id,'run:appointments');
assert.equal(navigation.searchCatalog(catalog,'consumer opportunities')[0].id,'column:retail_sv2:Consumer Opportunities');
assert.equal(navigation.searchCatalog(catalog,'find catherine mock').length,2,'Same-name representatives on different teams stay separate');
assert.equal(navigation.searchCatalog(catalog,'open research')[0].id,'action:research');
assert.equal(navigation.searchCatalog(catalog,'open research groups')[0].id,'action:research-groups');
assert.equal(navigation.searchCatalog(catalog,'follow-up work group')[0].id,'research-group:followup');
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
    openResearchGroupBuilder:()=>calls.push(['research-groups']),renderResearchGroupBuilder:()=>calls.push(['render-research-group',app.activeResearchGroupId]),
    openTeamsImported:()=>calls.push(['teams']),loadTeamDetails:team=>calls.push(['team',team]),
    openSavedReport:id=>calls.push(['report',id]),
    listSavedReports:async()=>[{id:'report1',modelName:'August report',report:{huge:'Excluded from navigation metadata'}}]
  }});
  const originalRoster=app.data.retail.controlRoster;
  Object.defineProperty(app.data.retail,'controlRoster',{configurable:true,get(){throw new Error('Opening Data or Settings must not build the representative search index');}});
  api.init();api.init();
  await api.execute('action:data');await api.execute('action:settings');
  assert.ok(document.getElementById('settingsClearAllDataBtn'),'Settings offers Clear All Data directly');
  Object.defineProperty(app.data.retail,'controlRoster',{configurable:true,writable:true,value:originalRoster});
  await api.execute('action:home');
  assert.equal(document.querySelectorAll('#asWorkspaceHeader').length,1,'Repeated initialization is harmless');
  assert.equal(document.getElementById('categoriesDrop'),legacy,'Original controls are moved, never recreated');
  legacy.dispatchEvent(new window.Event('change'));
  assert.ok(calls.some(x=>x[0]==='legacy'),'Existing handlers survive the navigation upgrade');
  assert.ok(document.getElementById('asLegacyTools').contains(legacy),'All legacy entries remain reachable');
  assert.equal(document.querySelectorAll('[data-as-section]').length,10);
  assert.equal(document.getElementById('workArea').hidden,true);
  await api.execute('research-group:followup');
  assert.ok(calls.some(x=>x[0]==='research-groups'));
  assert.ok(calls.some(x=>x[0]==='render-research-group'&&x[1]==='followup'));

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
async function savedPeopleColdStart(){
  const values=new Map([['allStarWorkspaceNavigation.v1',JSON.stringify({favorites:['rep:catherine mock:coach a','team:Coach A'],recent:[{id:'rep:catherine mock:coach a',at:1}]})]]), storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
  const state={teams:['Coach A'],data:{retail:{}}}, calls=[];
  Object.defineProperty(state.data.retail,'controlRoster',{get(){throw new Error('Home, History, and cached favorites must not enumerate the roster');}});
  function controller(){
    const {window,document}=parseHTML('<html><body><div id="workArea"></div><input id="teamRepSearch"></body></html>');
    Object.assign(window,{console,setTimeout,clearTimeout});vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/workspace-navigation.js'),'utf8'),vm.createContext({window,document,console,setTimeout,clearTimeout}));
    const api=window.AllStarWorkspaceNavigation.createController({document,storage,getState:()=>state,getSources:()=>[],actions:{openTeamsImported:()=>calls.push('open'),loadTeamDetails:team=>calls.push(team)}});api.init();return {api,document};
  }
  const legacy=controller();
  assert.ok(legacy.document.getElementById('asWorkspacePanel').textContent.includes('catherine mock'),'Legacy saved representative ids remain visible before Search');
  assert.ok(legacy.document.querySelector('[data-as-command="team:Coach A"]'),'Legacy team favorites remain visible');
  // Opening an entity from Search caches only that selected display record.
  legacy.api.record({id:'rep:catherine mock:coach a',action:'representative',entityId:'catherine mock',name:'Catherine Mock',team:'Coach A',label:'Catherine Mock',category:'Representatives',description:'Coach A'});
  legacy.api.destroy();
  const cold=controller();
  assert.ok(cold.document.getElementById('asWorkspacePanel').textContent.includes('Catherine Mock'),'Cold saved people retain their original display names');
  await cold.api.execute('action:history');assert.ok(cold.document.getElementById('asWorkspacePanel').textContent.includes('Catherine Mock'));
  await cold.api.execute('rep:catherine mock:coach a');assert.ok(calls.includes('Coach A'));assert.equal(cold.document.getElementById('teamRepSearch').value,'Catherine Mock');
  cold.api.invalidateReportingData();assert.ok(cold.api.getPreferences().people.some(x=>x.name==='Catherine Mock'),'Ordinary derived invalidation retains saved entity metadata');
  state.teams=['Corrected Coach'];cold.api.renameCoach('Coach A','Corrected Coach');
  assert.deepEqual(Array.from(cold.api.getPreferences().favorites),['rep:catherine mock:corrected coach','team:Corrected Coach']);
  assert.equal(cold.api.getPreferences().people.find(x=>x.action==='representative').name,'Catherine Mock','Coach rename never rewrites a representative name');
  await cold.api.execute('rep:catherine mock:corrected coach');assert.ok(calls.includes('Corrected Coach'));
  state.teams=[];cold.api.invalidateReportingData({clearPeople:true});await cold.api.execute('action:home');
  assert.ok(!cold.document.querySelector('[data-as-command="rep:catherine mock:corrected coach"]'),'Clearing reporting data hides stale entity shortcuts without deleting favorite preferences');
  assert.ok(cold.api.getPreferences().favorites.includes('rep:catherine mock:corrected coach'));
  cold.api.destroy();
}
integration().then(savedPeopleColdStart).then(()=>console.log('All-Star workspace navigation: search, compatibility, no-scan status, persistence and keyboard tests passed.')).catch(error=>{console.error(error);process.exitCode=1;});
