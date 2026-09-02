#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const engine=require('../qualtrics/individual-messages.js');

function side(overrides={}){
  return {enabled:true,sourceType:'stat',source:'score',field:'',operator:'lt',threshold:'50',threshold2:'',message:'Please review score (ConcernValue).',variables:[],...overrides};
}
function rule(id,concern=side(),strength=side({enabled:false,operator:'gte',threshold:'80',message:'Strong score (StrengthValue).'})){
  return {id,title:id,individualMessage:{concern,strength}};
}
function resolver(values){
  return {
    resolveObservation(rep,config,currentRule){
      const value=values.get(`${rep.repKey}|${currentRule.id}|${config.source||config.field}`);
      return value==null?{missing:true,reason:'missing'}:{missing:false,value,raw:value,formatted:String(value),label:config.source||config.field,isPercent:false};
    },
    resolveVariable(rep,variable,currentRule){
      const value=values.get(`${rep.repKey}|${currentRule.id}|${variable.source||variable.field}`);
      return value==null?{missing:true,reason:'missing'}:{missing:false,value,raw:value,formatted:String(value),label:variable.source||variable.field,isPercent:false};
    }
  };
}

async function main(){
  const representatives=[
    {repKey:'a',fullName:'Alex Able',coach:'Coach One',team:'North'},
    {repKey:'b',fullName:'Blair Baker',coach:'Coach Two',team:'South'},
    {repKey:'c',fullName:'Casey Clark',coach:'Coach Three',team:'West'},
    {repKey:'d',fullName:'Dana Drew',coach:'',team:''},
    {repKey:'a',fullName:'Alex Able Duplicate',coach:'Coach One',team:'North'}
  ];
  const organizations=[
    {id:'consumer',name:'Consumer',coachNames:['Coach One','Coach Two']},
    {id:'insurance',name:'Insurance',coachNames:['Coach Three']}
  ];
  const index=engine.buildScopeIndex(representatives,organizations);
  assert.equal(index.representatives.length,4,'duplicate representative keys must collapse');
  assert.deepEqual(engine.resolveScope(index,{organizationIds:new Set(['consumer'])}).map(rep=>rep.repKey),['a','b'],'one organization scope');
  assert.deepEqual(engine.resolveScope(index,{organizationIds:new Set(['consumer','insurance'])}).map(rep=>rep.repKey),['a','b','c'],'multiple organization scope');
  assert.deepEqual(engine.resolveScope(index,{coachKeys:new Set([engine.normalizeName('Coach Two')])}).map(rep=>rep.repKey),['b'],'one coach scope');
  assert.deepEqual(engine.resolveScope(index,{coachKeys:new Set([engine.normalizeName('Coach One'),engine.normalizeName('Coach Three')])}).map(rep=>rep.repKey),['a','c'],'multiple coach scope');
  assert.deepEqual(engine.resolveScope(index,{organizationIds:new Set(['consumer']),includeRepKeys:new Set(['c']),excludeRepKeys:new Set(['b'])}).map(rep=>rep.repKey),['a','c'],'group plus individual include/exclude');
  assert.deepEqual(engine.resolveScope(index,{includeRepKeys:new Set(['d'])}).map(rep=>rep.repKey),['d'],'individual-only scope');
  assert.deepEqual(engine.resolveScope(index,{allByDefault:true,excludeRepKeys:new Set(['d'])}).map(rep=>rep.repKey),['a','b','c'],'review-all scope supports individual exclusions');
  assert.ok(index.repByKey.get('b').normalizedSearch.includes(engine.normalizeName('Blair Baker Coach Two South Consumer')),'representative search should be pre-normalized across name, coach, team, and organization');
  assert.equal(index.repByKey.get('d').organizationIds.size,0,'missing coach/team data remains selectable without invented membership');

  const roster=[
    {'First Name':'Alex','Last Name':'Able','Username':'alex@example.com'},
    {'First Name':'Blair','Last Name':'Baker','Username':'blair@example.com'},
    {'First Name':'Casey','Last Name':'Clark','Username':'casey@example.com'},
    {'First Name':'Dana','Last Name':'Drew','Username':'dana@example.com'}
  ];
  const values=new Map([
    ['a|low|score',40],['a|duplicate|score',35],['a|strong|score',90],
    ['b|low|score',40],['b|duplicate|score',35],['b|strong|score',60],
    ['c|low|score',60],['c|duplicate|score',65],['c|strong|score',90],
    ['d|low|score',60],['d|duplicate|score',65],['d|strong|score',60]
  ]);
  const rules=[
    rule('low',side({message:'Same final concern.'})),
    rule('duplicate',side({message:'Same final concern.'})),
    rule('strong',side({enabled:false}),side({enabled:true,operator:'gte',threshold:'80',message:'Excellent result.'}))
  ];
  const genericBefore={...engine.DEFAULT_TEMPLATE,includeGeneric:true,genericMessage:'Shared weekly note.',genericPlacement:'before'};
  let evaluated=engine.evaluateAll({representatives:index.representatives,rules,rosterRows:roster,resolver:resolver(values),template:genericBefore});
  const alex=evaluated.results.find(result=>result.repKey==='a'), dana=evaluated.results.find(result=>result.repKey==='d');
  assert.equal(alex.concerns.length,2,'all qualifying concern rules remain available');
  assert.deepEqual(alex.concernMessages,['Same final concern.'],'identical final messages are deduplicated');
  assert.ok(alex.message.indexOf('Shared weekly note.')<alex.message.indexOf('Area to Focus On'),'generic message before findings');
  assert.equal(dana.status,'Ready','generic-only representative is review/send ready');
  assert.equal(dana.sendReady,true);
  assert.match(dana.message,/Shared weekly note/);
  const genericAfter={...genericBefore,genericPlacement:'after'};
  const after=engine.evaluateAll({representatives:[index.repByKey.get('a')],rules,rosterRows:roster,resolver:resolver(values),template:genericAfter}).results[0];
  assert.ok(after.message.indexOf('Shared weekly note.')>after.message.indexOf('Great Work'),'generic message after findings');
  const disabled=engine.evaluateAll({representatives:[index.repByKey.get('d')],rules,rosterRows:roster,resolver:resolver(values),template:{...genericBefore,includeGeneric:false}}).results[0];
  assert.equal(disabled.message,''); assert.equal(disabled.status,'No Qualifying Behavior');

  const priority=engine.sortReviewResults(evaluated.results);
  assert.deepEqual(priority.map(result=>engine.reviewCategory(result)),['attention','mixed','strength','noFinding'],'review priority category order');
  assert.deepEqual(engine.sortReviewResults(evaluated.results).map(result=>result.repKey),priority.map(result=>result.repKey),'priority ordering is deterministic');
  assert.equal(evaluated.summary.attention,1); assert.equal(evaluated.summary.mixed,1); assert.equal(evaluated.summary.strengthOnly,1); assert.equal(evaluated.summary.noFinding,1);

  const largeReps=Array.from({length:600},(_,i)=>({repKey:`rep-${i}`,fullName:`Person ${String(i).padStart(4,'0')}`,coach:`Coach ${i%12}`,team:`Team ${i%12}`}));
  const largeRoster=largeReps.map((rep,i)=>({'First Name':'Person','Last Name':String(i).padStart(4,'0'),'Username':`person${i}@example.com`}));
  const largeValues=new Map(); for(let i=0;i<largeReps.length;i++) largeValues.set(`rep-${i}|large|score`,i%100);
  const largeRules=[rule('large',side({threshold:'45',message:'Focus score (ConcernValue).'}),side({enabled:true,operator:'gte',threshold:'75',message:'Strong score (StrengthValue).'}))];
  const direct=engine.evaluateAll({representatives:largeReps,rules:largeRules,rosterRows:largeRoster,resolver:resolver(largeValues),template:engine.DEFAULT_TEMPLATE});
  const progress=[]; let yields=0;
  const responsive=await engine.evaluateAllAsync({representatives:largeReps,rules:largeRules,rosterRows:largeRoster,resolver:resolver(largeValues),template:engine.DEFAULT_TEMPLATE,chunkSize:20,sliceMs:4,onProgress:item=>progress.push(item.completed),yieldToBrowser:async()=>{ yields++; }});
  assert.equal(responsive.results.length,largeReps.length,'large-run final count matches scope');
  assert.equal(new Set(responsive.results.map(result=>result.repKey)).size,largeReps.length,'large run has no duplicate representatives');
  assert.deepEqual(responsive.summary,direct.summary,'responsive orchestration preserves direct-engine results');
  assert.deepEqual(responsive.results.map(result=>({repKey:result.repKey,status:result.status,message:result.message})),direct.results.map(result=>({repKey:result.repKey,status:result.status,message:result.message})),'optimized and direct results are exactly equivalent');
  assert.ok(progress.length>=10&&progress.at(-1)===largeReps.length,'progress advances throughout a large run');
  assert.ok(yields>=10,'large run yields repeatedly to the browser');

  const aborter=new AbortController(); aborter.abort();
  await assert.rejects(()=>engine.evaluateAllAsync({representatives:largeReps,rules:largeRules,rosterRows:largeRoster,resolver:resolver(largeValues),signal:aborter.signal}),error=>error.name==='AbortError');
  console.log('PASS Qualtrics scoped Individual Review tests');
}

main().catch(error=>{ console.error(error); process.exit(1); });
