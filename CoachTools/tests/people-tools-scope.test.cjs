'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {parseHTML}=require('linkedom');
const root=path.resolve(__dirname,'..');
const roster=[
  {personId:'coach-a',displayName:'Coach Alpha',role:'coach'},
  {personId:'rep-a',displayName:'Rep Alpha',role:'representative',currentCoachId:'coach-a'},
  {personId:'coach-b',displayName:'Coach Beta',role:'coach'},
  {personId:'rep-b',displayName:'Rep Beta',role:'representative',currentCoachId:'coach-b'}
];
let chosen='a',scopeMode='coach',historyReads=0;
const identity={ready:async()=>{},getAllPeople:async()=>roster,getCoaches:async()=>roster.filter(p=>p.role==='coach'),getIdentityVersion:()=>1,normalizeName:v=>String(v||'').toLowerCase().trim(),queueDatasetIngestion:()=>{}};
const app={ready:async()=>{},getScope:()=>({mode:scopeMode,personId:scopeMode==='representative'?`rep-${chosen}`:undefined,coaches:[chosen==='a'?'Coach Alpha':'Coach Beta']}),getScopeKey:()=>`${scopeMode}-${chosen}`,filterPeople:async people=>people.filter(p=>scopeMode==='representative'?p.personId===`rep-${chosen}`:p.personId===`coach-${chosen}`||p.currentCoachId===`coach-${chosen}`),getMany:async()=>({}),getHistory:async type=>{historyReads++;return[{id:type,detectedPeriod:{end:'2026-10-31'},data:{}}]},subscribe:()=>{},subscribeScope:()=>{},getVersion:()=>({version:1,fingerprint:'same-source'})};
const alignment={snapshotFingerprint:()=> 'same-source',currentVersionFingerprint:()=>({key:'same-source'}),eligibleCoachCohort:({people})=>({rows:people.filter(p=>p.role==='coach').map(coach=>({coach}))})};

function page(file,kind){
  const html=fs.readFileSync(path.join(root,file),'utf8');
  const {window,document}=parseHTML(html);
  const select=document.getElementById('scopeSelect');
  if(select){
    Object.defineProperty(select,'options',{get:()=>select.querySelectorAll('option')});
    let selected='';Object.defineProperty(select,'value',{get:()=>selected,set:value=>{selected=value;}});
  }
  window.localStorage={getItem:()=>null,setItem:()=>{}};
  Object.assign(window,{CoachToolsIdentity:identity,CoachToolsAppData:app,CoachToolsCoachingAlignment:alignment,CoachToolsIntelligence:{},CoachToolsProfiles:{},CoachToolsProfileFast:{prepareWeeklyAsync:async(people,records)=>({people,records})}});
  const context={window,document,console,CoachToolsIdentity:identity,CoachToolsAppData:app,CoachToolsCoachingAlignment:alignment,CoachToolsProfileFast:window.CoachToolsProfileFast,CoachToolsData:{getHistory(){throw new Error('Raw history bypass');}},performance:{now:()=>0},requestAnimationFrame:fn=>fn(),setTimeout,clearTimeout,DOMException};
  let script=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).find(s=>s.includes(kind==='people'?'const DATA_TYPES=':'const SCOPE_KEY'));
  if(kind==='people'){
    script=script.replace(/state\.initializingPromise=initialize\(\);[\s\S]*?\n\}\)\(\);/, 'window.testApi={state,performRefresh,handleProfileScopeChange,captureSnapshot};\n})();');
  }else script=script.replace(/\n  boot\(\);/, '\n  window.testApi={state,readCoachSnapshot,handleCommandScopeChange,runFingerprint,scopeFromValue,inSelectedScope};');
  vm.runInNewContext(script,context,{filename:file});
  assert.ok(window.testApi,'Test entry exposes actual app functions without startup.');
  return{api:window.testApi,document};
}

(async()=>{
  const profiles=page('apps/people-profiles.html','people');
  await profiles.api.performRefresh({force:true});
  assert.deepEqual(Array.from(profiles.api.state.people,p=>p.personId),['coach-a','rep-a']);
  const firstSnapshot=profiles.api.state.snapshot.id;
  profiles.api.state.selectedId='rep-a';profiles.api.state.profile={person:roster[1]};profiles.api.state.profileComplete=true;
  profiles.api.state.historySourceIndexes.set('old-a',{people:roster});
  chosen='b';
  await profiles.api.handleProfileScopeChange(app.getScope());
  assert.deepEqual(Array.from(profiles.api.state.people,p=>p.personId),['coach-b','rep-b']);
  assert.equal(profiles.api.state.selectedId,'');
  assert.equal(profiles.api.state.profile,null);
  assert.equal(profiles.api.state.historySourceIndexes.size,0);
  assert.notEqual(profiles.api.state.snapshot.id,firstSnapshot,'Identical source versions cannot share snapshots across scopes.');
  assert.doesNotMatch(profiles.document.getElementById('peopleList').textContent,/Alpha/);

  chosen='a';
  const command=page('apps/coaching-command-center.html','command');
  await command.api.readCoachSnapshot();
  assert.deepEqual(Array.from(command.api.state.people,p=>p.personId),['coach-a','rep-a']);
  assert.deepEqual(Array.from(command.api.state.coaches,p=>p.personId),['coach-a']);
  const keyA=command.api.runFingerprint({value:'org:shared'});
  command.api.state.context={people:roster};command.api.state.runCache.set('old-a',{});
  command.document.getElementById('content').innerHTML='Rep Alpha';
  chosen='b';
  await command.api.handleCommandScopeChange();
  assert.deepEqual(Array.from(command.api.state.people,p=>p.personId),['coach-b','rep-b']);
  assert.deepEqual(Array.from(command.api.state.coaches,p=>p.personId),['coach-b']);
  assert.equal(command.api.state.runCache.size,0);
  assert.equal(command.api.state.context,null);
  assert.equal(command.document.getElementById('content').textContent,'');
  assert.doesNotMatch(command.document.getElementById('scopeSelect').textContent,/Alpha/);
  assert.notEqual(command.api.runFingerprint({value:'org:shared'}),keyA);

  scopeMode='representative';chosen='a';
  await command.api.handleCommandScopeChange();
  assert.deepEqual(Array.from(command.api.state.people,p=>p.personId),['rep-a']);
  assert.equal(command.document.getElementById('scopeSelect').value,'global:current','A representative-only scope remains runnable.');
  command.api.state.scope=command.api.scopeFromValue('global:current');
  assert.equal(command.api.inSelectedScope(roster[1]),true);
  assert.equal(command.api.inSelectedScope(roster[3]),false);
  scopeMode='coach';chosen='b';

  const context={console,CoachToolsIdentity:identity,CoachToolsAppData:app,CoachToolsData:{getHistory(){throw new Error('Raw history bypass');}},CoachToolsStorage:{getScope:app.getScope},setTimeout,clearTimeout,Date,Math,JSON};
  context.globalThis=context;vm.createContext(context);
  for(const file of ['shared/coachtools-profile-data.js','shared/coachtools-intelligence.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
  await assert.rejects(()=>context.CoachToolsProfiles.loadProfile('rep-a'),/not found/i,'Out-of-scope identities cannot be loaded through the shared profile entry.');
  const intelligence=await context.CoachToolsIntelligence.loadContext({types:['weeklyRetail'],history:true});
  assert.deepEqual(Array.from(intelligence.people,p=>p.personId),['coach-b','rep-b']);
  assert.ok(historyReads>=10,'Profiles and shared intelligence use scoped AppData history reads.');
  let release;
  const normalGetMany=app.getMany;
  app.getMany=()=>new Promise(resolve=>{release=resolve;});
  chosen='a';
  const pending=context.CoachToolsIntelligence.loadContext({types:['weeklyRetail']});
  await new Promise(setImmediate);
  assert.equal(typeof release,'function');
  chosen='b';release({});
  await assert.rejects(pending,error=>error.name==='AbortError','An in-flight old-scope context cannot return after the global scope changes.');
  app.getMany=normalGetMany;
  console.log('People tools global scope isolation tests passed (Coach Alpha → Coach Beta).');
})().catch(error=>{console.error(error);process.exitCode=1;});
