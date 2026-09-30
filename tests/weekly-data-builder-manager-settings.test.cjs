'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const base=path.join(__dirname,'..');
const moduleText=fs.readFileSync(path.join(base,'CoachTools/shared/coachtools-stats-directory.js'),'utf8');
const htmlPath=path.join(base,'CoachTools/apps/weekly-data-builder.html');
const html=fs.existsSync(htmlPath)?fs.readFileSync(htmlPath,'utf8'):null;
const plain=x=>JSON.parse(JSON.stringify(x));
async function setup(store=new Map()){
 const ctx=vm.createContext({console,TextDecoder,TextEncoder,URL,Intl,setTimeout,clearTimeout,localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)}});
 vm.runInContext(moduleText,ctx);const D=ctx.CoachToolsStatsDirectory;await D.ready;
 if(html)vm.runInContext(fs.readFileSync(path.join(base,'CoachTools/shared/weekly-data-builder-core.js'),'utf8'),ctx);
 return {D,C:ctx.WeeklyCore,ctx,store};
}
function opportunity(details=[['Manager One','Coach A','Alex Reed','Fiscal LW (2026-09-20 – 2026-09-26)','2','1','50%','10','6','60%','20','19','95%']]){
 return [
 ['','','','','OPPORTUNITY_LATEST_SEGMENT','OPPORTUNITY_LATEST_SEGMENT','OPPORTUNITY_LATEST_SEGMENT','OPPORTUNITY_LATEST_SEGMENT','OPPORTUNITY_LATEST_SEGMENT','OPPORTUNITY_LATEST_SEGMENT','OPPORTUNITY_LATEST_SEGMENT','OPPORTUNITY_LATEST_SEGMENT','OPPORTUNITY_LATEST_SEGMENT'],
 ['','','','','COMMERCIAL','COMMERCIAL','COMMERCIAL','CONSUMER','CONSUMER','CONSUMER','INSURANCE','INSURANCE','INSURANCE'],
 ['','','','','Opportunities','Appointments','Appt Rate','Opportunities','Appointments','Appt Rate','Opportunities','Appointments','Appt Rate'],
 ['Grand Total','Total','Total','Total','999','999','100%','999','999','100%','999','999','100%'],
 ['Manager One','Total','Total','Total','999','999','100%','999','999','100%','999','999','100%'],
 ['Manager One','Coach A','Total','Total','999','999','100%','999','999','100%','999','999','100%'],...details];
}
function wipers(details=[['9/27/2026','Coach A','Alex Reed','3','8']]){
 return [['REPORT DATE','EMPLOYEE_IMMEDIATE_SUPERVISOR_NAME','EMPLOYEE_FULL_NAME','COUNT_WIPERS_ACCEPTED','COUNT_WIPERS_OFFERED'],['Grand Total','Total','Total','99','199'],['9/27/2026','Total','Total','99','199'],['9/27/2026','Coach A','Total','99','199'],...details];
}
const weeklyHeader=['Date','Sheet','Name','Consumer Opportunities','Consumer Appointments','Consumer Appointment Rate','Wiper Count','Wiper Jobs','Manager','ACD Calls'];
function input(extra={}){return {appointmentRows:opportunity(),wiperRows:wipers(),weeklyRows:[weeklyHeader,['9/13/2026','Prior Coach','Prior Rep','23','10','0.43','2','6','Prior Manager','55']],date:'2026-09-27',options:{},...extra};}

test('explicit aliases normalize case, spacing, Last First and chains but not unrelated names',async()=>{
 const {D}=await setup();await D.save({version:1,links:[],aliases:[{role:'name',from:'Reed, Alex',to:'Alex Rowan'},{role:'name',from:'Alex Rowan',to:'Alexander Rowan'},{role:'coach',from:'Coach A',to:'Coach Alpha'}]});
 assert.equal(D.resolve('  ALEX   REED ','name'),'Alexander Rowan');assert.equal(D.resolve('Alex Reed','coach'),'Alex Reed');assert.equal(D.resolve('Alex Reeds','name'),'Alex Reeds');
});
test('reject empty names, totals, formula names, duplicate rules and cycles before saving',async()=>{
 const {D}=await setup();for(const aliases of [[{role:'name',from:'',to:'A'}],[{role:'name',from:'Total',to:'A'}],[{role:'name',from:'A',to:'=B'}],[{role:'name',from:'A',to:'B'},{role:'name',from:'a',to:'C'}],[{role:'coach',from:'A',to:'B'},{role:'coach',from:'B',to:'A'}]])assert.throws(()=>D.validate({version:1,links:[],aliases}));
});
test('saved settings persist when the workspace reopens and disabled/deleted rules stop applying',async()=>{
 const {D,store}=await setup();await D.save({version:1,links:[{coach:'Coach A',manager:'Manager One'}],aliases:[{role:'name',from:'A',to:'B'}]});
 const reopened=(await setup(store)).D;assert.equal(reopened.resolve('A','name'),'B');assert.equal(reopened.managerFor('Coach A'),'Manager One');
 const s=reopened.snapshot();s.aliases[0].enabled=false;await reopened.save(s);assert.equal(reopened.resolve('A','name'),'A');s.aliases=[];await reopened.save(s);assert.equal(reopened.snapshot().aliases.length,0);
});
test('manager discovery skips totals, holds conflicts, merges updates and reassigns one coach',async()=>{
 const {D}=await setup();const a={headerRow:2,dims:{manager:0,coach:1,name:2,date:3}};
 const found=D.discover(opportunity(),a);assert.deepEqual(plain(found.links),[{coach:'Coach A',manager:'Manager One'}]);
 const conflicting=D.discover(opportunity([['Manager Two','Coach A','Rep B','Week']]),a);assert.equal(conflicting.links.length,0);assert.equal(conflicting.conflicts.length,1);
 await D.saveHierarchy(found.links);await D.saveHierarchy([{coach:'Coach B',manager:'Manager One'}]);await D.saveHierarchy([{coach:'Coach A',manager:'Manager Two'}]);assert.equal(D.managerFor('coach a'),'Manager Two');assert.equal(D.managerFor('Coach B'),'Manager One');
});
test('alias collisions cannot silently put one canonical coach under two managers',async()=>{
 const {D}=await setup();assert.throws(()=>D.validate({version:1,aliases:[{role:'coach',from:'Coach A',to:'Coach B'}],links:[{coach:'Coach A',manager:'Manager One'},{coach:'Coach B',manager:'Manager Two'}]}),/two managers/);
});
test('Clean Upload weekly dataset and scope use replacements without mutating input or other sources',async()=>{
 const {D}=await setup();await D.save({version:1,links:[],aliases:[{role:'name',from:'Alex Reed',to:'Alex Rowan'},{role:'coach',from:'Coach A',to:'Coach Alpha'},{role:'manager',from:'Manager One',to:'Manager First'}]});
 const parsed={meta:{fileName:'weekly.csv'},workbook:{sheets:['Data'],data:{Data:{aoa:[weeklyHeader,['9/27/2026','Coach A','Alex Reed','10','6','','0','8','Manager One']]}}}};
 const updated=D.applyDataset(parsed,'weeklyRetail');assert.equal(updated.workbook.data.Data.aoa[1][1],'Coach Alpha');assert.equal(updated.workbook.data.Data.aoa[1][2],'Alex Rowan');assert.equal(updated.workbook.data.Data.aoa[1][8],'Manager First');assert.equal(parsed.workbook.data.Data.aoa[1][2],'Alex Reed');assert.equal(updated.workbook.data.Data.aoa[1][6],'0');
 const scope={mode:'team',coaches:['Coach A'],coachKeys:['coach a'],sourceSelections:{weeklyRetail:['Coach A'],qa:['Coach A']}};
 const mapped=D.mapScope(scope,'weeklyRetail');assert.deepEqual(plain(mapped.coaches),['Coach Alpha']);assert.deepEqual(plain(mapped.sourceSelections.qa),['Coach A']);assert.equal(D.applyDataset(parsed,'monthlyRetail'),parsed);
});
test('no report statistics are included in persistent settings',async()=>{const{D,store}=await setup();await D.saveHierarchy([{coach:'Coach A',manager:'Manager One'}]);const saved=JSON.parse(store.get(D.KEY));assert.deepEqual(Object.keys(saved).sort(),['aliases','links','revision','version']);});

// Core regressions run against the actual patched HTML, not a reimplementation.
const coreTest=(name,fn)=>test(name,{skip:!html},fn);
coreTest('new four-column Opportunity hierarchy imports representatives, not subtotal rows',async()=>{const{C}=await setup();const a=C.analyze(opportunity(),'appointments');assert.deepEqual(plain(a.dims),{name:2,coach:1,manager:0,date:3});const records=C.sourceRecords(opportunity(),a);assert.equal(records.records.length,1);assert.equal(records.records[0].displayCoach,'Coach A');assert.equal(records.records[0].manager,'Manager One');assert.equal(records.skipped.length,3);});
coreTest('COUNT_WIPERS_OFFERED maps to offered, never accepted',async()=>{const{C}=await setup();const a=C.analyze(wipers(),'wipers');assert.equal(a.keys.get('wiper.accepted').index,3);assert.equal(a.keys.get('wiper.offered').index,4);const r=C.assemble(input());assert.equal(r.newRows[0][6],'3');assert.equal(r.newRows[0][7],'8');assert.equal(r.newRows.length,1);});
coreTest('multiple source dates require an explicit period and never silently blend weeks',async()=>{const{C}=await setup();const rows=wipers([['9/20/2026','Coach A','Alex Reed','1','2'],['9/27/2026','Coach A','Alex Reed','3','8']]);assert.throws(()=>C.assemble(input({wiperRows:rows})),/Choose one source period/);const r=C.assemble(input({wiperRows:rows,options:{wiperPeriod:'9/27/2026'}}));assert.equal(r.newRows[0][6],'3');assert.equal(r.newRows[0][7],'8');});
coreTest('Add preserves all historical cells/order and fills an existing Manager column',async()=>{const{C}=await setup();const i=input(),before=JSON.stringify(i.weeklyRows),r=C.assemble(i);assert.equal(JSON.stringify(i.weeklyRows),before);assert.deepEqual(plain(r.previousRows),i.weeklyRows);assert.deepEqual(plain(r.header),weeklyHeader);assert.equal(r.newRows[0][8],'Manager One');assert.equal(r.newRows[0][9],'');});
coreTest('legacy three-column unlabeled Opportunity and coachless Wipers remain supported',async()=>{const{C}=await setup();const appointments=[['','','','CONSUMER','CONSUMER'],['','','','Opportunities','Appointments'],['Coach A','Alex Reed','Week','10','6']];const w=[['Report Date','Employee Full Name','Wipers Accepted','Wipers Offered'],['Week','Alex Reed','3','8']];const r=C.assemble(input({appointmentRows:appointments,wiperRows:w}));assert.equal(r.newRows.length,1);assert.equal(r.newRows[0][2],'Alex Reed');assert.equal(r.newRows[0][7],'8');});
coreTest('wiper-only representative keeps their coach and saved manager',async()=>{const{C,D}=await setup();await D.saveHierarchy([{coach:'Coach B',manager:'Manager Two'}]);const r=C.assemble(input({wiperRows:wipers([['9/27/2026','Coach B','Wiper Only','0','4']])}));const row=r.newRows.find(r=>r[2]==='Wiper Only');assert.equal(row[1],'Coach B');assert.equal(row[6],'0');assert.equal(row[7],'4');assert.equal(row[8],'Manager Two');assert.equal(row[3],'');});
coreTest('aliases apply before joining sources; deleting rules restores raw names',async()=>{const{C,D}=await setup();await D.save({version:1,links:[],aliases:[{role:'name',from:'Old Name',to:'Alex Reed'},{role:'coach',from:'Legacy Coach',to:'Coach A'}]});const w=wipers([['9/27/2026','Legacy Coach','Old Name','5','12']]);const r=C.assemble(input({wiperRows:w}));assert.equal(r.newRows.length,1);assert.equal(r.newRows[0][6],'5');await D.save({version:1,links:[],aliases:[]});const r2=C.assemble(input({wiperRows:w}));assert.equal(r2.newRows.length,2);});
coreTest('Modify joins a saved name replacement to old history but changes only target-date source cells',async()=>{const{C,D}=await setup();await D.save({version:1,links:[],aliases:[{role:'name',from:'Old Name',to:'Alex Reed'}]});const historical=[weeklyHeader,['9/20/2026','Coach A','Old Name','7','4','','9','10','Manager One','33'],['9/27/2026','Coach A','Old Name','8','5','','2','6','Manager One','44']];const r=C.assemble(input({weeklyRows:historical,appointmentRows:[],options:{mode:'modify'}}));assert.deepEqual(plain(r.allRows[1]),historical[1]);assert.equal(r.allRows[2][2],'Old Name');assert.equal(r.allRows[2][3],'8');assert.equal(r.allRows[2][6],'3');assert.equal(r.allRows[2][7],'8');assert.equal(r.allRows[2][9],'44');});
coreTest('Modify duplicate representative names match Wipers by coach instead of first record',async()=>{const{C}=await setup();const h=[weeklyHeader,['9/27/2026','Coach A','Same Name','','','','0','0'],['9/27/2026','Coach B','Same Name','','','','0','0']];const w=wipers([['9/27/2026','Coach B','Same Name','7','14'],['9/27/2026','Coach A','Same Name','3','8']]);const r=C.assemble(input({appointmentRows:[],weeklyRows:h,wiperRows:w,options:{mode:'modify'}}));assert.equal(r.allRows[1][6],'3');assert.equal(r.allRows[2][6],'7');});
coreTest('ambiguous Modify same-name rows remain unchanged rather than receiving guessed statistics',async()=>{const{C}=await setup();const h=[weeklyHeader,['9/27/2026','Coach A','Same Name','','','','0','0'],['9/27/2026','Coach B','Same Name','','','','0','0']];const w=[['Report Date','Employee Full Name','Wipers Accepted','Wipers Offered'],['9/27/2026','Same Name','7','14']];const r=C.assemble(input({appointmentRows:[],weeklyRows:h,wiperRows:w,options:{mode:'modify'}}));assert.equal(r.stats.modifiedRows,0);assert.equal(r.allRows[1][6],'0');assert.equal(r.allRows[2][6],'0');assert.equal(r.review.filter(x=>x.kind==='ambiguous-modify').length,2);});
coreTest('all inline scripts and new support modules pass JavaScript syntax compilation',async()=>{for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);for(const f of ['coachtools-stats-directory.js','coachtools-stats-manager-picker.js','weekly-data-builder-settings.js','coachtools-import.js'])new vm.Script(fs.readFileSync(path.join(base,'CoachTools/shared',f),'utf8'));});
