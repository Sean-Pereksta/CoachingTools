#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const engine=require('../qualtrics/individual-messages.js');

function render(template,values,rawValues){ return engine.replaceVariables(template,values,engine.BUILT_INS,rawValues); }

// All requested aliases, capitalization, and supported token spellings.
for(const alias of ['StrengthValue','OpportunityValue','ConcernValue']){
  for(const spelling of [alias,alias.toLowerCase(),alias.toUpperCase()]){
    for(const [suffix,expected] of [['%','0.436%'],['%100','43.6%']]){
      for(const token of [`(${spelling}${suffix})`,`(${spelling})${suffix}`,`${spelling}${suffix}`]){
        assert.deepEqual(render(token,{[alias]:.436}),{text:expected,errors:[]},token);
      }
    }
  }
}

// Explicit scaling does not guess based on magnitude and preserves zero.
for(const [value,unscaled,scaled] of [
  [0,'0%','0%'],[-0,'0%','0%'],[1,'1%','100%'],[.29,'0.29%','29%'],
  [-.125,'-0.125%','-12.5%'],[43.6,'43.6%','4360%'],[1.25,'1.25%','125%'],
  ['.436','0.436%','43.6%'],[' 0.436 ','0.436%','43.6%'],['4.36e-1','0.436%','43.6%'],
  ['43.6%','0.436%','43.6%'],['1,234.5','1234.5%','123450%']
]){
  assert.deepEqual(render('(StrengthValue%) / (StrengthValue%100)',{StrengthValue:value}),{text:`${unscaled} / ${scaled}`,errors:[]});
}

// Display text must not be scaled again. Ordinary placeholders retain it.
assert.deepEqual(render('(StrengthValue) | (StrengthValue%) | (StrengthValue%100)',
  {StrengthValue:'43.6%'},{StrengthValue:{value:.436,raw:.436,formatted:'43.6%',isPercent:true}}),
  {text:'43.6% | 0.436% | 43.6%',errors:[]});
assert.deepEqual(render('(opportunityValue%100)',{ConcernValue:'43.6%'},{ConcernValue:{value:.436}}),{text:'43.6%',errors:[]});
assert.deepEqual(render('(firstname) (ConcernValue) (StrengthValue)',{FirstName:'Sean',ConcernValue:'43.6%',StrengthValue:'72%'}),{text:'Sean 43.6% 72%',errors:[]});
assert.equal(render('PreStrengthValue%100 StrengthValueLabel% untouched 100%',{StrengthValue:.436}).text,'PreStrengthValue%100 StrengthValueLabel% untouched 100%');

// Blanks and missing outcomes never become a fabricated 0%.
for(const value of [null,undefined,'','  ']){
  assert.deepEqual(render('(StrengthValue%100)',{StrengthValue:value}),{text:'',errors:[]});
}
assert.deepEqual(render('(StrengthValue%100)',{StrengthValue:'N/A'},{StrengthValue:undefined}),{text:'N/A',errors:[]});
assert.deepEqual(render('(StrengthValue%100)',{}),{text:'',errors:[]});
for(const value of ['unavailable','12,34','1e999',NaN,Infinity,-Infinity,true]){
  const result=render('(StrengthValue%100)',{StrengthValue:value});
  assert.equal(result.text,'(StrengthValue%100)');
  assert.equal(result.errors.length,1);
  assert.match(result.errors[0],/Invalid Percentage Value/);
}
for(const token of ['(StrengthValue%10)','StrengthValue%1000','(StrengthValue%)%100']){
  const result=render(token,{StrengthValue:.436});
  assert.equal(result.text,token);
  assert.equal(result.errors.length,1);
  assert.match(result.errors[0],/Invalid Percentage Format/);
}
assert.deepEqual(render('(Unknown%100)',{}),{text:'(Unknown%100)',errors:['Unresolved Variable: Unknown']});

function side(sideName){
  return {enabled:true,sourceType:'stat',source:'rate',operator:'gte',threshold:'0',
    message:sideName==='concern'?'Focus (OpportunityValue%100); raw (OpportunityValue%); original (ConcernValue); extra (Rate%100).':'Strength (StrengthValue%100); raw (StrengthValue%); original (StrengthValue); extra (Rate%100).',
    variables:[{name:'Rate',sourceType:'stat',source:'extraRate',format:'percent'}]};
}
const rules=['A','B'].map(id=>({id,title:id,individualMessage:{concern:side('concern'),strength:side('strength')}}));
const representatives=[{repKey:'sean',fullName:'Sean Example'},{repKey:'sam',fullName:'Sam Example'}];
const rosterRows=representatives.map(rep=>({'First Name':rep.fullName.split(' ')[0],'Last Name':'Example',Username:`${rep.repKey}@example.com`}));
const observations={sean:{A:{concern:.125,strength:.61},B:{concern:.436,strength:.72}},sam:{A:{concern:.25,strength:.8},B:{concern:.36,strength:.9}}};
const observation=value=>({value,raw:value,formatted:`${Number((value*100).toPrecision(12))}%`,isPercent:true});
const resolver={
  resolveObservation(rep,config,rule,sideName){ return observation(observations[rep.repKey][rule.id][sideName]); },
  resolveVariable(){ return observation(.29); }
};
const template={...engine.DEFAULT_TEMPLATE,maxConcerns:0,maxStrengths:0,header:'Hi (firstname): (OpportunityValue%100) / (StrengthValue%100).',footer:'End (ConcernValue%100).'};
const options={representatives,rules,rosterRows,resolver,template};
const rulesBefore=JSON.stringify(rules);
const evaluated=engine.evaluateAll(options);
assert.equal(JSON.stringify(rules),rulesBefore,'rendering must not mutate saved rule configuration');
for(const rule of rules){
  assert.equal(engine.normalizeRule(JSON.parse(JSON.stringify(rule))).individualMessage.concern.message,rule.individualMessage.concern.message,'saved rules preserve new token syntax');
}
const sean=evaluated.results.find(result=>result.repKey==='sean');
assert.equal(sean.status,'Ready'); assert.equal(sean.sendReady,true); assert.deepEqual(sean.errors,[]);
assert.equal(sean.greeting,'Hi Sean: 43.6% / 72%.');
assert.equal(sean.closing,'End 43.6%.');
assert.deepEqual(sean.concernMessages,[
  'Focus 43.6%; raw 0.436%; original 43.6%; extra 29%.',
  'Focus 12.5%; raw 0.125%; original 12.5%; extra 29%.'
]);
assert.deepEqual(sean.strengthMessages,[
  'Strength 72%; raw 0.72%; original 72%; extra 29%.',
  'Strength 61%; raw 0.61%; original 61%; extra 29%.'
]);
assert.equal(evaluated.results.find(result=>result.repKey==='sam').greeting,'Hi Sam: 36% / 90%.');

const strengthOnlyRules=rules.map(rule=>({...rule,individualMessage:{...rule.individualMessage,concern:{...rule.individualMessage.concern,enabled:false}}}));
const strengthOnly=engine.evaluateAll({...options,rules:strengthOnlyRules}).results.find(result=>result.repKey==='sean');
assert.equal(strengthOnly.status,'Ready');
assert.equal(strengthOnly.greeting,'Hi Sean: N/A / 72%.');

// Invalid numeric output blocks readiness rather than sending a broken template.
const invalidRule={id:'invalid',title:'Invalid',individualMessage:{concern:{enabled:true,sourceType:'legacy',source:'legacyRule',operator:'legacy',message:'Focus (OpportunityValue%100)',variables:[]},strength:{enabled:false}}};
const invalid=engine.evaluateAll({representatives:[representatives[0]],rosterRows,rules:[invalidRule],template:engine.DEFAULT_TEMPLATE,resolver:{resolveObservation(){ return {matched:true,raw:'unavailable',formatted:'unavailable'}; },resolveVariable(){ return {missing:true}; }}}).results[0];
assert.equal(invalid.status,'Template Error'); assert.equal(invalid.sendReady,false); assert.match(invalid.errors.join(' '),/Invalid Percentage Value/);

// Exercise the rebuilt carrier's embedded engine, not only the source module.
const carrierContext={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../qualtrics/generator-source.js'),'utf8'),carrierContext);
const generator=carrierContext.window.__ALLSTAR_QUALTRICS_GENERATOR_HTML__;
const embedded=generator.match(/<script data-qualtrics-source="qualtrics\/individual-messages\.js">([\s\S]*?)<\/script>/);
assert.ok(embedded,'the carrier must include the updated message engine');
const embeddedContext={}; vm.runInNewContext(embedded[1],embeddedContext);
assert.equal(embeddedContext.QualtricsIndividualMessages.replaceVariables('(OpportunityValue%100)',{OpportunityValue:.436}).text,'43.6%');
assert.equal(embeddedContext.QualtricsIndividualMessages.evaluateAll(options).results.find(result=>result.repKey==='sean').message,sean.message);
assert.ok(generator.includes('(StrengthValue%100)')&&generator.includes('(OpportunityValue%100)'),'the Rules help must document the exact new placeholders');
const portable=fs.readFileSync(path.join(__dirname,'../dist/All-Star-Portable.html'),'utf8');
assert.ok(portable.includes('function percentageNumber(input)'),'portable output must carry the same formatter');

(async()=>{
  const asyncEvaluated=await engine.evaluateAllAsync({...options,chunkSize:1,yieldToBrowser:async()=>{}});
  assert.deepEqual(asyncEvaluated.results.map(result=>({message:result.message,status:result.status})),evaluated.results.map(result=>({message:result.message,status:result.status})), 'chunked mass-message generation must match synchronous previews');
  console.log('PASS Qualtrics explicit percentage tokens, raw observations, saved rules, wrappers, mass messages, readiness, and portable carrier');
})().catch(error=>{ console.error(error); process.exitCode=1; });
