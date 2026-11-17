#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {parseHTML}=require('linkedom');
const insights=require('../qualtrics/insights.js'),email=require('../qualtrics/executive-email.js');
const html=fs.readFileSync(path.join(__dirname,'../qualtrics/generator.html'),'utf8');
function sourceFunction(name){
  const match=new RegExp(`^(?:async )?function ${name}\\(`,'m').exec(html);
  assert.ok(match,`Production function ${name} must exist`);
  const rest=html.slice(match.index),next=/\r?\n(?=(?:async )?function |(?:const|let|var) )/.exec(rest);
  return next?rest.slice(0,next.index):rest;
}
const {document}=parseHTML(html),els=Object.fromEntries([...document.querySelectorAll('[id]')].map(element=>[element.id,element]));
const saved=new Map(),localStorage={getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,String(value))};
const day=(month,date,hour=0)=>new Date(2026,month-1,date,hour);
const descriptionRule={id:'assumptive',title:'Assumptive language',coaching:{mode:'descriptionContains',descriptionPhrases:['assumptive language']}};
const typeRule={id:'sales',title:'Sales process',coaching:{mode:'type',typeValue:'Sales'}};
const state={history:[],rules:[descriptionRule,typeRule],coachingRows:[],indexes:{coachingByRep:new Map()},identityAliases:new Map(),teamMap:new Map(),fullNameByKey:new Map(),masterFileNames:{},coachingDiagnostics:{},
  // A current report may exclude every history representative. It is not the
  // source population for this separate edition.
  report:{flagged:[{repKey:'current-only',repName:'Current Only',ruleId:'assumptive',coach:'Current Report Coach'}],audience:{coaches:['Current Report Coach']},weeklyStatsFilter:{enabled:true,weeks:1},hireDateFilter:{filterEnabled:true,startDate:'2026-11-01',endDate:'2026-11-17'}}};
const context=vm.createContext({Date,Map,Set,console,state,els,document,localStorage,QualtricsInsights:insights,QualtricsExecutiveEmail:email,canonicalCoachName:value=>value,canonicalTeamName:value=>value});
for(const name of ['ymd','parseDate','norm','repKey','headerKey','splitListInput','cleanTextForSearch','phraseListFromRule','typeListFromRule','splitCoachingTypes','textMatch','coachingTopicMatches','coachingMatchInfo','rowsForRep','executiveHistorySettings','loadExecutiveHistorySettings','saveExecutiveHistorySettings','invalidateExecutiveHistoryPreview','buildExecutiveHistoryReview','executiveHistoryPieImage','makeExecutiveHistoryEmail','makeEml'])vm.runInContext(sourceFunction(name),context);
if(/^function executiveHistoryCoachingAvailable\(/m.test(html))vm.runInContext(sourceFunction('executiveHistoryCoachingAvailable'),context);
els.reportDate.value='2026-11-17';els.executiveHistoryMonths.value='3';els.executiveHistoryAppearances.value='2';els.executiveHistoryCoachings.value='2';els.executiveHistoryInclude.checked=true;
function appearances(repKey,repName,ruleId,coach){
  return [[8,17],[9,17],[11,17]].map(([month,date],index)=>Object.freeze({repKey,repName,ruleId,coach,team:coach,reportDate:`2026-${String(month).padStart(2,'0')}-${date}`,runId:`report-${index}`}));
}
state.history=Object.freeze([
  ...appearances('alex one','Alex One','assumptive','Former Coach'),
  ...appearances('alex one','Alex One','sales','Former Coach'),
  ...appearances('stable:blair','Blair Two','assumptive','Former Coach'),
  ...appearances('casey three','Casey Three','assumptive','Historical Coach')
]);
state.identityAliases.set('alex one',{key:'stable:alex',name:'Alex Full Name'});
state.identityAliases.set('blair two',{key:'stable:different-person',name:'Different Blair'});
state.identityAliases.set('three',{key:'stable:wrong-casey',name:'Different Casey'});
state.identityAliases.set('c three',{key:'stable:wrong-casey',name:'Different Casey'});
state.teamMap.set('stable:alex',{name:'Alex Roster Name',coach:'Roster Coach',team:'Roster Team'});
state.teamMap.set('stable:blair',{name:'Blair Roster Name',coach:'Roster Coach',team:'Roster Team'});
const coaching=(id,date,extra={})=>({id,date,repKey:'stable:alex',type:'Other',desc:'Reviewed assumptive language',...extra});
const alexCoachings=[coaching('matching-description',day(9,20,12)),coaching('wrong-field',day(10,1),{type:'assumptive language',desc:'Unrelated topic',raw:{Other:'assumptive language'}}),coaching('sales-type',day(11,17,23),{type:'Sales',desc:'Unrelated topic'}),coaching('too-old',day(8,16)),coaching('future',day(11,18))];
state.indexes.coachingByRep.set('stable:alex',alexCoachings);
state.indexes.coachingByRep.set('stable:different-person',[coaching('wrong-identity',day(9,20),{repKey:'stable:different-person'})]);
state.coachingRows=alexCoachings;
const historyBefore=JSON.stringify(state.history),reportBefore=JSON.stringify(state.report),settingsBefore=JSON.stringify([...saved]);
let result=context.buildExecutiveHistoryReview();
assert.equal(result.coachingAvailable,true);assert.equal(result.eligibleRecords.length,4);assert.equal(result.summary.concernRepCount,3);assert.equal(result.summary.coachedRepCount,1);assert.equal(result.summary.coachingContactCount,2);assert.equal(result.summary.appearanceCount,12);
assert.deepEqual(result.coaches.map(coach=>[coach.coach,coach.concernRepCount]),[['Roster Coach',2],['Historical Coach',1]],'ranking uses history concern reps assigned to their current roster coach');
const alex=result.eligibleRecords.find(record=>record.repKey==='stable:alex'&&record.ruleId==='assumptive');
assert.equal(alex.repName,'Alex Roster Name');assert.equal(alex.coach,'Roster Coach');assert.equal(alex.team,'Roster Team');assert.equal(alex.coachingCount,1,'only the description field may satisfy description phrases; old and future coaching are excluded');
assert.equal(result.eligibleRecords.find(record=>record.repKey==='stable:alex'&&record.ruleId==='sales').coachingCount,1,'type rules and late report-day coaching use the real matcher and indexed rows');
assert.equal(result.eligibleRecords.find(record=>record.repKey==='stable:blair').coachingCount,0,'an existing stable identity is preserved when a name alias points elsewhere');
assert.ok(result.eligibleRecords.some(record=>record.repKey==='casey three'),'surname and first-initial aliases do not replace an unmatched full-name history identity');
assert.ok(!result.eligibleRecords.some(record=>record.repKey==='current-only'),'current report findings cannot create history cohort members');
assert.equal(result.summary.avgCoachingsPerWeek,2/result.window.weeks);assert.equal(result.summary.coachingsPerAppearance,2/12);
assert.deepEqual(result.summary.coachedTopicShares.map(topic=>[topic.ruleId,topic.count,topic.share]),[['assumptive',1,.5],['sales',1,.5]]);
assert.equal(JSON.stringify(state.history),historyBefore);assert.equal(JSON.stringify(state.report),reportBefore);assert.equal(JSON.stringify([...saved]),settingsBefore,'reviewing never records history or changes settings');

// A missing source means unknown coverage. A recognized, valid header-only
// workbook establishes a known zero; failed/unrecognized imports do not.
const originalRows=state.coachingRows,originalIndex=state.indexes.coachingByRep;
state.coachingRows=[];state.indexes.coachingByRep=new Map();
result=context.buildExecutiveHistoryReview();assert.equal(result.coachingAvailable,false);assert.equal(result.summary.coachedRepCount,null);assert.equal(result.summary.concernRepCount,0);assert.ok(result.eligibleRecords.every(record=>record.undercoached===null));
state.masterFileNames.coaching='Empty Documented Coaching.xlsx';
state.coachingDiagnostics={received:0,headers:['Associate Name','Coaching Date','Description']};
result=context.buildExecutiveHistoryReview();assert.equal(result.coachingAvailable,true);assert.equal(result.summary.coachedRepCount,0);assert.equal(result.summary.coachingContactCount,0);assert.equal(result.summary.concernRepCount,3);
state.coachingDiagnostics={received:1,headers:['Associate Name','Coaching Date','Description']};assert.equal(context.buildExecutiveHistoryReview().coachingAvailable,false,'a nonempty source with no parsed coaching is unknown');
state.coachingDiagnostics={received:0,headers:['Unrelated column']};assert.equal(context.buildExecutiveHistoryReview().coachingAvailable,false,'irrelevant headers do not establish a recognized empty coaching source');
state.coachingRows=originalRows;state.indexes.coachingByRep=originalIndex;state.masterFileNames={};state.coachingDiagnostics={};
const detailedHistory=state.history;state.history=[];state.concernHistoryLoad={names:[{name:'Alex One',count:20}]};
result=context.buildExecutiveHistoryReview();assert.equal(result.eligibleRecords.length,0);assert.ok(result.diagnostics.warnings.some(warning=>/name counts only/i.test(warning)),'undated name totals cannot establish topic history');
state.history=detailedHistory;

// Settings survive reopening, normalize invalid values and invalidate a stale
// preview without modifying saved history.
els.executiveHistoryMonths.value='4.9';els.executiveHistoryAppearances.value='-8';els.executiveHistoryCoachings.value='0';els.executiveHistoryInclude.checked=false;els.executiveHistoryPreview.innerHTML='Old output';els.executiveHistoryPreview.classList.remove('hidden');
context.saveExecutiveHistorySettings();
const persisted=JSON.parse([...saved.values()].find(value=>value.includes('minAppearances')));
assert.deepEqual(persisted,{months:4,minAppearances:0,minCoachings:1,include:false});assert.equal(els.executiveHistoryPreview.innerHTML,'');assert.ok(els.executiveHistoryPreview.classList.contains('hidden'));
els.executiveHistoryMonths.value='1';els.executiveHistoryAppearances.value='99';els.executiveHistoryCoachings.value='99';els.executiveHistoryInclude.checked=true;context.loadExecutiveHistorySettings();
assert.deepEqual(JSON.parse(JSON.stringify(context.executiveHistorySettings())),persisted);
els.executiveHistoryMonths.value='3';els.executiveHistoryAppearances.value='2';els.executiveHistoryCoachings.value='2';els.executiveHistoryInclude.checked=true;

// Exercise the production canvas bridge and MIME generator together. The email
// includes local PNGs as inline MIME parts, with no filesystem chart paths.
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6oAAAAABJRU5ErkJggg==';
let arcs=0;
context.document={createElement(tag){assert.equal(tag,'canvas');return {getContext(){return {fillRect(){},beginPath(){},moveTo(){},arc(){arcs++;},closePath(){},fill(){},stroke(){}};},toDataURL(type){assert.equal(type,'image/png');return 'data:image/png;base64,'+png;}};}};
let edition=context.makeExecutiveHistoryEmail();assert.ok(arcs>0);assert.ok(edition.html.includes('data:image/png;base64,'+png));
const eml=context.makeEml('Executive review\r\nInjected: invalid',edition.html);
assert.ok(!eml.includes('\r\nInjected:'));assert.ok(!eml.includes('data:image/png'));assert.ok(!eml.includes('file://'));
function mimeParts(message,boundary){return message.split(new RegExp('(?:^|\\r\\n)--'+boundary.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:--)?(?:\\r\\n|$)'));}
const outer=/Content-Type: multipart\/alternative; boundary="([^"]+)"/.exec(eml)[1],parts=mimeParts(eml,outer);
assert.ok(parts.some(part=>part.includes('Content-Type: text/plain')));const relatedPart=parts.find(part=>part.includes('Content-Type: multipart/related'));
assert.ok(relatedPart);const inner=/multipart\/related; boundary="([^"]+)"/.exec(relatedPart)[1],relatedParts=mimeParts(relatedPart,inner);
const htmlPart=relatedParts.find(part=>part.includes('Content-Type: text/html')),imageParts=relatedParts.filter(part=>part.includes('Content-Type: image/png'));
const cids=[...htmlPart.matchAll(/src="cid:([^"]+)"/g)].map(match=>match[1]);assert.equal(imageParts.length,cids.length);assert.ok(cids.length>=2,'each coach concern chart is embedded');
for(const [index,part] of imageParts.entries()){
  assert.ok(part.includes('Content-ID: <'+cids[index]+'>'));assert.ok(part.includes('Content-Disposition: inline;'));assert.ok(part.includes('Content-Transfer-Encoding: base64'));
  const encoded=part.split('\r\n\r\n')[1].trim().replace(/\s+/g,'');assert.deepEqual(Buffer.from(encoded,'base64'),Buffer.from(png,'base64'));
}
context.document={createElement(){return {getContext(){return null;}};}};
edition=context.makeExecutiveHistoryEmail();assert.ok(!edition.html.includes('<img '));assert.ok(edition.html.includes('Missing coaching opportunities'));assert.ok(edition.html.includes('Assumptive language'),'the complete topic legend survives unavailable drawing');
const noChart=context.makeEml('Executive review',edition.html);assert.ok(!noChart.includes('multipart/related'));assert.ok(!noChart.includes('Content-Type: image/png'));assert.ok(!noChart.includes('src="cid:'));assert.ok(noChart.includes('Content-Type: text/html'));assert.ok(noChart.includes('Content-Type: text/plain'));
assert.equal(JSON.stringify(state.history),historyBefore);
console.log('PASS executive history workflow: real history/coaching adapters, exact identity and roster, availability, persisted thresholds, inline PNG MIME, and chart fallback');
