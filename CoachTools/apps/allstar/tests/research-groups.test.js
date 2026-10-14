'use strict';
const assert=require('node:assert/strict');
const {createHarness,plain}=require('./modernization-compatibility.test.js');
function fixture(){
  const h=createHarness();
  h.run(`
    state.data.retail.headers.sv2=['Representative','Team','Apps'];
    state.data.retail.sv2=[
      {Representative:'Alice Able',Team:'Alpha',Apps:12},
      {Representative:'Bob Baker',Team:'Alpha',Apps:0},
      {Representative:'Cara Clark',Team:'Beta',Apps:99},
      {Representative:'Alex Smith',Team:'Gamma',Apps:1},
      {Representative:'Alec Smith',Team:'Delta',Apps:2}
    ].map(r=>({...r,_rep:r.Representative,_repKey:fullNameIdentityKey(r.Representative),_team:r.Team,_sourceKey:'retail_sv2'}));
    state.sourceMeta.retail_sv2={sourceVersion:1};
    markDataIndexDirty('research group fixture',{sources:['retail_sv2']});buildDataIndex('research group fixture');
    loadResearchGroups();initResearchGroups();
  `);
  return h;
}
async function run(){
  const names=fixture();
  try{
    assert.deepEqual(plain(names.run(String.raw`parseResearchGroupNames(' Alice Able, Bob Baker\nCara Clark\r\nAlice Able\tBob Baker; • Alex Smith')`)),['Alice Able','Bob Baker','Cara Clark','Alex Smith']);
    assert.deepEqual(plain(names.run(`normalizeResearchGroup({name:' Work group ',repNames:['Alice Able','alice able','Bob Baker']}).repNames`)),['Alice Able','Bob Baker']);
    names.run(`state.researchGroups=[normalizeResearchGroup({id:'work',name:'Work Group',repNames:['Alice Able']})];state.activeResearchGroupId='work';saveResearchGroups();`);
    assert.equal(names.run(`findResearchGroup('$Work Group').id`),'work');
    assert.equal(names.run(`researchGroupRepSet('work').has(normalizeIdentityName('Alice Able'))`),true);
    names.run(`importResearchGroups(JSON.stringify({version:1,researchGroups:[{id:'import',name:'Work Group',repNames:['Bob Baker']},{id:'other',name:'Other',repNames:['Cara Clark']}]}));`);
    assert.deepEqual(plain(names.run(`findResearchGroup('work').repNames`)),['Alice Able','Bob Baker']);
    assert.equal(names.run(`state.researchGroups.length`),2);
    const saved=names.storage.get('allStarResearchGroups.v1');
    assert.throws(()=>names.run(`importResearchGroups('{"researchGroups":[{"name":"Broken","repNames":42}]}')`),/Research Groups JSON/);
    assert.equal(names.storage.get('allStarResearchGroups.v1'),saved);
    names.run(`state.researchGroups=[];loadResearchGroups();`);
    assert.equal(names.run(`state.researchGroups.length`),2);
    assert.deepEqual(plain(names.run(`state.data.retail.sv2.map(r=>r._team)`)),['Alpha','Alpha','Beta','Gamma','Delta']);
    console.log('PASS research group parsing, canonical deduplication, JSON merge, persistence and preserved coaches');
  }finally{names.close();}
  const packages=fixture();
  try{
    packages.run(`state.researchGroups=[normalizeResearchGroup({id:'work',name:'Work Group',repNames:['Alice Able','Cara Clark'],createdAt:'2026-10-01T12:00:00.000Z'})];var groupPackage=JSON.parse(JSON.stringify(buildAllStarJsonPackage()));`);
    assert.deepEqual(plain(packages.run('groupPackage.researchGroups')),plain(packages.run('state.researchGroups')));
    packages.run(`state.researchGroups=[];var stagedGroupPackage=stageAllStarJsonPackage(groupPackage,'groups.json');`);
    assert.equal(packages.run('state.researchGroups.length'),0,'staging does not change existing state');
    packages.run('commitStagedJsonPackage(stagedGroupPackage)');
    assert.deepEqual(plain(packages.run('state.researchGroups')),plain(packages.run('groupPackage.researchGroups')));
    packages.run(`var legacyGroupPackage=JSON.parse(JSON.stringify(groupPackage));delete legacyGroupPackage.researchGroups;commitStagedJsonPackage(stageAllStarJsonPackage(legacyGroupPackage,'legacy.json'));`);
    assert.equal(packages.run(`state.researchGroups[0].id`),'work','legacy packages preserve the local research groups');
    const before=plain(packages.run('state.researchGroups'));
    packages.run(`var invalidGroupPackage={...groupPackage,researchGroups:{bad:true}};`);
    assert.throws(()=>packages.run(`stageAllStarJsonPackage(invalidGroupPackage,'invalid.json')`),/researchGroups/);
    assert.deepEqual(plain(packages.run('state.researchGroups')),before);
    packages.run(`invalidGroupPackage={...groupPackage,researchGroups:[{id:'broken',name:'Broken',repNames:42}]};`);
    assert.throws(()=>packages.run(`stageAllStarJsonPackage(invalidGroupPackage,'invalid.json')`),/researchGroups/);
    assert.deepEqual(plain(packages.run('state.researchGroups')),before);
    console.log('PASS normalized package research group IDs and memberships, staging isolation, legacy compatibility and invalid input rejection');
  }finally{packages.close();}
  const matching=fixture();
  try{
    const results=plain(await matching.run(`matchResearchGroupNames(['Alice Able','Bob Bakr','Ale Smith','Zzzzz Qqqqq'],buildResearchGroupRepIndex())`));
    assert.equal(results[0].status,'exact');assert.equal(results[0].approved,true);
    assert.equal(results[1].status,'suggested');assert.equal(results[1].matchName,'Bob Baker');assert.equal(results[1].approved,false);
    assert.equal(results[2].status,'ambiguous');assert.equal(results[2].approved,false);assert.ok(results[2].candidates.length>1);
    assert.equal(results[3].status,'unmatched');assert.equal(results[3].approved,false);
    assert.deepEqual(plain(matching.run('state.researchGroups')),[],'matching never changes membership');
    matching.run(`var matchCancelled=false;var matchProgress=[];var matchTimerRan=false;var matchingIndex=buildResearchGroupRepIndex();setTimeout(()=>{matchTimerRan=true;},0);`);
    await matching.run(`matchResearchGroupNames(Array.from({length:120},(_,i)=>'Unknown Person '+i),matchingIndex,{onProgress:(done,total)=>matchProgress.push([done,total])})`);
    assert.equal(matching.run('matchTimerRan'),true);assert.ok(matching.run('matchProgress.length')>3);
    assert.deepEqual(plain(matching.run('matchProgress.at(-1)')),[120,120]);
    await assert.rejects(matching.run(`matchResearchGroupNames(['Alice Able'],matchingIndex,{cancelled:()=>true})`),{name:'AbortError'});
    console.log('PASS exact-first matching, suggested and ambiguous names require approval, cooperative progress and cancellation');
  }finally{matching.close();}
  const ui=fixture();
  try{
    ui.run('openResearchGroupBuilder()');
    assert.equal(ui.run('document.querySelector("[data-research-group-rep]").disabled'),true,'representatives cannot be selected before creating a group');
    ui.run(`openResearchGroupBuilder();document.getElementById('createResearchGroupBtn').click();`);
    assert.equal(ui.run('state.researchGroups.length'),1);
    assert.equal(ui.run('document.getElementById("researchGroupBuilderModal").classList.contains("open")'),true);
    ui.run(String.raw`document.getElementById('researchGroupPasteInput').value='Alice Able, Bob Bakr\nAle Smith\nMissing Name';`);
    await ui.run('previewResearchGroupPaste()');
    assert.equal(ui.run('activeResearchGroup().repNames.length'),0,'review does not load pasted names');
    assert.equal(ui.run('document.querySelectorAll("[data-research-group-approve]")[1].checked'),false);
    ui.run(`applyResearchGroupMatches();`);
    assert.deepEqual(plain(ui.run('activeResearchGroup().repNames')),['Alice Able']);
    assert.match(ui.run('document.getElementById("researchGroupStatus").textContent'),/3 unapproved/);
    ui.run(`var approveBob=document.querySelector('[data-research-group-approve="1"]');approveBob.checked=true;approveBob.dispatchEvent(new Event('change',{bubbles:true}));applyResearchGroupMatches();`);
    assert.deepEqual(plain(ui.run('activeResearchGroup().repNames')),['Alice Able','Bob Baker']);
    ui.run(`var matchMissing=document.querySelector('[data-research-group-match="3"]');matchMissing.value='Unknown Fake';matchMissing.dispatchEvent(new Event('change',{bubbles:true}));var approveMissing=document.querySelector('[data-research-group-approve="3"]');approveMissing.checked=true;approveMissing.dispatchEvent(new Event('change',{bubbles:true}));`);
    assert.equal(ui.run('researchGroupsUi.review[3].approved'),false,'cannot approve a fabricated representative');
    ui.run(`var matchFixed=document.querySelector('[data-research-group-match="3"]');matchFixed.value='Cara Clark';matchFixed.dispatchEvent(new Event('change',{bubbles:true}));var approveFixed=document.querySelector('[data-research-group-approve="3"]');approveFixed.checked=true;approveFixed.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-research-group-skip="2"]').click();applyResearchGroupMatches();`);
    assert.deepEqual(plain(ui.run('activeResearchGroup().repNames')),['Alice Able','Bob Baker','Cara Clark']);
    assert.equal(ui.run('researchGroupsUi.review[2].skipped'),true);
    ui.run(`researchGroupsUi.review=Array.from({length:123},(_,i)=>({input:'Person '+i,status:'unmatched',matchName:'',approved:false,skipped:false,candidates:[]}));renderResearchGroupReview();`);
    assert.equal(ui.run('document.querySelectorAll("#researchGroupReviewRows tr").length'),50);
    ui.run(`document.querySelector('#researchGroupReviewPager [data-group-page="1"]').click();`);
    assert.equal(ui.run('researchGroupsUi.reviewPage'),1);
    assert.equal(ui.run('document.querySelectorAll("#researchGroupReviewRows tr").length'),50);
    ui.run(`document.querySelector('#researchGroupReviewPager [data-group-page="1"]').click();`);
    assert.equal(ui.run('document.querySelectorAll("#researchGroupReviewRows tr").length'),23);
    ui.run(`document.getElementById('researchGroupRepSearchInput').value='Beta';document.getElementById('researchGroupRepSearchInput').dispatchEvent(new Event('input',{bubbles:true}));`);
    assert.equal(ui.run('document.querySelectorAll("[data-research-group-rep]").length'),1);
    assert.match(ui.run('document.getElementById("researchGroupRepList").textContent'),/Cara Clark/);
    assert.deepEqual(plain(ui.run(`state.data.retail.sv2.map(r=>r._team)`)),['Alpha','Alpha','Beta','Gamma','Delta']);
    console.log('PASS reviewed paste UI, editing, explicit fuzzy approval, skip, bounded paging, coach search and preserved team assignment');
  }finally{ui.close();}
  const safeguards=fixture();
  try{
    safeguards.run(`openResearchGroupBuilder();createResearchGroup();var originalGroupId=state.activeResearchGroupId;state.researchGroups.push(normalizeResearchGroup({id:'second',name:'Second'}));document.getElementById('researchGroupPasteInput').value='Alice Able';`);
    const pending=safeguards.run('previewResearchGroupPaste()');
    assert.equal(safeguards.run('researchGroupsUi.running'),true);
    safeguards.run(`state.activeResearchGroupId='second';renderResearchGroupBuilder();`);
    await pending;
    assert.equal(safeguards.run('researchGroupsUi.running'),false);
    assert.equal(safeguards.run('researchGroupsUi.review.length'),0);
    assert.equal(safeguards.run('activeResearchGroup().repNames.length'),0,'switching groups cancels an in-flight match');
    safeguards.run(`var previousSave=localStorage.setItem;localStorage.setItem=(key,value)=>{if(key===RESEARCH_GROUPS_STORAGE_KEY)throw new Error('Quota exceeded');previousSave(key,value);};var beforeInvalidations=state.perfCounters.selectiveInvalidations;activeResearchGroup().repNames=['Cara Clark'];researchGroupSaveAndRender();`);
    assert.ok(safeguards.run('state.perfCounters.selectiveInvalidations>beforeInvalidations'),'unsaved in-memory group changes still invalidate research caches');
    assert.match(safeguards.run('document.getElementById("researchGroupStatus").textContent'),/could not be saved/);
    assert.deepEqual(plain(safeguards.run('activeResearchGroup().repNames')),['Cara Clark'],'membership stays available for export after storage failure');
    safeguards.run(`researchGroupMatchSuggestions('Car');`);
    assert.match(safeguards.run('document.getElementById("researchGroupRepSuggestions").innerHTML'),/Cara Clark/);
    console.log('PASS group-switch cancellation, no-group controls, storage-failure warning and invalidation, and searchable match repair');
  }finally{safeguards.close();}
  const weekly=fixture();
  try{
    weekly.run(`state.data.weeklyRetail={headers:['Date','Name','Sheet','Consumer Opportunities'],rows:[{Date:'2026-10-01',Name:'Wendy Weekly',Sheet:'Coach Weekly','Consumer Opportunities':2}],config:window.AllStarDatedStats.defaultConfig('weeklyRetail',['Date','Name','Sheet','Consumer Opportunities'])};markDataIndexDirty('unindexed weekly',{sources:['weeklyRetail']});var explicitGroupIndex=buildResearchGroupRepIndex();`);
    assert.equal(weekly.run(`explicitGroupIndex.byKey.get(researchGroupRepKey('Wendy Weekly')).name`),'Wendy Weekly');
    assert.deepEqual(plain(weekly.run(`explicitGroupIndex.byKey.get(researchGroupRepKey('Wendy Weekly')).coaches`)),['Coach Weekly']);
    console.log('PASS explicitly opened Research Groups includes unindexed weekly representative names and coaches');
  }finally{weekly.close();}
}
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={run};
