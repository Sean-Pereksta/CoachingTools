'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {parseHTML}=require('linkedom'),base=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(base,file),'utf8');
function workspace(){
 const {window,document}=parseHTML(read('index.html')),events=new Map(),values=new Map();
 const select=document.getElementById('globalScopeSelect');
 select.innerHTML='<option value="all:">All people</option><option value="coach:alpha">Coach: Coach Alpha</option><option value="coach:beta">Coach: Coach Beta</option>';
 let selection='all:',scope={mode:'all',label:'All people'};
 Object.defineProperty(select,'options',{get:()=>[...select.querySelectorAll('option')]});
 Object.defineProperty(select,'value',{get:()=>selection,set:value=>{selection=value;}});
 const apps=[{id:'alpha-tool',name:'Alpha Tool',icon:'icons/horizon/allstar.png',favorite:true},{id:'beta-tool',name:'Beta Tool',icon:'icons/horizon/qa-scores.png',favorite:false}];
 const scopeType=document.getElementById('scopeType');let typeValue='coach';Object.defineProperty(scopeType,'value',{get:()=>typeValue,set:value=>{typeValue=value;}});
 const root={Event:window.Event,COACHTOOLS_MANIFEST:{apps},CoachToolsStorage:{getScope:()=>scope},setTimeout,addEventListener(type,fn){if(!events.has(type))events.set(type,[]);events.get(type).push(fn);},dispatchEvent(event){for(const fn of events.get(event.type)||[])fn(event);}};
 const context={window:root,document,Event:window.Event,CustomEvent:window.CustomEvent,MutationObserver:class{observe(){}},localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)}};
 select.addEventListener('change',()=>{scope=selection==='all:'?{mode:'all',label:'All people'}:{mode:'coach',label:selection==='coach:alpha'?'Coach Alpha':'Coach Beta'};});
 vm.runInNewContext(read('shared/coachtools-horizon.js'),context);
 return {window,document,select,values,getScope:()=>scope};
}
test('compact coach search applies the selected scope and can return to all people',()=>{
 const {document,window,getScope}=workspace();
 document.getElementById('changeScope').click();
 const search=document.getElementById('scopeSearch');search.value='Alpha';search.dispatchEvent(new window.Event('input'));
 const results=document.querySelectorAll('.scope-result');assert.equal(results.length,1);assert.match(results[0].textContent,/Coach Alpha/);results[0].click();
 assert.equal(getScope().label,'Coach Alpha');assert.equal(document.getElementById('activeScopeName').textContent,'Coach Alpha');
 document.getElementById('scopeAllPeople').click();assert.equal(getScope().mode,'all');
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
