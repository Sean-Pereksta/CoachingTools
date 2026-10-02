'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {parseHTML}=require('linkedom');
const {createHarness,plain}=require('../apps/allstar/tests/modernization-compatibility.test.js');
const root=path.resolve(__dirname,'..'),KEY='allStarOrgBuilder.v1';
const org=(id,name,coachNames)=>({id,name,coachNames,createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'});
const existing=[org('keep','Keep this org',['Other Coach']),org('replace','Existing name',['Old Coach'])];
const incoming=[org('replace','Updated group',['Smith, JOHN','John Smith','O’BRIEN, JANE [Retail]']),org('new',' keep   this org ',['Brown, Casey, Jr.']),org('sts','STS team',['Alice Coach','Charlie Coach'])];

function harness(){
  const {document,window:dom}=parseHTML('<html><body><input id="quickDataInput"><section id="importProgress"><div class="import-card"><h2 id="importTitle"></h2><p id="importSummary"></p><div><span id="importProgressFill"></span></div><span id="importCurrentSource"></span><span id="importCurrentFile"></span><span id="importCount"></span><ol id="importSteps"></ol><button id="importClose"></button><button id="importReview"></button></div></section></body></html>');
  Object.defineProperty(dom.HTMLSelectElement.prototype,'value',{configurable:true,get(){return [...this.options].find(o=>o.selected)?.value||this.options[0]?.value||'';},set(value){[...this.options].forEach(o=>o.removeAttribute('selected'));[...this.options].find(o=>o.value===value)?.setAttribute('selected','');}});
  Object.defineProperty(dom.HTMLSelectElement.prototype,'selectedOptions',{configurable:true,get(){return [...this.options].filter(o=>o.selected);}});
  const storage=new Map([[KEY,JSON.stringify(existing)],['coachtools.desktop.cleanUploadBaseline.v1','unchanged baseline']]),writes=[],saves=[],analyses=[];
  let failStorage=false;
  const files=[{name:'Retail Weekly.csv'}];
  const entry={file:files[0],classification:{id:'weeklyRetail'},parsed:{meta:{totalRows:3}},discovery:{ownershipValues:['Alice Coach','Charlie Coach','Other Coach'].map(value=>({value}))}};
  const context=vm.createContext({document,console,setTimeout,clearTimeout,Event:dom.Event,requestAnimationFrame:fn=>setTimeout(fn,0),localStorage:{getItem:key=>storage.get(key)||null,setItem(key,value){if(failStorage)throw new Error('Storage full');writes.push(key);storage.set(key,value);}},CoachToolsData:{},CoachToolsImport:{
    SOURCES:{weeklyRetail:{label:'Retail Weekly'}},normalizeName:value=>String(value).toLowerCase().trim(),
    async analyzeFiles(value){analyses.push(value);return {recognized:[entry],errors:[],needsReview:[]};},
    resolveScopeSnapshot:scope=>scope,
    async saveRecognizedEntry(value,options){saves.push({entry:value,options});return {status:'saved',dataset:{scopedRowCount:2}};}
  }});context.window=context;
  for(const file of ['apps/allstar/js/organization-import.js','shared/coachtools-smart-import.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);
  const until=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,2));}throw new Error('UI did not settle');};
  const get=id=>document.getElementById(id);
  const upload=async text=>{const input=get('smartImportOrgsFile');input.files=[{name:'all_star_orgs.json',text:async()=>text}];input.dispatchEvent(new dom.Event('change',{bubbles:true}));await until(()=>!get('smartImportUploadOrgs').disabled);};
  return {context,storage,writes,saves,analyses,files,get,until,upload,fail:()=>{failStorage=true;}};
}

async function parity(){
  const desktop=harness(),allstar=createHarness();
  try{
    allstar.context.existing=existing;allstar.context.payload=JSON.stringify({version:1,orgs:incoming});
    allstar.run('state.orgs=existing.map(normalizeOrg);importOrgs(payload);');
    const merged=desktop.context.CoachToolsOrganizationImport.merge(JSON.stringify({version:1,orgs:incoming}),existing);
    assert.deepEqual(plain(merged.orgs),plain(allstar.run('state.orgs')));
    assert.equal(merged.orgs.find(o=>o.id==='new').name,'keep   this org copy');
    assert.deepEqual(plain(merged.orgs.find(o=>o.id==='replace').coachNames),["Jane O'Brien",'John Smith']);
    assert.equal(merged.orgs.find(o=>o.id==='keep').name,'Keep this org');
    assert.equal(merged.orgs.length,4);
    assert.deepEqual(plain(desktop.context.CoachToolsOrganizationImport.merge(JSON.stringify(incoming),existing).orgs),plain(merged.orgs),'array and All-Star export wrapper both work');
    const aliases={version:1,revision:1,aliases:[{role:'coach',from:'Alice Alias',to:'Alice Coach'}],links:[]};
    desktop.storage.set('coachtools.statsDirectory.v1',JSON.stringify(aliases));
    const renamed=desktop.context.CoachToolsOrganizationImport.merge(JSON.stringify([org('alias','Alias team',['Alice Alias'])]),[]);
    assert.deepEqual(plain(renamed.orgs[0].coachNames),['Alice Coach']);
    assert.deepEqual(allstar.errors,[]);
    console.log('PASS shared importer matches actual All-Star import: IDs, name collisions, coach normalization/deduplication, timestamps, arrays/wrappers and saved coach aliases');
  }finally{allstar.close();}
}

async function chooser(){
  const h=harness(),running=h.context.CoachToolsSmartImport.importFiles(h.files);
  await h.until(()=>h.get('smartImportChooser')&&!h.get('smartImportChooser').hidden);
  h.get('smartImportOrg').value='keep';
  h.get('smartImportAddOrg').click();
  const selected=h.get('smartImportSelected').textContent;
  let picks=0;h.get('smartImportOrgsFile').click=()=>picks++;
  h.get('smartImportUploadOrgs').click();assert.equal(picks,1);
  await h.upload(JSON.stringify({version:1,orgs:incoming}));
  assert.match(h.get('smartImportOrgStatus').textContent,/Imported 3 organizations/);
  assert.ok([...h.get('smartImportOrg').options].some(o=>o.value==='sts'));
  assert.equal(h.get('smartImportOrg').value,'keep','existing organization selection is preserved');
  assert.equal(h.get('smartImportSelected').textContent,selected,'importing orgs does not add or remove selected coaches');
  assert.deepEqual(h.writes,[KEY]);assert.equal(h.saves.length,0,'org import does not save pending datasets');
  assert.equal(h.storage.get('coachtools.desktop.cleanUploadBaseline.v1'),'unchanged baseline');
  assert.equal(h.analyses.length,1);assert.equal(h.analyses[0][0],h.files[0]);
  const before=h.storage.get(KEY),options=h.get('smartImportOrg').innerHTML;
  await h.upload('{broken');assert.match(h.get('smartImportOrgStatus').textContent,/Org import failed/);
  assert.equal(h.storage.get(KEY),before);assert.equal(h.get('smartImportOrg').innerHTML,options);
  assert.equal(h.get('smartImportOrgsFile').value,'','same file can be selected again after failure');
  await h.upload(JSON.stringify({orgs:[org('sts','STS team refreshed',['Alice Coach'])]}));
  assert.match(h.get('smartImportOrg').textContent,/STS team refreshed · 1 coaches/);
  const lastSaved=h.storage.get(KEY);h.fail();await h.upload(JSON.stringify({orgs:[org('lost','Should not save',['Alice Coach'])]}));
  assert.match(h.get('smartImportOrgStatus').textContent,/Storage full/);assert.equal(h.storage.get(KEY),lastSaved);
  assert.ok(![...h.get('smartImportOrg').options].some(o=>o.value==='lost'));
  h.get('smartImportOrg').value='sts';h.get('smartImportAddOrg').click();
  assert.match(h.get('smartImportSelected').textContent,/Alice Coach/);
  h.get('smartImportSelectedBtn').click();await running;
  assert.equal(h.saves.length,1);assert.equal(h.saves[0].entry.file,h.files[0]);
  assert.deepEqual(plain(h.saves[0].options.scope.coaches).sort(),['Alice Coach','Other Coach']);
  console.log('PASS actual Clean Upload chooser: picker, immediate org-list refresh, preserved selections/baseline/files, normal Add Org Coaches flow and recoverable JSON/storage failures');
}
(async()=>{await parity();await chooser();})().catch(error=>{console.error(error);process.exitCode=1;});
