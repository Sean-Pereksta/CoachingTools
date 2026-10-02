"use strict";
const assert=require('node:assert/strict');
const E=require('../js/dated-stats.js');
const {createHarness,plain}=require('./modernization-compatibility.test.js');
const headers=['Name','Sheet','Date','Cash Rate'];
const config={...E.defaultConfig('weeklyRetail',headers),calendar:{reviewed:true,frequency:'week',label:'ending'},fields:{'Cash Rate':{kind:'percentage',inputUnit:'percentage-points'}}};
const people=[['Alice Able','Alpha',4,1],['Bob Baker','Alpha',2,2],['Cara Clark','Alpha',0,0],['Dan Dale','Beta',2,1],['Eve Evans','Gamma',3,0]];
const rows=people.flatMap(([Name,Sheet])=>['2026-09-06','2026-09-13'].map(Date=>({Name,Sheet,Date,'Cash Rate':20})));
const metric=E.normalizeMetric({id:'cash',name:'Cash Rate',source:'weeklyRetail',field:'Cash Rate',kind:'percentage'});
const observations=E.categorize(rows,config,{headers}).observations;
const ids=Object.fromEntries(observations.map(o=>[o.rep,o.repId]));
const events=people.flatMap(([rep,,coachings,correctives])=>[['Coaching',coachings],['Corrective',correctives]].flatMap(([Type,n])=>Array.from({length:n},(_,i)=>({id:rep+Type+i,repId:ids[rep],source:'documented_coaching',date:'2026-09-03',fields:{Type,Subject:'Save the sale',Item:'First'},text:'Save the sale'}))));
const calculation={version:1,method:'combined',numerator:{source:'documented_coaching',label:'Coachings',field:'Type',value:'Coaching',match:'is'},denominator:{kind:'events',source:'documented_coaching',label:'Correctives',field:'Type',value:'Corrective',match:'is'}};
const settings={measure:'calculated',calculation,groupBy:'coach',resultWindow:'range',startDate:'2026-09-01',endDate:'2026-09-13',coverage:{documented_coaching:{complete:true,start:'2026-08-31',end:'2026-09-30'}}};
const byLine=result=>Object.fromEntries(result.data.map(p=>[p.line,p]));
async function arithmetic(){
  const totals=await E.research(observations,metric,settings,[...events,events[0]]),g=byLine(totals);
  assert.deepEqual(totals.axisLabels,['2026-09-01 → 2026-09-13']);
  assert.equal(g.Alpha.value,2);assert.equal(g.Alpha.numerator,6);assert.equal(g.Alpha.denominator,3);
  assert.equal(g.Alpha.eligibleRepresentatives,3,'zero-count reps remain in combined totals');
  assert.equal(g.Gamma.value,null,'zero denominator is never infinity or zero');
  assert.equal(g.Beta.value,2);assert.match(totals.measureLabel,/Coachings per Correctives/);
  const reps=byLine(await E.research(observations,metric,{...settings,calculation:{...calculation,method:'per_rep'}},events));
  assert.equal(reps.Alpha.value,2.5,'mean of same-rep ratios (4/1 + 2/2)/2, not combined 6/3');
  assert.equal(reps.Alpha.eligibleUnits,2);assert.equal(reps.Alpha.missingRepresentatives,1);
  assert.match(reps.Alpha.exclusions[0].reason,/No matching denominator/);
  assert.equal(reps.Gamma.value,null);
  const coaches=await E.research(observations,metric,{...settings,groupBy:'all',calculation:{...calculation,method:'per_coach'}},events);
  assert.equal(coaches.data[0].value,2);assert.equal(coaches.data[0].eligibleUnits,2);
  const perRep=await E.research(observations,metric,{...settings,groupBy:'all',calculation:{...calculation,denominator:{kind:'representatives'}}},events);
  assert.equal(perRep.data[0].value,11/5);
  const perCoach=await E.research(observations,metric,{...settings,groupBy:'all',calculation:{...calculation,denominator:{kind:'coaches'}}},events);
  assert.equal(perCoach.data[0].value,11/3,'a coach is counted once across all their reps and dates');
  const individual=byLine(await E.research(observations,metric,{...settings,groupBy:'representative'},events));
  assert.equal(individual['Alice Able'].value,4);assert.equal(individual['Bob Baker'].value,1);
  const none=await E.research(observations,metric,{...settings,coverage:{}},events);
  assert.ok(none.data.every(p=>p.value===null&&p.eligibleRepresentatives===0));
  const secondWeek=await E.research(observations,metric,{...settings,startDate:'2026-09-07'},events);
  assert.ok(secondWeek.data.every(p=>p.numerator===0&&p.value===null),'whole-range dates apply to both event counts');
  const weekly=await E.research(observations,metric,{...settings,resultWindow:'period',activityWindow:'trailing_week'},events);
  assert.equal(weekly.data.filter(p=>p.line==='Alpha')[0].value,2);
  assert.equal(weekly.data.filter(p=>p.line==='Alpha')[1].value,null);
  assert.equal(weekly.movement.find(p=>p.line==='Alpha').change,null);
  console.log('PASS combined totals, same-rep and same-coach ratios, per-rep and per-coach denominators, covered zeros, dates and missing ratios');
}
async function itemsAndScope(){
  const first=events[0],variants=[first,{...first,fields:{...first.fields,Item:'Second'}},first];
  const distinct=E.dedupeEvents(variants),window={start:'2026-09-01',end:'2026-09-13'},coverage=settings.coverage.documented_coaching;
  assert.equal(E.eventSummary(distinct,first.repId,window,coverage,{...calculation.numerator,countBy:'sessions'}).count,1);
  assert.equal(E.eventSummary(distinct,first.repId,window,coverage,{...calculation.numerator,countBy:'items'}).count,2);
  assert.equal(E.eventSummary(distinct,first.repId,window,coverage,{...calculation.numerator,topicAny:'STS, save the sale; retention'}).count,1);
  const differentRows=E.dedupeEvents([{...first,text:'Unrelated'}, {...first,text:'Save the sale',fields:{Type:'Corrective'}}]);
  assert.equal(E.eventSummary(differentRows,first.repId,window,coverage,{...calculation.numerator,topicAny:'save the sale'}).count,0,'filters cannot borrow text from another row of the session');
  const moved=observations.map(o=>o.repId===ids['Alice Able']&&o.period.end==='2026-09-13'?{...o,coach:'Beta'}:o);
  const groups=byLine(await E.research(moved,metric,settings,events));
  assert.equal(groups.Alpha.numerator,2);assert.equal(groups.Beta.numerator,6,'entire-window attribution uses latest assigned coach');
  const scoped=byLine(await E.research(moved,metric,{...settings,coaches:['Alpha']},events));
  assert.equal(scoped.Alpha.numerator,2,'a rep who moved out is not assigned back to the selected coach');
  const noCoach=observations.map(o=>({...o,coach:''}));
  const missing=await E.research(noCoach,metric,{...settings,calculation:{...calculation,denominator:{kind:'coaches'}}},events);
  assert.ok(missing.data.every(p=>p.value===null));
  assert.throws(()=>E.normalizeCalculation({...calculation,denominator:{kind:'events',label:'Correctives',requireMatch:true}}),/Choose which source rows/);
  assert.throws(()=>E.normalizeCalculation({...calculation,numerator:{label:'Coachings',field:'Missing'}}),/both the item filter/);
  await assert.rejects(E.research(observations,metric,settings,events,{cancelled:()=>true}),{name:'AbortError'});
  const many=Array.from({length:450},(_,i)=>({...observations[0],id:'obs'+i,repId:'rep'+i,rep:'Rep '+i}));let ticks=0;
  await assert.rejects(E.research(many,metric,{...settings,calculation:{...calculation,denominator:{kind:'representatives'}}},[],{yield:async()=>{ticks++;},cancelled:()=>ticks>1}),{name:'AbortError'});assert.equal(ticks,2,'a large single-window calculation yields and can cancel during the rep loop');
  const conflicts=await E.research(observations.map(o=>({...o,conflict:true})),metric,settings,events);assert.ok(conflicts.data.every(p=>p.value===null));
  console.log('PASS source item versus session counts, same-row filters, phrase aliases, coach changes, scope and definition validation');
}
function fixture(){
  const h=createHarness();Object.assign(h.context,{rows,headers,config,calculation,settings});
  h.context.eventRows=events.map(e=>({Name:people.find(p=>ids[p[0]]===e.repId)[0],'Coaching Date':e.date,'Session ID':e.id,...e.fields}));
  h.run(`
    state.data.weeklyRetail={headers,rows,config};noteCategorizationSourceVersion('weeklyRetail');
    state.data.documented_coaching={headers:['Name','Coaching Date','Session ID','Type','Subject','Item'],rows:eventRows};noteCategorizationSourceVersion('documented_coaching');
    const direct=datedStatsAvailableMetrics().find(m=>m.field==='Cash Rate');
    const question=normalizeResearchItem({id:'ratio-test',title:'Coaching support',source:'weeklyRetail',outputType:'table',datedStats:{...datedStatsSelectMetric({},direct),...settings,sentenceQuery:{version:1,view:'number',root:{kind:'group',mode:'all',children:[]}}}});
    state.researchItems=[question];
  `);return h;
}
async function integration(){
  const h=fixture();try{
    const result=plain(await h.run('evaluateDatedStatsResearch(question)'));assert.equal(byLine(result).Alpha.value,2);h.context.result=result;
    const rendered=h.run('renderResearchResultByDisplay(question,result)');assert.match(rendered,/sq-number-card/);assert.match(rendered,/Coachings/);assert.match(rendered,/See the counts and exclusions/);
    assert.equal(await h.run('researchSaveRenderedResult(question,result)'),true);
    assert.notEqual(await h.run('saveResearchItems()'),false);
    const reopened=createHarness(h.storage,h.db);try{
      reopened.run('loadResearchItems({definitionsOnly:true});');
      const stored=plain(await reopened.run('researchRenderedResultGet("ratio-test")'));assert.equal(byLine(stored).Alpha.value,2);
      assert.deepEqual(plain(reopened.run('state.researchItems[0].datedStats.calculation')),calculation);
      reopened.context.stored=stored;assert.match(reopened.run('renderResearchResultByDisplay(state.researchItems[0],stored)'),/sq-number-card/);
    }finally{reopened.close();}
    h.run(`question.datedStats.mode='changing';question.datedStats.sentenceQuery.root={kind:'group',mode:'all',children:[{kind:'event',label:'Coaching items',source:'documented_coaching',op:'eq',value:4,where:{kind:'group',mode:'all',children:[{kind:'field',field:'Type',op:'eq',value:'Coaching'}]}}]};`);
    const qualified=plain(await h.run('evaluateDatedStatsResearch(question)'));assert.equal(qualified.data.length,1);assert.equal(qualified.data[0].value,4,'whole-range qualification and both counts refer to the same rep');
    h.run(`question.datedStats.mode='fixed';question.datedStats.sentenceQuery.root={kind:'group',mode:'all',children:[]};`);
    h.run(`question.datedStats.calculation.denominator={...calculation.denominator,source:'checklist'};state.data.checklist={headers:['Name','Date','Type','Session ID'],rows:eventRows.filter(r=>r.Type==='Corrective').map(r=>({...r,Date:r['Coaching Date']}))};noteCategorizationSourceVersion('checklist');question.datedStats.coverage.checklist=question.datedStats.coverage.documented_coaching;`);
    assert.deepEqual(plain(h.run('researchReferencedSources(question)')).sort(),['weeklyRetail','documented_coaching','checklist'].sort());
    const cross=plain(await h.run('evaluateDatedStatsResearch(question)'));assert.equal(byLine(cross).Alpha.value,2);
    h.run("question.datedStats.calculation.denominator.field='Absent';");
    await assert.rejects(h.run('evaluateDatedStatsResearch(question)'),/filter column.*missing/);
    h.run("question.datedStats.calculation.denominator.field='Type';state.data.checklist.rows.push({Name:'Alice Able',Date:'invalid',Type:'Corrective'});noteCategorizationSourceVersion('checklist');");
    const invalid=plain(await h.run('evaluateDatedStatsResearch(question)'));assert.ok(invalid.data.every(p=>p.value===null),'invalid denominator source cannot produce falsely complete ratios');
    assert.deepEqual(h.errors,[]);
    console.log('PASS real adapter, number cards, saved definition/result roundtrip, source dependencies, cross-source ratios and missing-column/date protection');
  }finally{h.close();}
}
async function editor(){
  const h=fixture();try{
    h.run(`const createElement=document.createElement.bind(document);document.createElement=(tag,...args)=>{const n=createElement(tag,...args);if(tag==='dialog'){n.showModal=()=>n.setAttribute('open','');n.close=()=>n.dispatchEvent(new Event('close'));}return n;};window.AllStarSentenceWorkspace.open('ratio-test');`);
    h.run("document.querySelector('[data-sq-preset=rep_ratio]').click();");
    assert.match(h.context.document.querySelector('[data-sq-sentence]').textContent,/Average each rep/);
    const apply=async vals=>{h.context.vals=vals;await h.run(`for(const [k,v] of Object.entries(vals))document.querySelector('[data-sq-value="'+k+'"]').value=v;document.querySelector('[data-sq-edit][aria-label] form').onsubmit({preventDefault(){}});`);};
    await apply({field:'Type',value:'Corrective',match:'is',label:'Correctives'});
    h.run("document.querySelector('[data-sq-edit=count]').click();");await apply({field:'Type',value:'Coaching',match:'is',label:'Coachings'});
    h.run("document.querySelector('[data-sq-edit=resultLabel]').click();");await apply({label:'Support per corrective'});
    const pending=h.run("document.querySelector('[data-sq-preview]').onclick()");
    assert.match(h.context.document.querySelector('[data-sq-preview-result]').textContent,/Calculating Research/,'loading is visible before calculations');
    await pending;
    assert.match(h.context.document.querySelector('[data-sq-preview-result]').textContent,/2.5/);
    assert.match(h.context.document.querySelector('[data-sq-preview-result]').textContent,/Support per corrective/);
    const saving=h.run("document.querySelector('[data-sq-save]').onclick()");
    assert.equal(h.context.document.querySelector('[data-sq-save]').disabled,true);assert.match(h.context.document.querySelector('[data-sq-preview-result]').textContent,/Saving and running Research/);await saving;
    assert.equal(h.run('state.researchItems[0].datedStats.calculation.method'),'per_rep');
    assert.equal(h.run('state.researchItems[0].datedStats.sentenceQuery.view'),'number');
    assert.equal(h.run('state.researchItems[0].datedStats.calculation.label'),'Support per corrective');
    h.run("document.querySelector('[data-sq-advanced]').click();document.querySelector('[data-ds=title]').value='Renamed calculation';");
    await h.run("document.querySelector('[data-ds-run]').onclick()");
    assert.match(h.context.document.querySelector('[data-ds-preview-result]').textContent,/2.5/);
    await h.run("document.querySelector('[data-ds-save]').onclick()");
    assert.equal(h.run('state.researchItems[0].datedStats.calculation.method'),'per_rep');
    assert.equal(h.run('state.researchItems[0].title'),'Renamed calculation');
    assert.equal(h.run('state.researchItems[0].outputType'),'table');
    h.run("document.getElementById('addCalculatedResearchBtn').click();");assert.match(h.context.document.querySelector('[data-sq-sentence]').textContent,/Calculated number/);assert.ok(h.context.document.querySelector('[data-sq-value=countBy]'));h.run("document.querySelector('[data-sq-close]').click();");
    assert.deepEqual(h.errors,[]);
    console.log('PASS guided ratio preset, item filters and labels, number preview, immediate loading, and saving');
  }finally{h.close();}
}
(async()=>{await arithmetic();await itemsAndScope();await integration();await editor();})().catch(error=>{console.error(error);process.exitCode=1;});
