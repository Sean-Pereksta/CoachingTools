'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {parseHTML}=require('linkedom'),base=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(base,file),'utf8');
function workspace(initialScope={mode:'all',label:'All people'}){
 const {window,document}=parseHTML(read('index.html')),events=new Map(),values=new Map();
 const select=document.getElementById('globalScopeSelect');
 select.innerHTML='<option value="all:">All people</option><option value="coach:alpha">Coach: Coach Alpha</option><option value="coach:beta">Coach: Coach Beta</option><option value="coach:gamma">Coach: Coach Gamma</option><option value="team:shared">Team: Shared Team</option><option value="representative:river">Representative: River Example</option>';
 let selection='all:',scope=initialScope;
 Object.defineProperty(select,'options',{get:()=>[...select.querySelectorAll('option')]});
 Object.defineProperty(select,'value',{get:()=>selection,set:value=>{selection=value;}});
 const apps=[{id:'alpha-tool',name:'Alpha Tool',icon:'icons/horizon/allstar.png',favorite:true},{id:'beta-tool',name:'Beta Tool',icon:'icons/horizon/qa-scores.png',favorite:false}];
 const scopeType=document.getElementById('scopeType');let typeValue='coach';Object.defineProperty(scopeType,'value',{get:()=>typeValue,set:value=>{typeValue=value;}});
 const root={Event:window.Event,COACHTOOLS_MANIFEST:{apps},CoachToolsStorage:{getScope:()=>scope,setScope(next){scope=next;root.dispatchEvent(new window.CustomEvent('coachtools:scope-updated'));}},setTimeout,addEventListener(type,fn){if(!events.has(type))events.set(type,[]);events.get(type).push(fn);},dispatchEvent(event){for(const fn of events.get(event.type)||[])fn(event);}};
 const context={window:root,document,Event:window.Event,CustomEvent:window.CustomEvent,MutationObserver:class{observe(){}},localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)}};
 select.addEventListener('change',()=>{
   const [mode,personId]=selection.split(':');
   const label=select.options.find(option=>option.value===selection).textContent.replace(/^[^:]+:\s*/,'');
   root.CoachToolsStorage.setScope(mode==='all'?{mode:'all',label:'All people'}:{mode,personId,label,team:'Shared Team',coaches:mode==='coach'?[label]:[]});
 });
 vm.runInNewContext(read('shared/coachtools-horizon.js'),context);
 const check=(value,checked=true)=>{const input=[...document.querySelectorAll('.scope-coach-checkbox')].find(input=>input.value===value);assert.ok(input,'Coach checkbox is available: '+value);input.checked=checked;input.dispatchEvent(new window.Event('change'));};
 return {window,document,select,values,check,getScope:()=>scope};
}
test('bulk coach selection includes hidden search results and stays pending until applied',()=>{
 const {document,window,getScope}=workspace();
 document.getElementById('changeScope').click();
 const search=document.getElementById('scopeSearch');search.value='Alpha';search.dispatchEvent(new window.Event('input'));
 document.getElementById('scopeSelectAllCoaches').click();
 assert.equal(document.getElementById('scopeSelectionCount').textContent,'3 coaches selected');
 assert.equal(document.querySelector('.scope-coach-checkbox').checked,true);
 assert.equal(getScope().mode,'all');
 document.getElementById('scopeUnselectAllCoaches').click();
 assert.equal(document.getElementById('scopeSelectionCount').textContent,'No coaches selected');
 assert.equal(document.getElementById('applyCoachScope').disabled,true);
 search.value='';search.dispatchEvent(new window.Event('input'));
 assert.equal([...document.querySelectorAll('.scope-coach-checkbox')].filter(input=>input.checked).length,0);
 document.getElementById('scopeSelectAllCoaches').click();document.getElementById('applyCoachScope').click();
 assert.deepEqual([...getScope().coaches],['Coach Alpha','Coach Beta','Coach Gamma']);
});
test('compact coach search applies the selected scope and can return to all people',()=>{
 const {document,window,getScope,check}=workspace();
 document.getElementById('changeScope').click();
 const search=document.getElementById('scopeSearch');search.value='Alpha';search.dispatchEvent(new window.Event('input'));
 const results=document.querySelectorAll('.scope-result');assert.equal(results.length,1);assert.match(results[0].textContent,/Coach Alpha/);check('coach:alpha');
 assert.equal(getScope().mode,'all','Checkboxes do not change the active scope until Apply.');
 assert.ok(document.getElementById('scopePicker').hasAttribute('open'));
 document.getElementById('applyCoachScope').click();
 assert.equal(getScope().label,'Coach Alpha');assert.equal(document.getElementById('activeScopeName').textContent,'Coach Alpha');
 assert.equal(getScope().personId,'alpha');assert.equal(getScope().team,'Shared Team','A single selection uses the existing desktop selector.');
 assert.equal(document.getElementById('scopePicker').hasAttribute('open'),false);
 document.getElementById('scopeAllPeople').click();assert.equal(getScope().mode,'all');
});
test('coach selections survive searches and type filters, apply together, and restore when reopened',()=>{
 const {document,window,getScope,check}=workspace();
 document.getElementById('changeScope').click();
 assert.equal(document.getElementById('applyCoachScope').disabled,true);
 check('coach:alpha');
 const search=document.getElementById('scopeSearch');search.value='Beta';search.dispatchEvent(new window.Event('input'));check('coach:beta');
 assert.equal(document.getElementById('scopeSelectionCount').textContent,'2 coaches selected');
 const type=document.getElementById('scopeType');type.value='representative';type.dispatchEvent(new window.Event('change'));
 type.value='coach';type.dispatchEvent(new window.Event('change'));
 assert.equal(document.querySelector('.scope-coach-checkbox').checked,true,'Hidden coach selection is retained while filtering.');
 document.getElementById('applyCoachScope').click();
 const scope=JSON.parse(JSON.stringify(getScope()));
 assert.deepEqual(scope,{mode:'team',label:'2 selected coaches',coaches:['Coach Alpha','Coach Beta'],coachPersonIds:['alpha','beta'],personId:'',team:'',department:'',coordinator:'',representatives:[]});
 assert.equal(document.getElementById('activeScopeName').textContent,'2 selected coaches');
 assert.match(document.getElementById('activeScopeDetail').textContent,/Selected coaches view/);
 document.getElementById('changeScope').click();
 assert.deepEqual([...document.querySelectorAll('.scope-coach-checkbox')].filter(input=>input.checked).map(input=>input.value),['coach:alpha','coach:beta']);
 assert.equal(type.value,'coach');
 check('coach:alpha',false);document.getElementById('applyCoachScope').click();
 assert.equal(getScope().mode,'coach');assert.equal(getScope().personId,'beta');
 document.getElementById('clearScope').click();assert.equal(getScope().mode,'all');
});
test('closing discards pending changes and an empty selection cannot widen the active view',()=>{
 const initial={mode:'coach',personId:'alpha',label:'Coach Alpha',coaches:['Coach Alpha']};
 const {document,getScope,check}=workspace(initial);
 document.getElementById('changeScope').click();check('coach:beta');document.getElementById('closeScopePicker').click();
 assert.equal(getScope(),initial);
 document.getElementById('changeScope').click();
 assert.equal([...document.querySelectorAll('.scope-coach-checkbox')].find(input=>input.value==='coach:beta').checked,false);
 check('coach:alpha',false);assert.equal(document.getElementById('applyCoachScope').disabled,true);
 document.getElementById('applyCoachScope').click();assert.equal(getScope(),initial);
});
test('saved multiple coaches remain intact while the directory loads and restore when it arrives',()=>{
 const initial={mode:'team',label:'2 selected coaches',coaches:['Coach Alpha','Coach Beta'],coachPersonIds:['alpha','beta']};
 const {document,window,select,getScope}=workspace(initial);
 const coaches=[...select.options].filter(option=>option.value.startsWith('coach:'));coaches.forEach(option=>option.remove());
 document.getElementById('changeScope').click();
 assert.equal(document.querySelectorAll('.scope-coach-checkbox').length,0);
 assert.equal(document.getElementById('applyCoachScope').disabled,true);
 document.getElementById('applyCoachScope').click();assert.equal(getScope(),initial,'An incomplete directory cannot drop saved coach identities.');
 coaches.forEach(option=>select.append(option));
 document.getElementById('scopeSearch').dispatchEvent(new window.Event('input'));
 assert.equal(document.querySelectorAll('.scope-coach-checkbox').length,3,'Directory arrival does not duplicate saved coaches.');
 assert.equal(document.getElementById('scopeSelectionCount').textContent,'2 coaches selected');
 document.getElementById('applyCoachScope').click();
 assert.deepEqual(Array.from(getScope().coachPersonIds),['alpha','beta']);
});
test('renamed coaches restore by identity once and use their current names after directory updates',()=>{
 const initial={mode:'team',label:'2 selected coaches',coaches:['Coach Alpha Old','Coach Beta'],coachPersonIds:['alpha','beta']};
 const {document,window,select,getScope,check}=workspace(initial);
 document.getElementById('changeScope').click();
 assert.equal(document.getElementById('scopeSelectionCount').textContent,'2 coaches selected');
 check('coach:gamma');
 select.options.find(option=>option.value==='coach:alpha').textContent='Coach: Coach Alpha New';
 document.getElementById('scopeSearch').dispatchEvent(new window.Event('input'));
 assert.equal(document.querySelectorAll('.scope-coach-checkbox').length,3);
 document.getElementById('applyCoachScope').click();
 assert.deepEqual(Array.from(getScope().coaches),['Coach Alpha New','Coach Beta','Coach Gamma']);
 assert.deepEqual(Array.from(getScope().coachPersonIds),['alpha','beta','gamma']);
});
test('legacy saved coach entries do not duplicate directory coaches or invent identity IDs',()=>{
 const {document,select,getScope,check}=workspace({mode:'coach',label:'Coach Alpha',coaches:['Coach Alpha']});
 const saved=document.createElement('option');saved.value='coach:Coach%20Alpha';saved.textContent='Saved coach: Coach Alpha';select.append(saved);
 document.getElementById('changeScope').click();
 assert.equal(document.getElementById('scopeSelectionCount').textContent,'1 coach selected');
 assert.equal(document.querySelectorAll('.scope-coach-checkbox').length,3);
 check('coach:beta');document.getElementById('applyCoachScope').click();
 assert.deepEqual(Array.from(getScope().coachPersonIds),['alpha','beta']);
 const unknown=workspace({mode:'coach',label:'Coach Unknown',coaches:['Coach Unknown']});
 const fallback=unknown.document.createElement('option');fallback.value='coach:Coach%20Unknown';fallback.textContent='Saved coach: Coach Unknown';unknown.select.append(fallback);
 unknown.document.getElementById('changeScope').click();unknown.check('coach:alpha');unknown.document.getElementById('applyCoachScope').click();
 assert.deepEqual(Array.from(unknown.getScope().coachPersonIds),['alpha']);
 assert.deepEqual(Array.from(unknown.getScope().coaches),['Coach Unknown','Coach Alpha']);
});
test('team and representative choices still apply immediately',()=>{
 const {document,window,getScope}=workspace();
 for(const [type,label] of [['team','Shared Team'],['representative','River Example']]){
   document.getElementById('changeScope').click();const select=document.getElementById('scopeType');select.value=type;select.dispatchEvent(new window.Event('change'));
   document.querySelector('.scope-result').click();assert.equal(getScope().mode,type);assert.equal(getScope().label,label);
   assert.equal(document.getElementById('scopePicker').hasAttribute('open'),false);
 }
});
test('desktop selector distinguishes combined coach sets and keeps named team values',()=>{
 const source=read('shared/coachtools-desktop.js'),start=source.indexOf('  function scopeValue('),end=source.indexOf('\n  async function ',start);
 const context=vm.createContext({});vm.runInContext(source.slice(start,end),context);
 const first={mode:'team',label:'2 selected coaches',coaches:['Alpha','Beta'],coachPersonIds:['a','b']};
 const second={...first,coaches:['Alpha','Gamma'],coachPersonIds:['a','c']};
 assert.notEqual(context.scopeValue(first),context.scopeValue(second));
 assert.equal(context.scopeValue(first),context.scopeValue({...first,coaches:['Beta','Alpha'],coachPersonIds:['b','a']}));
 assert.equal(context.scopeValue({mode:'team',team:'Shared Team',coaches:['Alpha','Beta']}),'team:Shared%20Team');
});
test('favorites editing persists shortcuts beside the scope panel',()=>{
 const {document,values}=workspace();assert.match(document.getElementById('favoriteTools').textContent,/Alpha Tool/);
 document.getElementById('editFavorites').click();
 const boxes=[...document.querySelectorAll('#favoritesChoices input')];boxes[0].removeAttribute('checked');boxes[0].checked=false;boxes[1].checked=true;boxes[1].setAttribute('checked','');
 document.getElementById('saveFavorites').click();
 assert.deepEqual(JSON.parse(values.get('coachtools.desktop.favorites.v1')),['beta-tool']);assert.equal(document.getElementById('favoriteTools').textContent,'Beta Tool');
});
test('single-click opening a remembered deferred app creates its frame before promotion',()=>{
 const source=read('shared/coachtools-desktop.js');
 const extract=name=>{const start=source.indexOf('  function '+name+'('),end=source.indexOf('\n  function ',start+1);return source.slice(start,end);};
 const app={id:'sample',name:'Sample Tool',file:'apps/sample.html'},openWindows=new Map([['sample',{app,deferred:true,closeRequested:false}]]),state={},elements={desktop:{hidden:false},workspace:{hidden:true},workspaceTitle:{},workspaceNotice:{}};
 let created=0;
 const context={openWindows,state,elements,createWindow(app){created++;const item={app,pane:{dataset:{}},iframe:{contentWindow:{postMessage(){}}}};openWindows.set(app.id,item);return item;},requirementNotice:()=>'',pushRecent(){},closeMenus(){},renderTaskbar(){},persistOpenWindows(){},deliverPendingStageFiles(){}};
 vm.createContext(context);vm.runInContext(extract('promoteWindowState')+extract('activateWindow')+extract('openApp'),context);
 context.openApp(app);assert.equal(created,1);assert.equal(elements.workspace.hidden,false);assert.equal(state.activeAppId,'sample');assert.equal(openWindows.get('sample').pane.dataset.lifecycle,'opened');
 context.openApp(app);assert.equal(created,1,'The second click restores the same app frame.');
});
