'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Q=require('../js/sentence-query.js');
const field=(name,op,value)=>({kind:'field',field:name,op,value});
const group=(...children)=>({kind:'group',mode:'all',children});
const where=group(field('Description','contains','cash'),field('Type','eq','Documented'));
const event=(patch={})=>({kind:'event',source:'coaching',where,op:'gte',value:1,...patch});
const record=(id,description,type,patch={})=>({id,date:'2026-09-08',row:1,fields:{Description:description,Type:type},...patch});
const ctx=(records=[],complete=true)=>({repId:'a',window:{start:'2026-09-06',end:'2026-09-12'},coverage:{coaching:{start:'2026-09-01',end:'2026-09-30',complete}},sources:{coaching:{byRep:new Map([['a',records]]),invalidRows:0}}});
test('description and type must match the SAME physical row',()=>{
  const context=ctx([record('1','cash offer','Other'),record('2','wipers','Documented')]);
  assert.equal(Q.evaluate(event(),context).value,false);
  context.sources.coaching.byRep.get('a').push(record('3','Cash offer','Documented'));
  const r=Q.evaluate(event(),context);assert.equal(r.value,true);assert.equal(r.observed,1);assert.equal(r.evidence[0].id,'3');
});
test('one event split into multiple rows cannot satisfy a same-row AND',()=>{
  assert.equal(Q.evaluate(event(),ctx([record('same','cash','Other'),record('same','wipers','Documented')])).value,false);
});
test('distinct matching sessions, not matching row count',()=>{
  const r=Q.evaluate(event({op:'eq',value:1}),ctx([record('same','cash','Documented'),record('same','cash updated','Documented')]));
  assert.equal(r.value,true);assert.equal(r.observed,1);
});
test('separate event requirements can match different rows',()=>{
  const a=event({where:group(field('Description','contains','cash'))});
  const b=event({where:group(field('Type','eq','Documented'))});
  assert.equal(Q.evaluate(group(a,b),ctx([record('1','cash','Other'),record('2','wipers','Documented')])).value,true);
});
test('nested OR and NOT use three-valued logic',()=>{
  const tree={kind:'group',mode:'any',children:[event(),{kind:'group',mode:'not',children:[event({where:group(field('Description','contains','wipers'))})]}]};
  assert.equal(Q.evaluate(tree,ctx([record('1','cash','Documented')],false)).value,true);
  assert.equal(Q.evaluate({kind:'group',mode:'not',children:[event()]},ctx([],false)).value,null);
});
test('zero sessions needs complete coverage, absence is not zero',()=>{
  assert.equal(Q.evaluate(event({op:'eq',value:0}),ctx([],false)).value,null);
  assert.equal(Q.evaluate(event({op:'eq',value:0}),ctx([],true)).value,true);
});
test('observed lower bounds remain proof without complete coverage',()=>{
  assert.equal(Q.evaluate(event(),ctx([record('1','cash','Documented')],false)).value,true);
  assert.equal(Q.evaluate(event({op:'eq',value:1}),ctx([record('1','cash','Documented')],false)).value,null);
  assert.equal(Q.evaluate(event({op:'eq',value:0}),ctx([record('1','cash','Documented')],false)).value,false);
});
test('partial coverage, invalid records and unresolved columns do not prove zero',()=>{
  const c=ctx([]);c.coverage.coaching.start='2026-09-07';assert.equal(Q.evaluate(event({op:'eq',value:0}),c).value,null);
  c.coverage.coaching.start='2026-09-01';c.sources.coaching.invalidRows=1;assert.equal(Q.evaluate(event({op:'eq',value:0}),c).value,null);
  const d=ctx([record('1','cash','Documented',{fields:{Description:'cash'}})]);
  assert.equal(Q.evaluate(event({op:'eq',value:0}),d).value,null);
});
test('unknown source never silently becomes no events',()=>{const c=ctx([]);delete c.sources.coaching;assert.equal(Q.evaluate(event({op:'eq',value:0}),c).value,null);});
test('date boundaries inclusive, independent event windows, no cross-person matches',()=>{
  const c=ctx([record('1','cash','Documented',{date:'2026-09-06'}),record('2','cash','Documented',{date:'2026-09-12'}),record('3','cash','Documented',{date:'2026-09-13'})]);
  assert.equal(Q.evaluate(event({op:'eq',value:2}),c).value,true);
  assert.equal(Q.evaluate(event({op:'eq',value:1,startDate:'2026-09-13',endDate:'2026-09-13'}),c).value,true);
  c.repId='other';assert.equal(Q.evaluate(event(),c).value,false);
});
test('valid zero differs from missing; numeric comparison does not coerce blank',()=>{
  assert.equal(Q.predicate({n:0},field('n','lte',0)),true);
  assert.equal(Q.predicate({n:''},field('n','lte',0)),null);
  assert.equal(Q.predicate({},field('n','neq',0)),null);
  assert.equal(Q.predicate({n:''},field('n','blank','')),true);
});
test('invalid inputs fail before calculation',()=>{
  const catalog={coaching:['Description','Type']};Q.validate(group(event()),catalog);
  assert.throws(()=>Q.validate(event({value:-1}),catalog));
  assert.throws(()=>Q.validate(event({where:group(field('Missing','eq','x'))}),catalog));
  assert.throws(()=>Q.validate(event({startDate:'2026-09-01'}),catalog));
  assert.throws(()=>Q.validate({kind:'group',mode:'any',children:[]},catalog));
});
test('explanation names same-row semantics; query round trip preserves structure',()=>{
  const tree=group(event());assert.match(Q.describe(tree),/SAME ROW/);assert.deepEqual(Q.copy(tree),tree);
});
function harness(){
  const calls=[];const E={series:()=>[{period:{start:'2026-09-06',end:'2026-09-12'}},{period:{start:'2026-09-13',end:'2026-09-19'}}],criterion:()=>({value:42,pass:true,unit:'%'}),research:async(...args)=>{calls.push(args);return {data:[],definition:{metric:args[1],settings:args[2]}};}};
  const adapter={catalog:()=>({coaching:['Description','Type']}),sources:()=>ctx([record('1','cash','Documented')]).sources,metric:()=>({name:'AR',source:'weeklyRetail'}),label:x=>x};
  Q.installResearch(E,adapter);return {E,calls};
}
const observations=[{repId:'a',rep:'A',source:'weeklyRetail',period:{start:'2026-09-06',end:'2026-09-12'}}];
const metric={source:'weeklyRetail',startDate:'2026-09-06',endDate:'2026-09-19'};
test('legacy research is delegated unchanged',async()=>{
  const {E,calls}=harness(),settings={mode:'fixed'},events=[];
  await E.research(observations,metric,settings,events);
  assert.strictEqual(calls[0][0],observations);assert.strictEqual(calls[0][2],settings);assert.strictEqual(calls[0][3],events);
});
test('same-row filter compiles to eligibility without multiplying stat rows',async()=>{
  const {E,calls}=harness(),settings={mode:'fixed',anchorStart:'2026-09-06',anchorEnd:'2026-09-12',sentenceQuery:{version:1,root:group(event())}};
  const before=JSON.stringify(settings);const r=await E.research(observations,metric,settings,[]);
  assert.strictEqual(calls[0][0],observations);assert.equal(calls[0][3].length,1);assert.equal(calls[0][3][0].repId,'a');
  assert.equal(JSON.stringify(settings),before);assert.deepEqual(r.definition.settings,settings);assert.equal(r.sentenceEvidence.counts.included,1);
});
test('changing groups reevaluate for each reporting period',async()=>{
  const {E,calls}=harness();const r=await E.research(observations,metric,{mode:'changing',sentenceQuery:{version:1,root:group(event())}},[]);
  assert.equal(calls[0][3].length,1);assert.equal(calls[0][3][0].date,'2026-09-06');assert.equal(r.sentenceEvidence.totalChecks,2);assert.equal(r.sentenceEvidence.counts.unknown,1);
});
test('numeric modifiers delegate to the existing criterion engine',async()=>{
  const {E}=harness();const r=await E.research(observations,metric,{mode:'fixed',sentenceQuery:{version:1,root:group({kind:'stat',metricId:'rate',operator:'gte',threshold:40})}},[]);
  assert.equal(r.sentenceEvidence.counts.included,1);
});
test('unknown schema and cancellation fail safely',async()=>{
  const {E,calls}=harness();await assert.rejects(()=>E.research(observations,metric,{sentenceQuery:{version:99}},[]));
  await assert.rejects(()=>E.research(observations,metric,{mode:'fixed',sentenceQuery:{version:1,root:group(event())}},[],{cancelled:()=>true}));assert.equal(calls.length,0);
});

test('impossible dates remain unknown and invalid date thresholds fail validation',()=>{
  assert.equal(Q.predicate({d:'2026-02-30'},field('d','before','2026-03-01')),null);
  assert.throws(()=>Q.validate(event({startDate:'2026-02-30',endDate:'2026-03-01'}),{coaching:['Description','Type']}));
});
test('numerical period counts cannot be negative or fractional',()=>{
  for(const requiredPeriods of [-1,0,1.5])assert.throws(()=>Q.validate({kind:'stat',metricId:'ar',operator:'gte',threshold:50,mode:'qualifying_periods',requiredPeriods},{}));
});
test('decimal thresholds and explicit zero remain valid numbers',()=>{
  Q.validate({kind:'stat',metricId:'ar',operator:'gte',threshold:50.5},{});
  assert.equal(Q.predicate({value:50.5},field('value','gte',50.4)),true);
});
test('summaries expose qualifying periods and human-readable session comparisons',()=>{
  assert.match(Q.describe(event({op:'lte',value:2})),/at most 2/);
  assert.match(Q.describe({kind:'stat',metricId:'ar',mode:'qualifying_periods',requiredPeriods:3,operator:'lt',threshold:50}),/at least 3 reporting periods/);
});
