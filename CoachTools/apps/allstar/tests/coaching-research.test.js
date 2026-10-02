'use strict';
const assert=require('node:assert/strict');
const E=require('../js/dated-stats.js');
const {createHarness,plain}=require('./modernization-compatibility.test.js');
const headers=['Date','Name','Sheet','Cash Rate','Wiper Rate'];
const config={...E.defaultConfig('weeklyRetail',headers),calendar:{reviewed:true,frequency:'week',label:'ending'},fields:{'Cash Rate':{kind:'percentage',inputUnit:'percentage-points'},'Wiper Rate':{kind:'percentage',inputUnit:'percentage-points'}}};
const row=(Name,Date,rate,wiper=10)=>({Name,Date,Sheet:'Alpha','Cash Rate':rate,'Wiper Rate':wiper});
const rows=[row('Alice Able','2026-09-06',20),row('Alice Able','2026-09-13',40),row('Bob Baker','2026-09-06',50),row('Bob Baker','2026-09-13',80),row('Cara Clark','2026-09-06',90)];
const metric=E.normalizeMetric({id:'cash',name:'Cash rate',source:'weeklyRetail',field:'Cash Rate',kind:'percentage'});
const observations=E.categorize(rows,config,{headers}).observations;
const ids=Object.fromEntries(observations.map(o=>[o.rep,o.repId]));
const event=(id,rep,topic,type='Skill',date='2026-09-03')=>({id,source:'documented_coaching',repId:ids[rep],date,text:topic,topics:[topic],fields:{Type:type,Subject:topic}});
const events=[event('a','Alice Able','Cash'),event('b1','Bob Baker','Cash'),event('b2','Bob Baker','Cash'),event('b2','Bob Baker','Cash'),event('c','Cara Clark','Quality'),event('other','Bob Baker','Cash','Recognition')];
const settings={anchorStart:'2026-09-01',anchorEnd:'2026-09-06',groupBy:'coaching_frequency',frequencyWindow:'anchor',exactBuckets:true,topic:'Cash',coachingField:'Type',coachingValue:'Skill',coachingMatch:'is',coverage:{documented_coaching:{complete:true,start:'2026-09-01',end:'2026-09-30'}}};

async function calculations(){
  const result=await E.research(observations,metric,settings,events);
  assert.deepEqual(result.data.map(p=>[p.line,p.value]),[['1 session',20],['2 sessions',50],['0 sessions',90],['1 session',40],['2 sessions',80],['0 sessions',null]]);
  assert.equal(result.movement.find(p=>p.line==='1 session').change,20);
  assert.equal(result.movement.find(p=>p.line==='2 sessions').change,30);
  assert.equal(result.movement.find(p=>p.line==='0 sessions').change,null,'missing endpoint must never become zero');
  assert.equal(result.movement[0].changeUnit,'percentage points');
  const combined=await E.research(observations,metric,{...settings,groupBy:'coach'},events);
  assert.equal(combined.movement[0].pairedRepresentatives,2);
  assert.equal(combined.movement[0].first,35,'only the same two reps contribute at both ends');
  assert.equal(combined.movement[0].latest,60);
  assert.equal(combined.movement[0].change,25);
  const unknown=await E.research(observations,metric,{...settings,coverage:{}},events);
  assert.ok(unknown.data.every(p=>p.line==='Unknown coaching coverage'));
  const exact=await E.research(observations,metric,{...settings,groupBy:'coach',eventConditions:[{source:'documented_coaching',topic:'Cash',field:'Type',value:'Skill',match:'is',operator:'eq',threshold:2}]},events);
  assert.deepEqual(exact.data.map(p=>p.value),[50,80]);
  const sameSession=E.dedupeEvents([event('x','Alice Able','Cash','Recognition'),event('x','Alice Able','Quality','Skill')]);
  assert.equal(E.eventSummary(sameSession,ids['Alice Able'],{start:'2026-09-01',end:'2026-09-06'},settings.coverage.documented_coaching,{topic:'Cash',field:'Type',value:'Skill',match:'is'}).count,0,'conditions cannot borrow fields from different source rows');
  console.log('PASS exact 0/1/2 cohorts, type/topic filtering, deduplication, paired movement, percentage points, missing endpoints and unknown coverage');
}
async function activity(){
  const cfg={...settings,groupBy:'coach',activityWindow:'trailing_week'};
  const total=await E.research(observations,metric,{...cfg,measure:'coaching_count'},events);
  assert.equal(total.data[0].value,null,'September 6 window begins August 31; partial coverage is unknown');
  cfg.coverage={documented_coaching:{...settings.coverage.documented_coaching,start:'2026-08-31'}};
  const average=await E.research(observations,metric,{...cfg,measure:'coaching_per_rep'},events);
  assert.deepEqual(average.data.map(p=>p.value),[1,0]);
  assert.equal(average.data[0].denominator,3,'covered reps with zero coachings remain in the denominator');
  assert.equal(average.data[1].denominator,2,'a missing population observation is explicitly excluded');
  assert.equal(average.data[1].missingRepresentatives,1);
  const count=await E.research(observations,metric,{...cfg,measure:'coaching_count'},events);
  assert.deepEqual(count.data.map(p=>p.value),[3,0]);
  assert.equal(count.columns[0].label,'Documented coaching sessions','activity output must not use the underlying performance metric label');
  const percent=await E.research(observations,metric,{...cfg,measure:'coached_percent'},events);
  assert.ok(Math.abs(percent.data[0].value-200/3)<1e-10);
  const blankStats=observations.map(o=>({...o,values:{}}));
  const withoutRate=await E.research(blankStats,metric,{...cfg,measure:'coaching_per_rep'},events);
  assert.deepEqual(withoutRate.data.map(p=>p.value),[1,0],'event averages do not require a valid cash-rate value');
  let yields=0;
  await E.research(observations,metric,settings,events,{yield:async()=>{yields++;}});
  assert.equal(yields,3,'yields before setup and after each period');
  await assert.rejects(E.research(observations,metric,settings,events,{cancelled:()=>true}),{name:'AbortError'});
  console.log('PASS weekly activity totals, zero-inclusive per-rep averages, coached percentage, explicit exclusions and cancellable yielding');
}
function fixture(){
  const h=createHarness();h.context.rows=rows;h.context.headers=headers;h.context.config=config;
  h.run(`
    state.data.weeklyRetail={fileName:'weekly.csv',rows,headers,config};noteCategorizationSourceVersion('weeklyRetail');
    state.data.documented_coaching.headers=['Coaching Date','Name','Description','Type','Session ID'];
    state.data.documented_coaching.rows=[['Alice Able','a'],['Bob Baker','b1'],['Bob Baker','b2']].map(([name,id])=>({_rep:name,_repKey:fullNameIdentityKey(name),Name:name,'Coaching Date':'2026-09-03',Description:'Cash',Type:'Skill','Session ID':id}));
    noteCategorizationSourceVersion('documented_coaching');
    const direct=datedStatsAvailableMetrics().find(m=>m.field==='Cash Rate');
    const extra=datedStatsAvailableMetrics().find(m=>m.field==='Wiper Rate');
    const question=normalizeResearchItem({id:'coaching-question',title:'Coaching movement',source:'weeklyRetail',outputType:'table',datedStats:{...datedStatsSelectMetric({},direct),groupBy:'coaching_frequency',exactBuckets:true,frequencyWindow:'anchor',anchorStart:'2026-09-01',anchorEnd:'2026-09-06',coverage:{documented_coaching:{complete:true,start:'2026-08-31',end:'2026-09-30'}},additionalMetricIds:[extra.id],sentenceQuery:{version:1,view:'movement',root:{kind:'group',mode:'all',children:[]}}}});
    state.researchItems=[question];
  `);return h;
}
async function integration(){
  const h=fixture();try{
    const result=plain(await h.run('evaluateDatedStatsResearch(question)'));h.context.result=result;
    assert.equal(result.additionalMetrics.length,1);
    assert.equal(result.movement.find(p=>p.line==='2 sessions').change,30);
    assert.equal(result.additionalMetrics[0].result.movement.find(p=>p.line==='2 sessions').change,0);
    assert.match(h.run('renderDatedStatsResult(question,result)'),/Paired reps/);
    assert.match(h.run('renderDatedStatsResult(question,result)'),/Wiper Rate/);
    assert.equal(await h.run('researchSaveRenderedResult(question,result)'),true);
    const saved=plain(await h.run("researchRenderedResultGet('coaching-question')"));assert.equal(saved.additionalMetrics.length,1);assert.equal(saved.movement.length,3);
    h.run("state.data.documented_coaching.rows.push({_rep:'Alice Able',_repKey:fullNameIdentityKey('Alice Able'),'Coaching Date':'invalid',Description:'Cash'});noteCategorizationSourceVersion('documented_coaching');");
    const invalid=plain(await h.run('evaluateDatedStatsResearch(question)'));
    assert.ok(invalid.data.every(p=>p.line==='Unknown coaching coverage'),'invalid event dates prevent false exact counts');
    assert.deepEqual(h.errors,[]);
    console.log('PASS actual adapter, multiple statistics, movement table, persisted results and invalid-source completeness protection');
  }finally{h.close();}
}
async function editorAndLoading(){
  const h=fixture();try{
    h.run(`
      const createElement=document.createElement.bind(document);
      document.createElement=(tag,...args)=>{const node=createElement(tag,...args);if(tag==='dialog'){node.showModal=()=>node.setAttribute('open','');node.close=()=>node.dispatchEvent(new Event('close'));}return node;};
      window.AllStarSentenceWorkspace.open('coaching-question');
    `);
    assert.equal(h.context.document.querySelectorAll('[data-sq-preset]').length,6);
    h.run("document.querySelector('[data-sq-preset=average]').click();");
    assert.match(h.context.document.querySelector('[data-sq-sentence]').textContent,/Average coachings per rep/);
    h.run("document.querySelector('[data-sq-edit=coaching]').click();");
    assert.ok(h.context.document.querySelector('[data-sq-value=coachingField]'));
    h.run("document.querySelector('[data-sq-edit=mapping]').click();");
    assert.ok(h.context.document.querySelector('[data-sq-value=documented_coaching_date]'));
    h.run("document.querySelector('[data-sq-preset=movement]').click();document.querySelector('[data-sq-edit=group]').click();");
    assert.ok(h.context.document.querySelector('[value=coaching_frequency]'));
    h.run("document.querySelector('[data-sq-edit=values]').click();");
    assert.ok(h.context.document.querySelector('[data-sq-extra]'));
    h.run("document.querySelector('[data-sq-close]').click();");
    h.run(`
      window.AllStarResearchWorkspace.init();openResearchItemEditor(null);
      let validationStarted=false;const priorValidation=validateResearchEditor;
      validateResearchEditor=()=>{validationStarted=true;assertLoading=els.loadingOverlay.classList.contains('open');return false;};
      let assertLoading=false;const saving=saveResearchItemFromEditor();
    `);
    assert.equal(h.run('validationStarted'),false,'the first await happens before validation or computation');
    assert.equal(h.run("els.loadingOverlay.classList.contains('open')"),true,'loading appears synchronously');
    assert.equal(h.run('els.saveResearchItemBtn.disabled'),true);
    await h.run('saving');assert.equal(h.run('assertLoading'),true);assert.equal(h.run('els.saveResearchItemBtn.disabled'),false);
    assert.equal(h.run('state.researchEditorSaving'),false);assert.equal(h.run("els.loadingOverlay.classList.contains('open')"),false);
    assert.equal(h.errors.length,1,'only expected validation alert');
    console.log('PASS real sentence presets/settings and immediate loading before validation; controls recover after validation failure');
  }finally{h.close();}
}
(async()=>{await calculations();await activity();await integration();await editorAndLoading();})().catch(error=>{console.error(error);process.exitCode=1;});
