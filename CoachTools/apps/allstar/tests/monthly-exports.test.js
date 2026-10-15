'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const M=require('../../../shared/coachtools-monthly.js');
const {parseHTML}=require('linkedom'),{IDBFactory}=require('fake-indexeddb');
const XLSX=require('../../../vendor/xlsx.full.min.js');
const root=path.resolve(__dirname,'..');
const period='Fiscal LM (2026-08-30 – 2026-09-26)';
function opportunity(rows,periodLabel=period){return M.source([
 ['','','',...Array(9).fill('OPPORTUNITY_LATEST_SEGMENT')],
 ['','','',...M.SEGMENTS.flatMap(s=>Array(3).fill(s.toUpperCase()))],
 ['','','',...M.SEGMENTS.flatMap(()=>['Opportunities','Appointments','Appt Rate'])],
 ...rows.map(([coach,name,opps,apps])=>[coach,name,periodLabel,...M.SEGMENTS.flatMap(()=>[opps,apps,opps?`${(apps/opps*100).toFixed(1)}%`:''])])
],'opportunity.csv');}
function wiper(date,rows,name='wiper.csv'){return M.source([['REPORT DATE','EMPLOYEE_FULL_NAME','WIPERS_ACCEPTED','WIPERS_OFFERED'],...rows.map(r=>[date,...r])],name);}
function include(f,start,end){f.assignments[Object.keys(f.assignments)[0]||f.rows[0].reportDate]={start,end,meaning:'week-label',note:'Confirmed fixture week label denotes preceding activity week.'};return f;}
function fullBundle(){
 let b=M.add({...M.create('retail'),dateMode:'dated'},opportunity([['Coach Alpha','Rep One',10,8],['Coach Alpha','Rep Two',90,18]])).bundle;
 const weeks=[['9/6/2026','2026-08-30','2026-09-05',4,10],['9/13/2026','2026-09-06','2026-09-12',6,20],['9/20/2026','2026-09-13','2026-09-19',5,10],['9/27/2026','2026-09-20','2026-09-26',5,10]];
 for(const [date,start,end,a,o] of weeks)b=M.add(b,include(wiper(date,[['  REP  ONE ',a,o],['Rep Two',0,0]],`week-${date.replaceAll('/','-')}.csv`),start,end)).bundle;
 b.consumerAsCash=true;return b;
}
function undatedBundle(){
 const source=opportunity([], '');
 const rows=[['High Coach','High Rep',20,16,64],['Edge Coach','Edge Rep',20,15,65],['Low Coach','Low Rep',20,14,66],['Weighted Coach','Small Rep',1,9,0],[' weighted  coach ','Large Rep',44,1,45]];
 const aoa=source.aoa.concat(rows.map(([coach,name,...counts],i)=>[coach,name,i%2?'invalid label':'',...counts.flatMap(n=>[n,0,'0%'])]));
 let b=M.add(M.create('mixed'),M.source(aoa,'opportunity-no-dates.csv')).bundle;
 b=M.add(b,M.source([['EMPLOYEE_FULL_NAME','WIPERS_ACCEPTED','WIPERS_OFFERED'],...rows.map(r=>[r[1],1,4])],'wipers-no-dates.csv')).bundle;
 return b;
}
async function undatedReviewTest(bundle,sources=[]){
 const {window}=parseHTML('<html><body></body></html>'),document=window.document;
 // LinkeDOM lacks the browser select.value setter used by the real dialog.
 const proto=Object.getPrototypeOf(document.createElement('select')),get=Object.getOwnPropertyDescriptor(proto,'value').get;
 Object.defineProperty(proto,'value',{configurable:true,get,set(v){for(const o of this.querySelectorAll('option'))o.removeAttribute('selected');for(const o of this.querySelectorAll('option'))if(o.value===v)o.setAttribute('selected','');}});
 const context=vm.createContext({window:{document,CoachToolsMonthly:M},console});
 vm.runInContext(fs.readFileSync(path.join(root,'../../shared/coachtools-monthly-review.js'),'utf8'),context);
 const pending=context.window.CoachToolsMonthlyReview.review({bundle,sources});
 assert.equal(document.querySelectorAll('input[type="date"]').length,0);
 assert.doesNotMatch(document.body.textContent,/REPORT DATE:|Fiscal period:|Activity from|Basis for assignment/);
 assert.match(document.body.textContent,/15% or higher/);
 const areaLabels=[...document.querySelectorAll('select')].map(s=>s.textContent);
 assert.ok(areaLabels.some(s=>s.includes('Automatic — Monthly Retail')));
 assert.ok(areaLabels.some(s=>s.includes('Automatic — Monthly Referral')));
 const apply=document.querySelector('#monthlyApply');
 assert.equal(document.querySelectorAll('input[type=checkbox]').length,0);
 assert.ok(document.querySelector('#monthlyTeamPreview'));assert.ok(document.querySelector('#monthlyRepPreview'));
 assert.equal(document.querySelector('#monthlyFiles').dataset.coachtoolsAutoImport,'false');
 assert.equal(apply.disabled,false);apply.click();
 const reviewed=await pending;assert.ok(M.compile(reviewed).canApply);assert.match(reviewed.importedAt,/^\d{4}-\d{2}-\d{2}T/);
 return reviewed;
}
function harness(db=new IDBFactory(),storage=new Map()){
 const {document}=parseHTML(fs.readFileSync(path.join(root,'allstar.html'),'utf8'));
 const errors=[],window={document,indexedDB:db,addEventListener(){},location:{search:''}};
 const context=vm.createContext({document,window,indexedDB:db,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},XLSX,console:{info(){},warn(){},error(...args){errors.push(args);}},performance,setTimeout,clearTimeout,setInterval,clearInterval,structuredClone,URL,TextEncoder,TextDecoder,requestAnimationFrame:fn=>setTimeout(fn,0),navigator:{},location:{search:''},alert:m=>errors.push(m),confirm:()=>true});
 const names=[...fs.readFileSync(path.join(root,'allstar.html'),'utf8').matchAll(/<script src="(js\/[^"]+)"><\/script>/g)].map(m=>m[1]).filter(n=>n!=='js/app.js');
 vm.runInContext(fs.readFileSync(path.join(root,'../../shared/coachtools-monthly.js'),'utf8')+'\n'+names.map(n=>fs.readFileSync(path.join(root,n),'utf8')).join('\n'),context);
 vm.runInContext(`setStatus=renderEditModelSafe=renderTeamSelect=updateResearchCacheBadge=()=>{};showProgress=hideProgress=updateProgress=()=>{};state.startup.running=false;state.lifecycle.hidden=false;loadModels();`,context);
 return {context,db,storage,errors,run:s=>vm.runInContext(s,context),stop(){vm.runInContext('state.lifecycle.closing=true;clearTimeout(state.importCacheSaveTimer);',context);}};
}
async function monthlyUploadFlowTest(){
 const h=harness();
 try{
  h.context.baseline=fullBundle();assert.equal(await h.run('commitMonthlyBundle(baseline)'),true);
  h.run('window.XLSX=XLSX;');
  vm.runInContext(fs.readFileSync(path.join(root,'../../shared/coachtools-monthly-review.js'),'utf8'),h.context);
  const pending=h.run('openMonthlyImport()'),doc=h.context.document;
  const file=src=>{const bytes=Buffer.concat([Buffer.from([255,254]),Buffer.from(src.aoa.map(r=>r.join('\t')).join('\r\n'),'utf16le')]);return {name:src.name,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length)};};
  const op=opportunity([['Coach Alpha','Rep One',10,8],['Coach Alpha','Rep Two',90,18]],'');
  const files=[file(wiper('a',[['Rep One',4,10],['Rep Two',0,0]],'one.csv')),file(op),file(wiper('b',[['Rep One',6,20],['Rep Two',0,0]],'two.csv')),file(wiper('c',[['Unknown Rep',2,5]],'unmatched.csv'))];
  const upload=doc.getElementById('monthlyFiles');Object.defineProperty(upload,'files',{value:files});await upload.onchange();
  assert.equal(doc.querySelectorAll('#monthlyImportReview input[type=checkbox]').length,0);
  assert.match(doc.getElementById('monthlyTeamPreview').textContent,/Coach Alpha/);assert.match(doc.getElementById('monthlyRepPreview').textContent,/33.33%/);
  assert.match(doc.getElementById('monthlyImportReview').textContent,/3 Wiper files combined/);
  let apply=doc.getElementById('monthlyApply');assert.equal(apply.disabled,false,'warnings must not block a monthly save');
  const search=doc.getElementById('monthlyPreviewSearch');search.value='Rep One';search.onchange();assert.equal(doc.getElementById('monthlyApply'),apply,'blur/change preserves the clicked save button');
  h.run('state.startup.running=true;');await apply.onclick();assert.match(doc.getElementById('monthlyImportReview').textContent,/still loading or saving/);assert.equal(h.run('state.data.retail.wiper[0].Accepted'),20);
  h.run('state.startup.running=false;const normalIdbReq=idbReq;idbReq=(req,label)=>normalIdbReq(req,label).then(r=>label==="Verifying retail_wiper"?{...r,value:{rows:[]}}:r);');
  await apply.onclick();assert.match(doc.getElementById('monthlyImportReview').textContent,/Could not save/);assert.equal(h.run('state.data.retail.wiper[0].Accepted'),20);assert.equal(apply.disabled,false);
  h.run('idbReq=normalIdbReq;');
  const before=h.run('state.importJobHistory.length');const first=apply.onclick(),second=apply.onclick();await Promise.all([first,second]);const saved=await pending;
  assert.equal(saved.wipers.length,3);assert.equal(doc.getElementById('monthlyImportReview'),null);assert.equal(h.run('state.importJobHistory.length'),before+1);
  assert.equal(h.run('state.data.retail.wiper[0].Accepted'),10);assert.equal(h.run('state.data.retail.wiper[0].Offered'),30);assert.equal(h.run('state.data.retail.sv2[0]["Cash Opps"]'),10);assert.equal(h.run('state.data.retail.sv2[0]["Cash Apps"]'),8);
  assert.equal(h.run('state.data.retail.teamTotals.rows[0]["Cash Appointment Rate"]'),26);assert.equal(h.run('state.data.retail.monthlySummary.partial'),true);
  const reload=harness(h.db,h.storage);try{await reload.run('loadImportedDataFromIndexedDB({deferRender:true})');assert.equal(reload.run('state.data.retail.wiper[0].Accepted'),10);assert.equal(reload.run('state.data.retail.monthlySummary.importedAt'),saved.importedAt);}finally{reload.stop();}
  // Detached form controls used to throw the reported null.dataset TypeError.
  h.run('const looseControls=["cfield","rpfield","ff"].map(key=>{const x=document.createElement("input");x.setAttribute("data-"+key,"name");els.criteriaList.append(x);return x;});bindCriteriaEditors();');
  assert.doesNotThrow(()=>h.run('looseControls.forEach(x=>{x.remove();x.onchange();});'));
  console.log('PASS real multi-file picker → combined preview → save/retry/reload, no approval checkboxes, stable Save click and detached controls');
 }finally{h.stop();}
}
async function categoryIsolationTest(){
 const fixture=require('./fixtures/monthly-hierarchy.js');
 const op=M.source([...fixture.header,fixture.row('Manager A','Shared Coach','Shared Rep',[90,5,5]),fixture.row('Manager A','High Coach','High Rep',[40,20,40])],'opportunity.csv');
 const w=M.source([['REPORT DATE','EMPLOYEE_IMMEDIATE_SUPERVISOR_NAME','EMPLOYEE_FULL_NAME','COUNT_WIPERS_ACCEPTED','COUNT_WIPERS_OFFERED'],['9/6/2026','Shared Coach','Shared Rep',2,10],['9/6/2026','High Coach','High Rep',3,10],['9/6/2026','Extra Coach','Wiper Only',1,4]],'wiper.csv');
 const mixed=M.add(M.add(M.create('mixed'),op).bundle,w).bundle,original=JSON.stringify(mixed);
 assert.ok(M.compile(mixed).reps.some(r=>r.area==='retail'));assert.ok(M.compile(mixed).reps.some(r=>r.area==='referral'));
 assert.equal(M.compile(mixed).reps.find(r=>r.name==='Wiper Only').area,'referral','Wiper-only teams without Opportunity counts use the Referral fallback');assert.ok(M.compile(mixed).reps.every(r=>['retail','referral'].includes(r.area)));
 for(const [segment,value] of [['consumer',''],['consumer','*'],['consumer','N/A'],['consumer','-1'],['commercial','']]){
  const missing=M.clone(mixed);missing.opportunity.rows.find(r=>r.name==='High Rep').segments[segment].opportunities=M.cell(value);const out=M.compile(missing),assignment=out.coachAssignments.find(c=>c.coach==='High Coach');
  assert.equal(assignment.share,null);assert.equal(assignment.automatic,'referral');assert.equal(out.reps.find(r=>r.name==='High Rep').area,'referral');assert.equal(out.canApply,true);assert.equal(out.issues.some(i=>i.code==='area-required'),false);
 }
 const zeroModern=M.clone(mixed);for(const s of M.SEGMENTS)zeroModern.opportunity.rows.find(r=>r.name==='High Rep').segments[s].opportunities=M.cell(0);const zeroModernOut=M.compile(zeroModern);assert.equal(zeroModernOut.coachAssignments.find(c=>c.coach==='High Coach').share,null);assert.equal(zeroModernOut.reps.find(r=>r.name==='High Rep').area,'referral');assert.ok(zeroModernOut.reps.every(r=>['retail','referral'].includes(r.area)));
 for(const area of ['retail','referral']){
  const scoped=M.forArea(mixed,area),out=M.compile(scoped);
  assert.equal(scoped.uploadArea,area);assert.equal(scoped.scope,area);assert.equal(out.canApply,true);
  assert.equal(out.reps.length,3);assert.ok(out.reps.every(r=>r.area===area),'the upload category owns Opportunity and Wiper-only rows');assert.ok(out.teams.every(t=>t.area===area));
  assert.equal(M.toDataset(scoped,area).meta.totalRows,3);assert.equal(M.toDataset(scoped,area==='retail'?'referral':'retail').meta.totalRows,0);
  assert.ok(M.compile(M.forArea(fullBundle(),area)).reps.every(r=>r.area===area),'explicit category also governs legacy exports');
 }
 assert.equal(JSON.stringify(mixed),original,'category selection must clone the source bundle');
 const h=harness();h.run('window.XLSX=XLSX;');
 vm.runInContext(fs.readFileSync(path.join(root,'../../shared/coachtools-monthly-review.js'),'utf8'),h.context);
 const doc=h.context.document,file=src=>{const bytes=Buffer.from(src.aoa.map(r=>r.join('\t')).join('\r\n'),'utf8');return {name:src.name,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length)};};
 const upload=async sources=>{const picker=doc.getElementById('monthlyFiles');Object.defineProperty(picker,'files',{value:sources.map(file)});await picker.onchange();};
 const switchArea=area=>{const picker=doc.getElementById('monthlyUploadArea');assert.ok(picker,'the intake must expose Retail and Referral upload categories');picker.value=area;picker.onchange();assert.equal(doc.getElementById('monthlyUploadArea').value,area);};
 let reload,central;
 try{
  let pending=h.run('openMonthlyImport("retail")');
  assert.equal(doc.getElementById('monthlyUploadArea').value,'retail');assert.match(doc.getElementById('monthlyImportReview').textContent,/Add Retail Opportunity \/ Wiper files/);
  await upload([w,op]);assert.equal(doc.getElementById('monthlyApply').disabled,false);assert.match(doc.getElementById('monthlyRepPreview').textContent,/Wiper Only/);
  switchArea('referral');assert.equal(doc.getElementById('monthlyApply').disabled,true,'switching to a fresh category must not reuse Retail files');
  await upload([op,w]);assert.equal(doc.getElementById('monthlyApply').disabled,false);assert.match(doc.getElementById('monthlyApply').textContent,/Referral/);
  switchArea('retail');assert.equal(doc.getElementById('monthlyApply').disabled,false,'switching back restores the independent Retail draft');
  await doc.getElementById('monthlyApply').onclick();const retailSaved=await pending;
  assert.equal(retailSaved.uploadArea,'retail');assert.equal(h.run('state.data.retail.sv2.length'),3);assert.equal(h.run('state.data.referral.sv2.length'),0);
  const retailBefore=h.run('JSON.stringify(state.data.retail)'),retailMeta=h.run('JSON.stringify(state.sourceMeta.retail_wiper)');
  pending=h.run('openMonthlyImport("referral")');await upload([op,w]);assert.equal(doc.getElementById('monthlyApply').disabled,false,'the same Wiper file and labels are valid in Referral');
  await doc.getElementById('monthlyApply').onclick();const referralSaved=await pending;
  assert.equal(referralSaved.uploadArea,'referral');assert.equal(h.run('JSON.stringify(state.data.retail)'),retailBefore);assert.equal(h.run('JSON.stringify(state.sourceMeta.retail_wiper)'),retailMeta);
  assert.equal(h.run('state.data.referral.sv2.length'),3);assert.equal(h.run('state.data.referral.wiper.reduce((n,r)=>n+r.Accepted,0)'),6);
  assert.equal(h.run('state.importJobHistory.length'),2);assert.equal(h.run('monthlySourceRows("monthly_opportunity").length'),4,'identical Opportunity rows in separate categories must remain separate');assert.equal(h.run('monthlySourceRows("monthly_wiper").length'),6,'identical Wiper rows in separate categories must remain separate');
  assert.match(doc.getElementById('monthlyImportSummary').textContent,/Monthly Retail.*Monthly Referral/);
  const referralBefore=h.run('JSON.stringify(state.data.referral)');
  const updated=M.clone(retailSaved);updated.opportunity=M.source([...fixture.header,fixture.row('Manager A','Shared Coach','Shared Rep',[80,10,10]),fixture.row('Manager A','High Coach','High Rep',[40,20,40])],'opportunity.csv');updated.importedAt='2099-02-01T00:00:00.000Z';h.context.updated=updated;
  assert.equal(await h.run('commitMonthlyBundle(updated)'),true,JSON.stringify(h.errors));assert.equal(h.run('JSON.stringify(state.data.referral)'),referralBefore);
  assert.equal(h.run('state.data.retail.sv2.find(r=>r.Representative==="Shared Rep")["Consumer Opportunities"]'),10);assert.equal(h.run('Object.keys(state.data.retail.monthlyHistory).length'),1);assert.equal(h.run('Object.values(state.data.retail.monthlyHistory)[0].uploadArea'),'retail');assert.equal(h.run('Object.keys(state.data.referral.monthlyHistory).length'),0);
  const correction=M.source([w.aoa[0],['9/6/2026','Shared Coach','Shared Rep',9,10]],'correction.csv');h.context.overlap=M.add(updated,correction).bundle;
  assert.equal(M.compile(h.context.overlap).canApply,false,'conflicting overlaps within Retail still require correction');const retailStable=h.run('JSON.stringify(state.data.retail)');assert.equal(await h.run('commitMonthlyBundle(overlap,{silent:true})'),false);assert.equal(h.run('JSON.stringify(state.data.retail)'),retailStable);assert.equal(h.run('JSON.stringify(state.data.referral)'),referralBefore);
  reload=harness(h.db,h.storage);await reload.run('loadImportedDataFromIndexedDB({deferRender:true})');assert.equal(reload.run('JSON.stringify(state.data.retail.monthlyBundle)'),JSON.stringify(updated));assert.equal(reload.run('state.data.referral.monthlyBundle.uploadArea'),'referral');assert.equal(reload.run('state.data.referral.wiper.reduce((n,r)=>n+r.Accepted,0)'),6);assert.equal(reload.run('monthlySourceRows("monthly_wiper").length'),6);
  central=harness();central.context.retailDataset=M.toDataset(retailSaved,'retail');central.context.referralDataset=M.toDataset(referralSaved,'referral');
  central.run('let categoryVersions={monthlyRetail:1,monthlyReferral:1};window.CoachToolsData={ready:async()=>{},getDatasetVersion:type=>categoryVersions[type]?{id:type,version:categoryVersions[type],classificationMethod:"reviewed-monthly-bundle",importedAt:"2099-01-01T00:00:00Z"}:null,getCurrent:async type=>({originalFileName:"opportunity.csv",data:type==="monthlyRetail"?retailDataset:referralDataset})};');
  assert.equal((await central.run('syncAllStarFromCoachToolsData({render:false})')).changed,true,JSON.stringify(central.errors));assert.equal(central.run('state.data.retail.sv2.length'),3);assert.equal(central.run('state.data.referral.sv2.length'),3);
  const centralReferral=central.run('JSON.stringify(state.data.referral)');central.context.retailDataset=M.toDataset(updated,'retail');central.run('categoryVersions.monthlyRetail=2;window.CoachToolsData.getDatasetVersion=type=>categoryVersions[type]?{id:type,version:categoryVersions[type],classificationMethod:"reviewed-monthly-bundle",importedAt:type==="monthlyRetail"?"2099-02-01T00:00:00Z":"2099-01-01T00:00:00Z"}:null;');
  assert.equal((await central.run('syncAllStarFromCoachToolsData({render:false})')).changed,true,JSON.stringify(central.errors));assert.equal(central.run('JSON.stringify(state.data.referral)'),centralReferral);assert.equal(central.run('state.data.retail.sv2.find(r=>r.Representative==="Shared Rep")["Consumer Opportunities"]'),10);
  h.context.legacyMixed=mixed;h.context.incoming=[op,correction];
  pending=h.run('window.CoachToolsMonthlyReview.review({bundle:legacyMixed,sources:incoming})');assert.equal(doc.getElementById('monthlyUploadArea').value,'mixed');assert.equal(doc.getElementById('monthlyApply').disabled,true,'an incoming correction conflicts with the old combined Wiper export');
  switchArea('referral');assert.equal(doc.getElementById('monthlyApply').disabled,false,'switching an initial upload to a fresh category must retain its Opportunity and Wiper files');
  switchArea('mixed');assert.equal(doc.getElementById('monthlyApply').disabled,true,'the old combined draft keeps its conflict');switchArea('referral');
  await doc.getElementById('monthlyApply').onclick();const incomingSaved=await pending;assert.equal(incomingSaved.uploadArea,'referral');assert.equal(incomingSaved.wipers.length,1);assert.equal(incomingSaved.wipers[0].id,correction.id);assert.equal(M.compile(incomingSaved).reps.find(r=>r.name==='Shared Rep').wiper.accepted,9);
  console.log('PASS separate Retail/Referral intake drafts, identical-label uploads, category-only updates/history, overlap validation, combined sources, reload and central sync');
 }finally{h.stop();reload?.stop();central?.stop();}
}
async function referralWipersOnlyTest(){
 const fixture=require('./fixtures/monthly-hierarchy.js'),header=fixture.wiper[0];
 const first=M.source([header,['9/6/2026','Referral Coach A','Shared Rep',2,10],['9/6/2026','Referral Coach A','Other Rep',3,10],['9/6/2026','Referral Coach B','Shared Rep',1,5]],'referral-week-one.csv');
 const second=M.source([header,['9/13/2026','Referral Coach A','Shared Rep',4,10],['9/13/2026','Referral Coach A','Other Rep',0,0],['9/13/2026','Referral Coach B','Shared Rep',1,5]],'referral-week-two.csv');
 const fresh=()=>M.forArea(M.create('referral'),'referral'),b=M.add(M.add(fresh(),first).bundle,second).bundle,out=M.compile(b);
 assert.equal(b.opportunity,null);assert.equal(out.canApply,true);assert.equal(out.wipersOnly,true);assert.equal(out.partial,false,'optional Opportunity data must not mark valid Wiper-only data incomplete');assert.equal(out.reps.length,3);assert.equal(out.teams.length,2);assert.equal(out.overall.wiper.accepted,11);assert.equal(out.overall.wiper.offered,40);assert.ok(out.reps.every(r=>r.area==='referral'&&!r.hasOpportunity&&M.SEGMENTS.every(s=>r.segments[s].opportunities===null&&r.segments[s].appointments===null)));
 assert.equal(M.toDataset(b,'referral').meta.monthlyWipersOnly,true);assert.equal(M.compile(fresh()).canApply,false);
 for(const row of [['9/6/2026','','Rep',1,2],['9/6/2026','Coach','',1,2],['9/6/2026','Coach','Rep',3,2]]){const invalid=M.compile(M.add(fresh(),M.source([header,row],'unusable.csv')).bundle);assert.equal(invalid.canApply,false);assert.ok(invalid.issues.some(i=>i.code==='wiper-roster-required'));}
 assert.equal(M.compile(M.add(fresh(),wiper('9/6/2026',[['Rep',1,2]])).bundle).canApply,false,'names without coaches cannot establish a Wiper-only roster');
 for(const area of ['retail','mixed']){const other=M.clone(b);other.scope=area;if(area==='retail')other.uploadArea=area;else delete other.uploadArea;assert.equal(M.compile(other).canApply,false,'Opportunity remains required outside Referral');}
 const conflict=M.source([header,['9/6/2026','Referral Coach A','Shared Rep',9,10]],'correction.csv'),blocked=M.add(b,conflict).bundle;
 assert.equal(M.compile(blocked).canApply,false);blocked.wipers.at(-1).replaces=first.id;assert.equal(M.compile(blocked).canApply,true);
 const h=harness();let reload,central;
 try{
  h.context.baseline=fullBundle();assert.equal(await h.run('commitMonthlyBundle(baseline)'),true);const retailBefore=h.run('JSON.stringify(state.data.retail)');
  h.run('window.XLSX=XLSX;');h.context.Event=Event;for(const name of ['groupCollapsed','groupEnd','time','timeEnd','table'])h.context.console[name]=()=>{};
  vm.runInContext(fs.readFileSync(path.join(root,'../../shared/coachtools-monthly-review.js'),'utf8'),h.context);
  const doc=h.context.document,file=src=>{const bytes=Buffer.from(src.aoa.map(r=>r.join('\t')).join('\r\n'));return {name:src.name,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length)};};
  const upload=async sources=>{const picker=doc.getElementById('monthlyFiles');Object.defineProperty(picker,'files',{value:sources.map(file)});await picker.onchange();};
  h.context.incomingWipers=[first,second];
  let staged=h.run('window.CoachToolsMonthlyReview.review({bundle:window.CoachToolsMonthly.create("mixed"),sources:incomingWipers})');assert.equal(doc.getElementById('monthlyApply').disabled,true);
  const category=doc.getElementById('monthlyUploadArea');category.value='referral';category.onchange();assert.equal(doc.getElementById('monthlyApply').disabled,false,'incoming Wipers can be routed to Referral without adding an Opportunity');
  await doc.getElementById('monthlyApply').onclick();assert.equal((await staged).opportunity,null);
  let pending=h.run('openMonthlyImport("referral")');await upload([second,first]);assert.equal(doc.getElementById('monthlyApply').disabled,false);assert.match(doc.getElementById('monthlyImportReview').textContent,/Opportunity optional/);assert.match(doc.getElementById('monthlyRepPreview').textContent,/Shared Rep/);assert.match(doc.getElementById('monthlyRepPreview').textContent,/N\/A/);
  await doc.getElementById('monthlyApply').onclick();const saved=await pending;assert.equal(saved.opportunity,null);assert.equal(h.run('JSON.stringify(state.data.retail)'),retailBefore);assert.equal(h.run('state.data.referral.controlRoster.length'),3);assert.equal(h.run('state.data.referral.controlRoster.every(r=>r.sheetName==="Monthly Wipers")'),true);assert.equal(h.run('state.data.referral.monthlySummary.wipersOnly'),true);assert.equal(h.run('state.data.referral.monthlySummary.partial'),false);
  assert.equal(h.run('monthlySourceRows("monthly_opportunity").filter(r=>r._sourceArea==="referral").length'),0);assert.equal(h.run('monthlySourceRows("monthly_wiper").filter(r=>r._sourceArea==="referral").length'),3);
  h.run('openMonthlyManagerReport()');assert.match(doc.getElementById('monthlyManagerReport').textContent,/referral-week-one.csv/);doc.querySelector('[data-monthly-close]').click();
  h.run('state.models=[normalizeModelForStorage({id:"wipers-only-referral",name:"Wipers only Referral",criteria:[{...emptyCriterion(),id:"accepted",name:"Wipers accepted",source:"referral_wiper",column:"Accepted",aggregate:"sum",weight:"1"}]})];');
  const report=await h.run('buildRun({settings:{modelId:"wipers-only-referral",selectedTeams:["Referral Coach A","Referral Coach B"],view:"both",runMode:"single"},rethrow:true})');
  assert.equal(report.repPack.rows.length,3);assert.equal(report.teamPack.rows.length,2);assert.deepEqual(Array.from(report.teamPack.rows,r=>r.values.accepted).sort((a,b)=>a-b),[2,9]);assert.deepEqual(Array.from(report.repPack.rows,r=>r.values.accepted).sort((a,b)=>a-b),[2,3,6]);
  reload=harness(h.db,h.storage);await reload.run('loadImportedDataFromIndexedDB({deferRender:true})');assert.equal(reload.run('state.data.referral.monthlyBundle.opportunity'),null);assert.equal(reload.run('state.data.referral.controlRoster.length'),3);assert.equal(reload.run('state.data.referral.wiper.reduce((n,r)=>n+r.Accepted,0)'),11);
  pending=h.run('openMonthlyImport("referral")');await upload([{...second,name:'renamed.csv'}]);assert.equal(doc.getElementById('monthlyApply').disabled,false);await doc.getElementById('monthlyApply').onclick();await pending;assert.equal(h.run('state.data.referral.monthlyBundle.wipers.length'),2);assert.equal(h.run('state.data.referral.wiper.reduce((n,r)=>n+r.Accepted,0)'),11);
  central=harness();central.context.dataset=M.toDataset(saved,'referral');central.run('window.CoachToolsData={ready:async()=>{},getDatasetVersion:type=>type==="monthlyReferral"?{id:"wipers-only",version:1,classificationMethod:"reviewed-monthly-bundle",importedAt:"2099-01-01T00:00:00Z"}:null,getCurrent:async()=>({originalFileName:"referral-wipers.csv",data:dataset})};');
  assert.equal((await central.run('syncAllStarFromCoachToolsData({render:false})')).changed,true);assert.equal(central.run('state.data.referral.wiper.reduce((n,r)=>n+r.Accepted,0)'),11);assert.equal(central.run('state.data.referral.controlRoster.length'),3);assert.equal(central.run('state.data.retail.sv2.length'),0);
  const op=M.source([...fixture.header,fixture.row('','Referral Coach A','Shared Rep',[80,10,10]),fixture.row('','Referral Coach A','Other Rep',[80,10,10]),fixture.row('','Referral Coach B','Shared Rep',[80,10,10])],'optional-opportunity.csv');h.context.withOp=M.add(saved,op).bundle;
  assert.equal(await h.run('commitMonthlyBundle(withOp)'),true);assert.equal(h.run('state.data.referral.wiper.reduce((n,r)=>n+r.Accepted,0)'),11);assert.equal(h.run('Object.values(state.data.referral.monthlyHistory)[0].opportunity'),null);assert.equal(h.run('JSON.stringify(state.data.retail)'),retailBefore);
  console.log('PASS Referral Wipers-only picker/save, source-owned roster, unavailable Opportunity fields, reports, duplicate/correction checks, reload, central sync and optional Opportunity history');
 }finally{h.stop();reload?.stop();central?.stop();}
}
async function optionalManagerIntakeTest(){
 const fixture=require('./fixtures/monthly-hierarchy.js'),h=harness();
 try{
  h.run('window.XLSX=XLSX;');h.context.Event=Event;for(const name of ['groupCollapsed','groupEnd','time','timeEnd','table'])h.context.console[name]=()=>{};
  vm.runInContext(fs.readFileSync(path.join(root,'../../shared/coachtools-monthly-review.js'),'utf8'),h.context);
  const op=M.source([...fixture.header,fixture.row('','Coach No Manager','First Rep',[80,10,10]),fixture.row('','Coach No Manager','Second Rep',[60,10,30])],'opportunity-no-manager.csv');
  const w=M.source([['REPORT DATE','EMPLOYEE_IMMEDIATE_SUPERVISOR_NAME','EMPLOYEE_FULL_NAME','COUNT_WIPERS_ACCEPTED','COUNT_WIPERS_OFFERED'],['9/6/2026','Coach No Manager','First Rep',2,10],['9/6/2026','Coach No Manager','Second Rep',3,10]],'wiper-no-manager.csv');
  const pending=h.run('openMonthlyImport("referral")'),doc=h.context.document,picker=doc.getElementById('monthlyFiles');
  Object.defineProperty(picker,'files',{value:[op,w].map(src=>{const bytes=Buffer.from(src.aoa.map(r=>r.join('\t')).join('\r\n'),'utf8');return {name:src.name,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length)};})});await picker.onchange();
  assert.equal(doc.getElementById('monthlyApply').disabled,false,'a Coach and Representative are sufficient to save without a Manager');assert.match(doc.getElementById('monthlyRepPreview').textContent,/Unassigned Manager/);
  await doc.getElementById('monthlyApply').onclick();const saved=await pending;assert.equal(M.compile(saved).issues.some(i=>i.severity==='blocker'),false);
  assert.equal(h.run('state.data.referral.sv2.length'),2);assert.equal(h.run('state.data.referral.controlRoster.length'),2);assert.equal(h.run('state.data.referral.teamTotals.rows[0]["Consumer Opportunities"]'),20);assert.equal(h.run('state.data.referral.teamTotals.rows[0].Accepted'),5);
  h.run('state.models=[normalizeModelForStorage({id:"coach-without-manager",name:"Coach without Manager",criteria:[{...emptyCriterion(),id:"wiper-count",name:"Wipers accepted",source:"referral_wiper",column:"Accepted",aggregate:"sum",weight:"1"}]})];');
  const report=await h.run('buildRun({settings:{modelId:"coach-without-manager",selectedTeams:["Coach No Manager"],view:"both",runMode:"single"},rethrow:true})');
  assert.ok(report,'the report must run using the Coach without a Manager');assert.equal(report.repPack.rows.length,2);assert.equal(report.teamPack.rows.length,1);assert.equal(report.teamPack.rows[0].values['wiper-count'],5);assert.deepEqual(Array.from(report.repPack.rows,r=>r.values['wiper-count']).sort((a,b)=>a-b),[2,3]);assert.match(doc.getElementById('workArea').textContent,/Coach No Manager/);
  console.log('PASS Coach-only monthly intake saves and runs both representatives and team totals without a Manager');
 }finally{h.stop();}
}
(async()=>{
 const undated=undatedBundle(),newOut=M.compile(undated);
 assert.equal(newOut.period,null);assert.equal(newOut.coverageComplete,null);assert.equal(newOut.canApply,true,JSON.stringify(newOut.issues));
 assert.deepEqual(newOut.coachAssignments.map(c=>[c.key,c.share,c.area]),[['high coach',.16,'retail'],['edge coach',.15,'retail'],['low coach',.14,'referral'],['weighted coach',.10,'referral']]);
 assert.equal(newOut.reps.filter(r=>r.coach.toLowerCase().includes('weighted')).every(r=>r.area==='referral'),true);
 assert.ok(newOut.reps.every(r=>r.wiper.accepted===1));assert.ok(newOut.reps.every(r=>r.wiper.contributions.every(c=>!c.start&&!c.end)));
 const manual=M.clone(undated);manual.coachAreas['edge coach']='retail';assert.equal(M.compile(manual).reps[1].area,'retail');
 for(const value of ['', '*', 'N/A', '-1']){const unknown=M.clone(undated);unknown.opportunity.rows[0].segments.consumer.opportunities=M.cell(value);const out=M.compile(unknown);assert.equal(out.coachAssignments[0].share,null);assert.equal(out.coachAssignments[0].automatic,'referral');assert.equal(out.reps[0].area,'referral');assert.equal(out.issues.some(i=>i.code==='area-required'),false);assert.equal(out.canApply,true);unknown.coachAreas['high coach']='retail';assert.equal(M.compile(unknown).reps[0].area,'retail');}
 const zeroCalls=M.clone(undated);for(const s of M.SEGMENTS)zeroCalls.opportunity.rows[0].segments[s].opportunities=M.cell(0);assert.equal(M.compile(zeroCalls).coachAssignments[0].share,null);assert.equal(M.compile(zeroCalls).reps[0].area,'referral');assert.equal(M.compile(zeroCalls).issues.some(i=>i.code==='area-required'),false);assert.equal(M.compile(zeroCalls).canApply,true);
 const noDates=M.asUndated(fullBundle());for(const f of noDates.wipers)f.assignments={};assert.equal(M.compile(noDates).canApply,true);assert.equal(M.compile(noDates).reps[0].wiper.accepted,20);
 const plus=M.add(undated,M.source([['EMPLOYEE_FULL_NAME','WIPERS_ACCEPTED','WIPERS_OFFERED'],['High Rep',2,6]],'extra.csv')).bundle;assert.equal(M.compile(plus).reps[0].wiper.accepted,3);
 assert.equal(M.add(plus,{...M.clone(plus.wipers[1]),name:'renamed.csv'}).duplicate,true);
 plus.wipers[1].replaces=plus.wipers[0].id;assert.equal(M.compile(plus).reps[0].wiper.accepted,2);
 const reviewed=await undatedReviewTest(undated);
 const legacyMixed=fullBundle();legacyMixed.scope='mixed';const beforeReview=JSON.stringify(legacyMixed);
 const reorderedReview=await undatedReviewTest(legacyMixed,[undated.wipers[0],undated.opportunity]);assert.equal(reorderedReview.wipers.length,1);assert.equal(M.compile(reorderedReview).reps[0].wiper.accepted,1);assert.equal(JSON.stringify(legacyMixed),beforeReview);
 const u=harness();u.context.undated=reviewed;
 assert.equal(await u.run('commitMonthlyBundle(undated)'),true,JSON.stringify(u.errors));
 assert.equal(u.run('state.data.retail.sv2.length'),2);assert.equal(u.run('state.data.referral.sv2.length'),3);
 assert.equal(u.run('state.data.retail.monthlySummary.period'),null);assert.equal(u.run('state.data.retail.monthlySummary.importedAt'),reviewed.importedAt);
 assert.equal(u.run("state.data.retail.sv2.some(r=>r._date||r._monthlyPeriod)"),false);
 assert.match(u.run("monthlyReportCoverage({criteria:[{source:'retail_sv2'}]})"),/Non-dated.*Loaded/);
 assert.match(u.run("el('monthlyImportSummary').textContent"),/Non-dated/);
 const ur=harness(u.db,u.storage);await ur.run('loadImportedDataFromIndexedDB({deferRender:true})');assert.equal(ur.run('state.data.retail.monthlySummary.importedAt'),reviewed.importedAt);assert.equal(ur.run('state.data.referral.sv2.length'),3);
 const allReferral=M.clone(reviewed);allReferral.coachAreas['high coach']='referral';allReferral.coachAreas['edge coach']='referral';allReferral.importedAt='2026-10-01T10:00:00.000Z';u.context.allReferral=allReferral;
 assert.equal(await u.run('commitMonthlyBundle(allReferral)'),true,JSON.stringify(u.errors));assert.equal(u.run('state.data.retail.sv2.length'),0);assert.equal(u.run('state.data.referral.sv2.length'),5);
 // A fresh undated Opportunity export resets prior Wipers/manual overrides and archives by load time.
 const nextSource=M.clone(reviewed.opportunity.aoa);nextSource[3][1]='New Rep';const fresh=M.add(allReferral,M.source(nextSource,'next.csv')).bundle;fresh.partialAcknowledged=true;fresh.importedAt='2026-10-02T10:00:00.000Z';assert.equal(fresh.wipers.length,0);assert.deepEqual(fresh.coachAreas,{});
 u.context.fresh=fresh;assert.equal(await u.run('commitMonthlyBundle(fresh)'),true);assert.ok(u.run('Object.keys(state.data.referral.monthlyHistory).some(k=>k.startsWith("loaded-2026-10-01"))'));
 // A shared mixed upload moving all coaches to one area clears the previous area's rows.
 ur.context.onlyReferral=M.toDataset(allReferral,'referral');ur.run("window.CoachToolsData={ready:async()=>{},getDatasetVersion:type=>type==='monthlyReferral'?{id:'single-area-mixed',version:2,classificationMethod:'reviewed-monthly-bundle',importedAt:'2099-01-01T00:00:00Z'}:null,getCurrent:async()=>({originalFileName:'mixed.csv',data:onlyReferral})};");
 assert.equal((await ur.run('syncAllStarFromCoachToolsData({render:false})')).changed,true,JSON.stringify(ur.errors));assert.equal(ur.run('state.data.retail.sv2.length'),0);assert.equal(ur.run('state.data.referral.sv2.length'),5);
 u.stop();ur.stop();
 console.log('PASS undated review/apply/reload/history, weighted cash threshold, exact 15%, overrides, missing counts and one-area transfers');
 await monthlyUploadFlowTest();
 const b=fullBundle(),out=M.compile(b);
 assert.equal(out.canApply,true);assert.equal(out.reps[0].wiper.accepted,20);assert.equal(out.reps[0].wiper.offered,50);assert.equal(out.reps[0].wiper.rate,.4);assert.equal(out.teams[0].segments.consumer.rate,.26);assert.equal(out.reps[1].wiper.rate,null);assert.equal(out.coverageComplete,true);
 const utf16=Buffer.concat([Buffer.from([255,254]),Buffer.from(b.opportunity.aoa.map(r=>r.join('\t')).join('\r\n'),'utf16le')]);
 assert.equal(M.source(M.delimited(M.decode(utf16)),'renamed.csv').rows.length,2);
 const be=Buffer.from(utf16);be.swap16();assert.equal(M.source(M.delimited(M.decode(be)),'be.csv').rows.length,2);
 assert.deepEqual(M.delimited('A,B\n"Last, First","line\nnext"'),[['A','B'],['Last, First','line\nnext']]);
 const reordered=M.clone(b.opportunity.aoa);for(const row of reordered)[row[3],row[7]]=[row[7],row[3]];assert.equal(M.source(reordered,'reordered.csv').rows[0].segments.commercial.opportunities.value,10);
 const changed=M.clone(b.opportunity.aoa);changed[2][3]='New metric';assert.equal(M.source(changed,'changed.csv').mappingRequired,true);
 console.log('PASS BOM/TSV/CSV, segmented headers, changed-layout mapping, raw counts and weighted teams');
 const duplicate=M.add(b,{...M.clone(b.wipers[0]),name:'different (2).csv'});assert.equal(duplicate.duplicate,true);assert.equal(M.compile(duplicate.bundle).reps[0].wiper.accepted,20);
 let replaced=M.clone(b);const correction=include(wiper('9/6/2026',[['Rep One',2,10],['Rep Two',0,0]],'corrected.csv'),'2026-08-30','2026-09-05');replaced=M.add(replaced,correction).bundle;assert.ok(M.compile(replaced).issues.some(i=>i.code==='duplicate-bucket'));
 replaced.wipers.at(-1).replaces=b.wipers[0].id;assert.equal(M.compile(replaced).reps[0].wiper.accepted,18);replaced.wipers=replaced.wipers.filter(f=>f.id!==correction.id);assert.equal(M.compile(replaced).reps[0].wiper.accepted,20);
 const removed=M.clone(b);removed.wipers.pop();assert.equal(M.compile(removed).reps[0].wiper.accepted,15);assert.equal(M.compile(removed).coverageComplete,false);
 console.log('PASS renamed duplicate, correction replacement, removal and coverage recalculation');
 let ambiguous=M.add(M.create('mixed'),opportunity([['Coach Alpha','Shared Name',10,8],['Coach Beta','Shared Name',90,18]])).bundle;
 ambiguous.coachAreas={'coach alpha':'retail','coach beta':'referral'};ambiguous=M.add(ambiguous,include(wiper('9/27/2026',[['shared name',3,10],['Unknown Rep',2,3],['',1,2],['Shared Name','*','*']]),'2026-09-20','2026-09-26')).bundle;
 const ambOut=M.compile(ambiguous);assert.equal(ambOut.reps.length,2);assert.equal(ambOut.matched,0);assert.ok(ambOut.issues.some(i=>i.code==='ambiguous-name'));assert.ok(ambOut.issues.some(i=>i.code==='unmatched-name'));assert.ok(ambOut.issues.some(i=>i.code==='blank-wiper-name'));
 const conflict=ambOut.issues.find(i=>i.code==='ambiguous-name');ambiguous.allocations[conflict.contributionId]={repId:ambOut.reps[1].id,reason:'Different people; verified recipient for this week.'};ambiguous.partialAcknowledged=true;
 const assigned=M.compile(ambiguous);assert.equal(assigned.reps[0].wiper.accepted,null);assert.equal(assigned.reps[1].wiper.accepted,3);assert.equal(assigned.teams[0].wiper.accepted,null);assert.equal(assigned.teams[1].wiper.accepted,3);
 assert.equal(M.toDataset(ambiguous,'retail').meta.totalRows,1);assert.equal(M.toDataset(ambiguous,'referral').meta.totalRows,1);
 console.log('PASS duplicate names retain distinct rosters; explicit allocation credits exactly one area');
 const bad=M.clone(b);bad.wipers[0].assignments={};assert.equal(M.compile(bad).canApply,false);bad.wipers[0].assignments[b.wipers[0].rows[0].reportDate]={start:'2026-08-29',end:'2026-09-05',meaning:'week-label',note:'Outside range'};assert.ok(M.compile(bad).issues.some(i=>i.code==='period-boundary'));
 const empty=M.create();assert.equal(M.compile(M.add(empty,b.wipers[0]).bundle).reps.length,0);
 assert.equal(M.cell('').status,'missing');assert.equal(M.cell('*').status,'suppressed');assert.equal(M.cell('N/A').status,'not-applicable');assert.equal(M.cell('-1').status,'invalid');assert.equal(M.cell('0').value,0);
 const missing=M.clone(b);missing.opportunity.rows[0].segments.consumer.opportunities=M.cell('');assert.equal(M.compile(missing).reps[0].segments.consumer.appointments,null);assert.equal(M.compile(missing).teams[0].segments.consumer.status,'partial');
 const invalid=M.clone(b);invalid.wipers[0].rows[0].accepted=M.cell(100);assert.ok(M.compile(invalid).issues.some(i=>i.code==='invalid-wiper'));
 const next=M.add(b,opportunity([['New Coach','Rep One',1,1]],'Fiscal LM (2026-09-27 – 2026-10-24)')).bundle;assert.equal(next.wipers.length,0);assert.equal(M.compile(next).reps[0].coach,'New Coach');
 console.log('PASS explicit period meaning, no prorating, missing/suppressed/invalid values, month isolation');
 const h=harness();h.context.bundle=b;
 h.run("state.data.qa.rows=[{_rep:'Unrelated QA',_score:91}];state.data.documented_coaching.rows=[{_rep:'Unrelated Coaching'}];state.models[0].name='Custom saved model';");
 assert.equal(await h.run('commitMonthlyBundle(bundle)'),true,JSON.stringify(h.errors));
 assert.equal(h.run('state.data.retail.sv2.length'),2);assert.equal(h.run('state.data.retail.controlRoster.length'),2);assert.equal(h.run("teamTotalsRowForTeam(state.data.retail.teamTotals,'Coach Alpha')['Consumer Appointment Rate']"),26);
 assert.equal(h.run("state.data.retail.controlRoster.some(r=>r._date||r['Hire Date'])"),false);
 assert.equal(h.run('state.data.qa.rows[0]._score'),91);assert.equal(h.run('state.models[0].name'),'Custom saved model');
 h.run('applyModelSourceSettings(state.models[0]);');assert.equal(h.run('state.data.retail.wiper[0].Accepted'),20);
 const reload=harness(h.db,h.storage);assert.equal(await reload.run('loadImportedDataFromIndexedDB({deferRender:true})'),true,JSON.stringify(reload.errors));assert.equal(reload.run('state.data.retail.wiper[0].Accepted'),20);assert.equal(reload.run('state.data.retail.monthlyBundle.wipers.length'),4);
 // Real transaction verification failure: the committed monthly data must survive.
 h.run("const realReq=idbReq;idbReq=(req,label)=>realReq(req,label).then(r=>label==='Verifying retail_wiper'?{...r,value:{rows:[]}}:r);");h.context.modified=M.clone(b);h.context.modified.wipers.pop();h.context.modified.partialAcknowledged=true;
 assert.equal(await h.run('commitMonthlyBundle(modified,{silent:true})'),false);assert.equal(h.run('state.data.retail.wiper[0].Accepted'),20);h.run('idbReq=realReq;');
 const retained=harness(h.db,h.storage);await retained.run('loadImportedDataFromIndexedDB({deferRender:true})');assert.equal(retained.run('state.data.retail.wiper[0].Accepted'),20);
 console.log('PASS All-Star commit, preserved QA/coaching/custom models, reload parity, failed-save rollback');
 const mixed=harness();mixed.context.bundle=ambiguous;assert.equal(await mixed.run('commitMonthlyBundle(bundle)'),true,JSON.stringify(mixed.errors));
 mixed.run('ensureRosterIndex();const opts={_entryRowsCache:new Map()};const entries=allRepEntries(state.models[0],["Coach Alpha","Coach Beta"]);');
 assert.equal(mixed.run("rowsForEntry('retail_sv2',entries[0],opts).length"),1);assert.equal(mixed.run("rowsForEntry('referral_sv2',entries[1],opts).length"),1);assert.equal(mixed.run("rowsForEntry('retail_sv2',entries[1],opts).length"),0);
 assert.equal(mixed.run("Number.isNaN(sumColumn('retail_wiper','Accepted',entries[0],{}))"),true);
 // Categorized default model sources preserve per-roster identity too.
 assert.equal(await mixed.run("categorizeImportedData({manual:true,triggerEvent:{type:'click',isTrusted:true,currentTarget:els.categorizeDataBtn},silent:true})"),true,JSON.stringify(mixed.errors));
 assert.equal(mixed.run("state.categorized.nondated.rows.filter(r=>r._rep==='Shared Name').length"),2);
 assert.equal(mixed.run("rowsForEntry('nondate',entries[0],{_entryRowsCache:new Map()})[0].Coach"),'Coach Alpha');
 console.log('PASS mixed-area atomic adapter, duplicate-name cached calculations and categorized sources');
 h.context.bundle=next;h.context.bundle.partialAcknowledged=true;assert.equal(await h.run('commitMonthlyBundle(bundle)'),true);assert.equal(h.run('Object.keys(state.data.retail.monthlyHistory).length'),1);assert.equal(h.run('state.data.retail.monthlyHistory["2026-08-30_2026-09-26"].opportunity.rows[0].coach'),'Coach Alpha');
 const central=harness();central.context.dataset=M.toDataset(b,'retail');central.run("window.CoachToolsData={ready:async()=>{},getDatasetVersion:type=>type==='monthlyRetail'?{id:'monthly-shared',version:1}:null,getCurrent:async()=>({originalFileName:'master.csv',data:dataset})};");
 assert.equal((await central.run('syncAllStarFromCoachToolsData({render:false})')).changed,true);assert.equal(central.run('state.data.retail.wiper[0].Accepted'),20);
 console.log('PASS historical team assignments and central sync normalization');
 const low=harness();low.context.lowBundle=M.add(M.create('retail'),opportunity([['Low Coach','Low Rep',1000,5]])).bundle;low.context.lowBundle.partialAcknowledged=true;await low.run('commitMonthlyBundle(lowBundle)');
 assert.equal(low.run("trueTeamCriterionValue({format:'pct',trueValueSource:'retail_team_totals',trueValueColumn:'Consumer Appointment Rate'}, {kind:'team',name:'Low Coach'}, {})"),.5);
 const transfer=M.clone(ambiguous);transfer.allocations[conflict.contributionId]={repId:ambOut.reps[0].id,reason:'Verified corrected transfer allocation'};
 mixed.context.retailDataset=M.toDataset(transfer,'retail');mixed.context.referralDataset=M.toDataset(transfer,'referral');
 mixed.run("window.CoachToolsData={ready:async()=>{},getDatasetVersion:type=>['monthlyRetail','monthlyReferral'].includes(type)?{id:type+'-updated',version:2,classificationMethod:'reviewed-monthly-bundle',importedAt:'2099-01-01T00:00:00Z'}:null,getCurrent:async type=>({originalFileName:'master.csv',data:type==='monthlyRetail'?retailDataset:referralDataset})};");
 const moved=await mixed.run('syncAllStarFromCoachToolsData({render:false})');assert.equal(moved.changed,true,JSON.stringify({moved,errors:mixed.errors}));
 assert.equal(mixed.run('state.data.retail.wiper[0].Accepted'),3);assert.equal(mixed.run('state.data.referral.wiper[0].Accepted'),null);
 mixed.run("window.CoachToolsData.getDatasetVersion=type=>['monthlyRetail','monthlyReferral'].includes(type)?{id:type+'-half-written',version:3,classificationMethod:'reviewed-monthly-bundle',importedAt:'2099-02-01T00:00:00Z'}:null;");mixed.context.retailDataset=M.toDataset(ambiguous,'retail');
 assert.equal((await mixed.run('syncAllStarFromCoachToolsData({render:false})')).retainedPreviousState,true);
 assert.equal(mixed.run('state.data.retail.wiper[0].Accepted'),3);assert.equal(mixed.run('state.data.referral.wiper[0].Accepted'),null);
 low.stop();
 console.log('PASS sub-one-percent rates, new shared monthly updates, transfers and half-saved shared bundle rollback');
 for(const x of [h,reload,retained,mixed,central])x.stop();
 await categoryIsolationTest();
 await optionalManagerIntakeTest();
 await referralWipersOnlyTest();
})().catch(e=>{console.error(e);process.exitCode=1;});
