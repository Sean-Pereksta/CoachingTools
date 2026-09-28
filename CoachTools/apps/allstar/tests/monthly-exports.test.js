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
 let b=M.add(M.create('retail'),opportunity([['Coach Alpha','Rep One',10,8],['Coach Alpha','Rep Two',90,18]])).bundle;
 const weeks=[['9/6/2026','2026-08-30','2026-09-05',4,10],['9/13/2026','2026-09-06','2026-09-12',6,20],['9/20/2026','2026-09-13','2026-09-19',5,10],['9/27/2026','2026-09-20','2026-09-26',5,10]];
 for(const [date,start,end,a,o] of weeks)b=M.add(b,include(wiper(date,[['  REP  ONE ',a,o],['Rep Two',0,0]],`week-${date.replaceAll('/','-')}.csv`),start,end)).bundle;
 b.consumerAsCash=true;return b;
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
(async()=>{
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
})().catch(e=>{console.error(e);process.exitCode=1;});
