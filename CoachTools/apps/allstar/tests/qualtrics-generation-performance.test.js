#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createHash}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {parseHTML}=require('linkedom');
const insights=require('../qualtrics/insights.js'),workflow=require('../qualtrics/workflow.js'),individualMessages=require('../qualtrics/individual-messages.js');
const generatorPath=path.join(__dirname,'../qualtrics/generator.html');
const baselineMode=process.argv.includes('--capture-baseline');
const html=baselineMode?execFileSync('git',['show','HEAD:CoachTools/apps/allstar/qualtrics/generator.html'],{cwd:__dirname,encoding:'utf8'}):fs.readFileSync(generatorPath,'utf8');
const script=html.match(/<script>\s*([\s\S]*?)<\/script>/)[1].replace(/init\(\)\.catch\([\s\S]*$/,'');
const stored=new Map(),downloads=[];
const fakeElement=()=>({value:'',checked:false,disabled:false,textContent:'',innerHTML:'',style:{},classList:{add(){},remove(){},toggle(){}},querySelectorAll:()=>[]});
const document=parseHTML('<!doctype html><html><body></body></html>').document;
document.getElementById=()=>fakeElement();
const context=vm.createContext({console,Date,Map,Set,performance,setTimeout,clearTimeout,URLSearchParams,location:{search:''},document,Blob,URL,QualtricsInsights:insights,QualtricsWorkflow:workflow,QualtricsIndividualMessages:individualMessages,localStorage:{getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value)},addEventListener(){}});
context.window=context;context.parent=context;
vm.runInContext(script,context,{filename:'generator-inline.js'});
vm.runInContext(`
  globalThis.api={state,els,makeEmailHtml,exportEmails,simpleQualtricsSixWeekMetric,assignedRepSetForCoach};
  for(const key of ['reportBody','reportDate','globalCoachLookback','historyWindowDays','historySortWeight','urgencyCoverageGreen','urgencyCoverageYellow','status','toast','progressWrap','progressBar','progressText','executiveHistoryInclude','exportMsgExtension']) els[key]=document.getElementById(key);
  els.reportDate.value='2026-11-17';els.globalCoachLookback.value='2';els.historyWindowDays.value='30';els.historySortWeight.value='4';els.urgencyCoverageGreen.value='80';els.urgencyCoverageYellow.value='50';
  state.rules=[
    normalizeRule({id:'cash',title:'Cash & Scheduling',ruleType:'statRule',statRule:{metric:'cashAppointmentRate',cashSourceMode:'consumerRatio',cashNumeratorHeader:'Appointments',cashDenominatorHeader:'Opportunities',goalRaw:'75%',lookbackWeeks:10,minimumMode:'percent',minPctRaw:'50%'},coaching:{mode:'type',typeValue:'Scheduling'}}),
    normalizeRule({id:'quality',title:'Quality <Assurance>',ruleType:'statRule',statRule:{metric:'callQuality',goalRaw:'90%',lookbackWeeks:10,minimumMode:'percent',minPctRaw:'50%'},coaching:{mode:'descriptionContains',descriptionPhrases:['quality']}}),
    normalizeRule({id:'wiper',title:'Wiper Attach',ruleType:'statRule',statRule:{metric:'wiperRate',goalRaw:'30%',lookbackWeeks:10,minimumMode:'percent',minPctRaw:'50%'},coaching:{mode:'type',typeValue:'Wipers'}})
  ];
  const flagged=[],reportDate=parseDate('2026-11-17');
  for(let coachIndex=0;coachIndex<6;coachIndex++){
    const coach='Coach '+String.fromCharCode(65+coachIndex)+' & Team';
    for(let personIndex=0;personIndex<16;personIndex++){
      const key='person-'+coachIndex+'-'+personIndex,name='Person '+coachIndex+' '+String(personIndex).padStart(2,'0');
      state.teamMap.set(key,{name,coach,team:coach});
      const weekly=[],qa=[],coachings=[];
      for(let week=0;week<12;week++){
        const date=addDays(reportDate,-7*(11-week));
        const raw={Appointments:((personIndex+week)%8),Opportunities:10,'Wiper Rate':((personIndex*3+week*2)%45)/100};
        weekly.push({key,repKey:key,name,rawName:name,coach,rawCoach:coach,date,raw});
        // Missing values, genuine zeros and a long enough series exercise the same N/A semantics.
        qa.push({key,repKey:key,name,rawName:name,coach,date,score:week===4?NaN:personIndex===0?0:(70+(personIndex+week)%28)/100,raw:{'Call Quality':week===4?'':(70+(personIndex+week)%28)/100}});
      }
      if(personIndex%3!==0)coachings.push({key,repKey:key,name,rawName:name,coach,date:addDays(reportDate,-personIndex%12),type:'Scheduling',typeParts:['Scheduling'],desc:'quality review and scheduling',searchText:'quality review and scheduling'});
      state.indexes.weeklyByRep.set(key,weekly);state.indexes.qaByRep.set(key,qa);state.indexes.coachingByRep.set(key,coachings);
      state.weeklyStatsRows.push(...weekly);state.qaRows.push(...qa);state.coachingRows.push(...coachings);
      if(personIndex===15)continue; // An eligible person without findings still belongs in the denominator.
      for(let ruleIndex=0;ruleIndex<state.rules.length;ruleIndex++){
        if((personIndex+ruleIndex)%4===0)continue;
        const rule=state.rules[ruleIndex],check=evaluateStatRuleForRep(key,rule.statRule,reportDate),score=25+(personIndex*7+ruleIndex*13)%75;
        flagged.push({repKey:key,repName:name,coach,team:coach,ruleId:rule.id,ruleTitle:rule.title,dataSource:rule.title,reportItemKey:'rule:'+rule.id,reportWeight:1,reportPriority:ruleIndex+1,category:rule.title,categories:[rule.title],dashboardValues:['Synthetic finding & evidence'],fileNames:new Set(['Synthetic <report>.csv']),rawRows:[],coached:coachMatch({repKey:key},rule,reportDate,2),checklist:{rows:[],count:0},statChecks:[check],directStatCheck:check,history:{dateCount:personIndex%4},concernHistory:{appearanceCount:personIndex%4,statusKey:'repeat',appearanceLabel:(personIndex%4)+'X'},concernScore:score,concern:score>=70?'High':score>=45?'Medium':'Lower',alarm:score>=70});
      }
    }
  }
  state.masterRows={qa:state.qaRows,weeklyStats:state.weeklyStatsRows,coaching:state.coachingRows,checklist:[]};
  const byCoach=new Map();for(const row of flagged){if(!byCoach.has(row.coach))byCoach.set(row.coach,[]);byCoach.get(row.coach).push(row);}
  state.report={runId:'synthetic-performance-fixture',reportDate:'2026-11-17',flagged,allFlagged:flagged,byCoach,byCoachAll:byCoach,followUpWatchlist:[],urgencyCatalog:state.rules.map((rule,index)=>({ruleId:rule.id,ruleTitle:rule.title,dataSource:rule.title,reportItemKey:'rule:'+rule.id,reportPriority:index+1,reportWeight:1,categories:[rule.title]})),teamPopulationByCoach:reportTeamPopulationForRows(flagged,reportDate),weeklyStatsFilter:{enabled:false,weeks:2}};
`,context);

function emailOutputs(){
  const {state}=context.api;
  return [context.makeEmailHtml('Executive Coaching Opportunity Review',state.report.flagged,true),...[...state.report.byCoach].map(([coach,rows])=>context.makeEmailHtml(coach+' Coaching Opportunity Review',rows,false))];
}
function hash(value){return createHash('sha256').update(value).digest('hex');}
const started=performance.now(),outputs=emailOutputs(),hashes=outputs.map(hash);
if(process.argv.includes('--benchmark')){
  const timings=[];
  context.renderReport();
  for(let run=0;run<7;run++){const begin=performance.now();context.renderReport();emailOutputs();timings.push(performance.now()-begin);}
  timings.sort((a,b)=>a-b);
  console.log(JSON.stringify({implementation:baselineMode?'baseline':'revised',stages:'preview markup + executive/coach email HTML',medianMs:Math.round(timings[3]),samplesMs:timings.map(value=>Math.round(value)),people:96,findings:204,emailFiles:7,emailHtmlBytes:outputs.reduce((sum,value)=>sum+Buffer.byteLength(value),0),previewHtmlBytes:Buffer.byteLength(context.api.els.reportBody.innerHTML)}));
  process.exit(0);
}
if(baselineMode){console.log(JSON.stringify({hashes,bytes:outputs.map(value=>Buffer.byteLength(value)),elapsedMs:Math.round(performance.now()-started)},null,2));process.exit(0);}
// Captured from the unchanged generator at e317d2162dfe3a0a67a05a107c37928a524e2075.
const expectedHashes=[
  'f562fb4a401206d86c1fda281a15e260c405029673811b0e9b4f709086d16c51',
  '1c3fb5f6fcc492d05159f3d8665763799d62341e2207705e6ba86562aa30533c',
  'a891410637588b3b04fbb0811c7cad5ca62f9daf937b098468ae529fa43a522f',
  'aa018430a38c5776fce6609370cf3660c66a58644da7aa6585be21a177d9f516',
  '40bd9683fd82651284998d518d01ea5ba140a8c63bbf2e551e8d7b8efae10fa6',
  '6426fa9a4f35ce250f55f663f1c87e0626d10e9b84d2965dea657bae37b13acf',
  'e76a21abf61fd64622d8a60d0154a7c39497b3605388a1062051d0d9671e4b6f'
];
assert.deepEqual(hashes,expectedHashes,'The executive and every coach email must remain byte-identical after performance changes.');
assert.match(outputs[0],/Quality &lt;Assurance&gt;/,'real report labels are escaped');
assert.match(outputs[0],/Coach A &amp; Team/);
assert.equal(context.api.state.report.flagged.length,204,'the fixture exercises multiple findings for the same people');

async function verifyResponsiveExport(){
  let heartbeat=0,heartbeatAtFirstFile=null,heartbeatAtPreviousFile=null,zipFiles=[];
  const timer=setInterval(()=>heartbeat++,1);
  context.JSZip=class{
    file(name,content){
      assert.match(content,/MIME-Version: 1.0/);
      if(heartbeatAtFirstFile===null)heartbeatAtFirstFile=heartbeat;
      if(heartbeatAtPreviousFile!==null)assert.ok(heartbeat>heartbeatAtPreviousFile,'The event loop must run between coach email files.');
      heartbeatAtPreviousFile=heartbeat;zipFiles.push(name);return this;
    }
    async generateAsync(){return new Blob(['synthetic zip']);}
  };
  context.recordDownload=(blob,name)=>downloads.push({blob,name});
  vm.runInContext('downloadBlob=recordDownload;',context);
  try{await context.exportEmails();}finally{clearInterval(timer);}
  assert.ok(heartbeatAtFirstFile>0,'The export must repaint its status before building the executive email.');
  assert.equal(zipFiles.length,7,'The executive and every coach still receive an email file.');
  assert.ok(zipFiles.every(name=>name.endsWith('.eml')));
  assert.equal(downloads.length,1);
  assert.equal(downloads[0].name,'coaching_opportunity_emails_2026-11-17.zip');
  const report=context.api.state.report,downloadCount=downloads.length;
  zipFiles=[];
  setTimeout(()=>{context.api.state.report=null;},0);
  await assert.doesNotReject(context.exportEmails(),'Clearing the report at an export pause must stop safely.');
  assert.equal(downloads.length,downloadCount,'A report cleared during export cannot download stale files.');
  assert.equal(zipFiles.length,0,'The first pause checks current input state before building email content.');
  context.api.state.report=report;
}

function plainAnalysis(value){
  return JSON.parse(JSON.stringify(value,(key,item)=>key==='builtAt'||key==='record'||key==='episode'?undefined:item));
}

async function verifyCooperativeBuilders(){
  vm.runInContext(`
    globalThis.builderFixtures={
      date:parseDate('2026-11-17'),
      countRule:normalizeRule({id:'count-fixture',ruleType:'statCount',statCount:{source:'qa',conditionHeader:'Call Quality',operator:'notBlank',minCount:0}}),
      headerRule:normalizeRule({id:'header-fixture',ruleType:'headerCount',countRule:{nameHeader:'Agent Name',minCount:0}}),
      correctiveRule:normalizeRule({id:'corrective-fixture',ruleType:'coachingCorrective',coachingCorrective:{coachingMatch:'contains',coachingPhrases:['quality','scheduling'],coachingPhraseLogic:'and',minCoachingCount:1}}),
      sources:[{name:'Example report.csv',rows:[{'Agent Name':'Person 0 01'},{'Agent Name':'Person 0 01'},{'Agent Name':'Person 1 02'}]}]
    };
  `,context);
  const fixtures=context.builderFixtures;
  for(const [syncName,stepName,args] of [
    ['buildStatRuleRecords','buildStatRuleRecordsSteps',[context.api.state.rules[0],fixtures.date]],
    ['buildStatCountRecords','buildStatCountRecordsSteps',[fixtures.countRule,fixtures.date]],
    ['buildHeaderCountRecords','buildHeaderCountRecordsSteps',[fixtures.headerRule,fixtures.sources]],
    ['buildCoachingCorrectiveRecords','buildCoachingCorrectiveRecordsSteps',[fixtures.correctiveRule,fixtures.date]]
  ]){
    const expected=context[syncName](...args);
    let actual=await context.runReportSteps(context[stepName](...args));
    if(syncName==='buildCoachingCorrectiveRecords')actual=context.ccDescribeCoachingCorrectiveRecords(actual,args[0]);
    assert.deepEqual(actual,expected,`${syncName} must preserve records, evidence text, ordering and diagnostic counts when run cooperatively.`);
  }
  const syncRows=structuredClone(context.api.state.report.flagged),asyncRows=structuredClone(context.api.state.report.flagged);
  context.urgencyPreparePeriodKpiContext(syncRows,fixtures.date,2);
  await context.runReportSteps(context.urgencyPreparePeriodKpiContextSteps(asyncRows,fixtures.date,2));
  assert.deepEqual(asyncRows,syncRows,'Cooperative urgency preserves every period, peer-team benchmark and representative score component.');
  const expected=plainAnalysis(context.impactBuildAnalysis());
  const actual=plainAnalysis(await context.runReportSteps(context.impactBuildAnalysisSteps()));
  assert.deepEqual(actual,expected,'Cooperative impact preserves needs, coaching episodes, diagnostics, transitions and profiles.');
  const report=context.api.state.report,previousImpact=report.coachingImpact,previousPerformance=context.performance;
  let clock=0;
  context.performance={now:()=>clock+=13};
  setTimeout(()=>{context.api.state.report=null;},0);
  try{
    const clearedResult=await context.runReportSteps(context.impactBuildAnalysisSteps());
    assert.equal(clearedResult,null,'An impact analysis whose report was cleared during a pause cannot publish stale results.');
    assert.equal(report.coachingImpact,previousImpact,'A canceled impact run cannot replace the prior analysis.');
  }finally{context.performance=previousPerformance;context.api.state.report=report;}
}

async function main(){
  assert.equal(typeof context.withReportCalculationCache,'function','Report rendering exposes a scoped calculation cache.');
  vm.runInContext(`
    const originalWeeklySeries=weeklyStatSeries;let weeklySeriesCalls=0;
    weeklyStatSeries=function(...args){weeklySeriesCalls++;return originalWeeklySeries(...args);};
    globalThis.cacheProbe=withReportCalculationCache(function(){
      const entry={config:state.rules[0].statRule},record={repKey:'person-0-1'};
      const first=simpleQualtricsSixWeekMetric(record,entry),second=simpleQualtricsSixWeekMetric(record,entry);
      const population=assignedRepSetForCoach('Coach A & Team',parseDate('2026-11-17'));
      population.add('mutated-returned-set');
      const nextPopulation=assignedRepSetForCoach('Coach A & Team',parseDate('2026-11-17'));
      return {first,second,weeklySeriesCalls,mutationLeaked:nextPopulation.has('mutated-returned-set')};
    });
  `,context);
  assert.deepEqual(context.cacheProbe.first,context.cacheProbe.second,'Reusing an identical metric cannot change its value.');
  assert.equal(context.cacheProbe.weeklySeriesCalls,1,'Identical six-week statistics are evaluated once per synchronous work slice.');
  assert.equal(context.cacheProbe.mutationLeaked,false,'Adding a representative to one result must not corrupt cached team populations.');
  vm.runInContext(`
    globalThis.nextSliceProbe=withReportCalculationCache(function(){
      const entry={config:state.rules[0].statRule},record={repKey:'person-0-1'};
      const cash=simpleQualtricsSixWeekMetric(record,entry),wipers=simpleQualtricsSixWeekMetric(record,{config:state.rules[2].statRule});
      return {cash,wipers,weeklySeriesCalls};
    });
  `,context);
  assert.equal(context.nextSliceProbe.weeklySeriesCalls,3,'A later work slice must recalculate; distinct statistic configurations cannot share results.');
  assert.notEqual(context.nextSliceProbe.cash.currentAverage,context.nextSliceProbe.wipers.currentAverage,'Cash and wiper statistics remain separate.');
  await verifyResponsiveExport();
  await verifyCooperativeBuilders();
  console.log('PASS Qualtrics generation: byte-identical executive and six coach emails on 96 people, three rules, 12 dated weeks, missing/zero values and unflagged eligible people; cached calculations and event-loop progress between email files.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
