#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const engine=require('../qualtrics/individual-messages.js');

function side(overrides={}){ return {enabled:true,sourceType:'stat',source:'metric',operator:'lt',threshold:'45%',threshold2:'',message:'Value (X) for (FullName)',variables:[{name:'X',sourceType:'stat',source:'metric',format:'percent'}],...overrides}; }
function rule(id,concern,strength){ return {id,title:id,criteria:[{header:'Example'}],individualMessage:{concern:concern||side(),strength:strength||side({enabled:false,operator:'gte',threshold:'55%'})}}; }
function resolver(values={},variableValues={}){
  return {
    resolveObservation(rep,config,currentRule){ const value=values[`${rep.repKey}:${currentRule.id}:${config.source||config.field}`]; return value==null?{missing:true,reason:'missing'}:{value,raw:value,formatted:config.source==='rate'?`${value*100}%`:String(value),label:config.source||config.field,isPercent:config.source==='rate'||config.source==='metric'}; },
    resolveVariable(rep,variable,currentRule){ const lookup=variableValues[`${rep.repKey}:${currentRule.id}:${variable.source||variable.field}`]; const value=lookup==null?values[`${rep.repKey}:${currentRule.id}:${variable.source||variable.field}`]:lookup; return value==null?{missing:true}:{value,raw:value,formatted:String(value),label:variable.source||variable.field,isPercent:variable.format==='percent'}; }
  };
}
const roster=[
  {'First Name':'John','Last Name':'Smith','Username':'john.smith@example.com'},
  {'First Name':'Sarah','Last Name':'Jones','Username':'sarah.jones@example.com'}
];

// Legacy migration preserves concern behavior and never invents an enabled Strength.
const legacy={id:'legacy',title:'Legacy Rule',criteria:[{header:'A'}]};
const migrated=engine.normalizeRule(legacy);
assert.equal(migrated.individualMessage.concern.enabled,true);
assert.equal(migrated.individualMessage.concern.sourceType,'legacy');
assert.equal(migrated.individualMessage.strength.enabled,false);
assert.deepEqual(legacy,{id:'legacy',title:'Legacy Rule',criteria:[{header:'A'}]},'normalization must not mutate the existing bulk rule');

// Comparison coverage, including the neutral gap and missing values.
assert.equal(engine.compareObservation({value:.44,isPercent:true},side({operator:'lt',threshold:'45%'})).pass,true);
assert.equal(engine.compareObservation({value:.45,isPercent:true},side({operator:'lt',threshold:'45%'})).pass,false);
assert.equal(engine.compareObservation({value:.50,isPercent:true},side({operator:'between',threshold:'45%',threshold2:'55%'})).pass,true);
assert.equal(engine.compareObservation({missing:true},side()).pass,false);
assert.equal(engine.compareObservation({missing:true},side()).missing,true);
assert.equal(engine.compareObservation({value:.50,isPercent:true},side({operator:'lt',threshold:'45%'})).pass,false);
assert.equal(engine.compareObservation({value:.50,isPercent:true},side({operator:'gte',threshold:'55%'})).pass,false,'failing Concern must not imply Strength');
assert.equal(engine.formatValue({value:0.0083333333,raw:0.0083333333},'duration',false),'12:00');
assert.deepEqual({maxConcerns:engine.normalizeTemplate({maxConcerns:'2'}).maxConcerns,maxStrengths:engine.normalizeTemplate({maxStrengths:'3'}).maxStrengths},{maxConcerns:2,maxStrengths:3});
assert.equal(engine.normalizeTemplate({maxConcerns:'0',maxStrengths:'not a number'}).maxStrengths,0,'invalid or zero maximums retain every finding');

const rep={repKey:'john',fullName:'JOHN   SMITH',coach:'Pat Coach'};
const concernRule=rule('Appointment Rate',side({source:'rate',operator:'lt',threshold:'45%',message:'Your rate is (Rate).',variables:[{name:'Rate',sourceType:'stat',source:'rate',format:'percent'}]}),side({source:'rate',enabled:true,operator:'gte',threshold:'55%',message:'Strong rate (Rate).',variables:[{name:'Rate',sourceType:'stat',source:'rate',format:'percent'}]}));
let result=engine.evaluateAll({representatives:[rep],rules:[concernRule],rosterRows:roster,resolver:resolver({'john:Appointment Rate:rate':.40}),template:engine.DEFAULT_TEMPLATE}).results[0];
assert.equal(result.status,'Ready');
assert.ok(result.concern);
assert.equal(result.strength,null);
assert.match(result.message,/Hi JOHN,/);
assert.match(result.message,/Your rate is 40%/);
assert.match(result.message,/john\.smith@example\.com|Area to Focus On/);

result=engine.evaluateAll({representatives:[rep],rules:[concernRule],rosterRows:roster,resolver:resolver({'john:Appointment Rate:rate':.60}),template:engine.DEFAULT_TEMPLATE}).results[0];
assert.equal(result.concern,null);
assert.ok(result.strength);
assert.equal(result.status,'Ready');

result=engine.evaluateAll({representatives:[rep],rules:[concernRule],rosterRows:roster,resolver:resolver({'john:Appointment Rate:rate':.50}),template:engine.DEFAULT_TEMPLATE}).results[0];
assert.equal(result.concern,null); assert.equal(result.strength,null); assert.equal(result.status,'No Qualifying Behavior'); assert.equal(result.message,'');

// A representative can have both outcomes from different rules.
const qaRule=rule('QA',side({source:'qa',operator:'lt',threshold:'85',message:'QA focus (ConcernValue)',variables:[]}),side({enabled:false}));
const salesRule=rule('Sales',side({enabled:false}),side({source:'sales',enabled:true,operator:'gte',threshold:'20',message:'Sales strength (StrengthValue)',variables:[]}));
result=engine.evaluateAll({representatives:[rep],rules:[qaRule,salesRule],rosterRows:roster,resolver:resolver({'john:QA:qa':80,'john:Sales:sales':30}),template:engine.DEFAULT_TEMPLATE}).results[0];
assert.ok(result.concern&&result.strength); assert.equal(result.status,'Ready');

// Finding order uses the observed rule volume, with normalized distance as a tie-breaker.
const smallRaw=rule('Small Raw',side({source:'small',operator:'lt',threshold:'.45',message:'small',variables:[]}),side({enabled:false}));
const largeRaw=rule('Large Raw',side({source:'large',operator:'lt',threshold:'10',message:'large',variables:[]}),side({enabled:false}));
result=engine.evaluateAll({representatives:[rep],rules:[smallRaw,largeRaw],rosterRows:roster,resolver:resolver({'john:Small Raw:small':.40,'john:Large Raw:large':5}),template:engine.DEFAULT_TEMPLATE}).results[0];
assert.equal(result.concern.title,'Large Raw','the highest observed Concern volume wins');
const hugeStrength=rule('Huge Raw',side({enabled:false}),side({source:'huge',enabled:true,operator:'gte',threshold:'90',message:'huge',variables:[]}));
const rateStrength=rule('Rate Strength',side({enabled:false}),side({source:'betterRate',enabled:true,operator:'gte',threshold:'.55',message:'rate',variables:[]}));
result=engine.evaluateAll({representatives:[rep],rules:[hugeStrength,rateStrength],rosterRows:roster,resolver:resolver({'john:Huge Raw:huge':100,'john:Rate Strength:betterRate':.70}),template:engine.DEFAULT_TEMPLATE}).results[0];
assert.equal(result.strength.title,'Huge Raw','the highest observed Strength volume wins');
const tieA=rule('A tie',side({source:'a',threshold:'10',message:'a',variables:[]}),side({enabled:false}));
const tieB=rule('B tie',side({source:'b',threshold:'20',message:'b',variables:[]}),side({enabled:false}));
result=engine.evaluateAll({representatives:[rep],rules:[tieA,tieB],rosterRows:roster,resolver:resolver({'john:A tie:a':5,'john:B tie:b':10}),template:engine.DEFAULT_TEMPLATE}).results[0];
assert.equal(result.concern.title,'B tie','observed volume wins when normalized severity is tied');
const sameVolumeA=rule('First same-volume rule',side({source:'sameA',threshold:'10',message:'first',variables:[]}),side({enabled:false}));
const sameVolumeB=rule('Second same-volume rule',side({source:'sameB',threshold:'10',message:'second',variables:[]}),side({enabled:false}));
result=engine.evaluateAll({representatives:[rep],rules:[sameVolumeA,sameVolumeB],rosterRows:roster,resolver:resolver({'john:First same-volume rule:sameA':5,'john:Second same-volume rule:sameB':5}),template:engine.DEFAULT_TEMPLATE}).results[0];
assert.equal(result.concern.title,'First same-volume rule','equal volume and severity resolve deterministically by rule order');

// Per-message maximums keep only the highest-volume findings while diagnostics retain every rule.
const discounts=rule('Discounts',side({source:'discounts',operator:'gte',threshold:'1',message:'Discount need.',variables:[]}),side({enabled:false}));
const insuranceSkip=rule('Skipping Insurance Cash',side({source:'insuranceSkip',operator:'gte',threshold:'1',message:'Insurance Cash need.',variables:[]}),side({enabled:false}));
const afterpay=rule('Afterpay',side({source:'afterpay',operator:'gte',threshold:'1',message:'Afterpay need.',variables:[]}),side({enabled:false}));
result=engine.evaluateAll({representatives:[rep],rules:[afterpay,discounts,insuranceSkip],rosterRows:roster,resolver:resolver({'john:Afterpay:afterpay':4,'john:Discounts:discounts':16,'john:Skipping Insurance Cash:insuranceSkip':12}),template:{...engine.DEFAULT_TEMPLATE,maxConcerns:2}}).results[0];
assert.deepEqual(result.concerns.map(item=>item.title),['Discounts','Skipping Insurance Cash'],'the maximum includes the two highest-volume weaknesses in order');
assert.equal(result.qualifyingConcernCount,3,'the full qualifying count remains available for review');
assert.equal(result.concernMessages.length,2); assert.doesNotMatch(result.message,/Afterpay need/);
assert.equal(result.diagnostics.filter(item=>item.side==='concern'&&item.pass).length,3,'diagnostics retain capped findings');
const coaching=rule('Coaching Follow-through',side({enabled:false}),side({source:'coaching',enabled:true,operator:'gte',threshold:'1',message:'Coaching strength.',variables:[]}));
const quality=rule('Call Quality',side({enabled:false}),side({source:'quality',enabled:true,operator:'gte',threshold:'1',message:'Quality strength.',variables:[]}));
const rapport=rule('Rapport',side({enabled:false}),side({source:'rapport',enabled:true,operator:'gte',threshold:'1',message:'Rapport strength.',variables:[]}));
result=engine.evaluateAll({representatives:[rep],rules:[coaching,quality,rapport],rosterRows:roster,resolver:resolver({'john:Coaching Follow-through:coaching':7,'john:Call Quality:quality':15,'john:Rapport:rapport':10}),template:{...engine.DEFAULT_TEMPLATE,maxStrengths:2}}).results[0];
assert.deepEqual(result.strengths.map(item=>item.title),['Call Quality','Rapport'],'the maximum includes the two highest-volume strengths in order');
assert.equal(result.qualifyingStrengthCount,3); assert.doesNotMatch(result.message,/Coaching strength/);

// Stat, report-field, and built-in variables all substitute; unknown variables block readiness.
const variableRule=rule('Variables',side({source:'countMetric',threshold:'50',message:'(FirstName) (FullName) (Email) stat=(S) field=(F)',variables:[{name:'S',sourceType:'stat',source:'statSource',format:'number'},{name:'F',sourceType:'reportField',field:'Offers',format:'raw'}]}),side({enabled:false}));
result=engine.evaluateAll({representatives:[rep],rules:[variableRule],rosterRows:roster,resolver:resolver({'john:Variables:countMetric':40},{'john:Variables:statSource':12.5,'john:Variables:Offers':'8 offers'}),template:engine.DEFAULT_TEMPLATE}).results[0];
assert.equal(result.status,'Ready'); assert.match(result.message,/JOHN JOHN SMITH john\.smith@example\.com stat=12\.5 field=8 offers/);
const badVariable=rule('Bad Variable',side({source:'countMetric',threshold:'50',message:'Missing (DOES_NOT_EXIST)',variables:[]}),side({enabled:false}));
result=engine.evaluateAll({representatives:[rep],rules:[badVariable],rosterRows:roster,resolver:resolver({'john:Bad Variable:countMetric':40}),template:engine.DEFAULT_TEMPLATE}).results[0];
assert.equal(result.status,'Template Error'); assert.match(result.errors.join(' '),/Unresolved Variable/); assert.equal(result.sendReady,false);

// Name matching tolerates case, whitespace, apostrophes, hyphens, and punctuation; duplicates are never guessed.
const matchIndex=engine.buildRosterIndex([
  {'First Name':'Anne-Marie','Last Name':"O'Neil",Username:'anne@example.com'},
  {'First Name':'Duplicate','Last Name':'Person',Username:'one@example.com'},
  {'First Name':'DUPLICATE','Last Name':'PERSON',Username:'two@example.com'}
]);
assert.equal(engine.matchRosterName('  ANNE MARIE O NEIL ',matchIndex).status,'matched');
assert.equal(engine.matchRosterName('Missing Person',matchIndex).status,'unmatched');
assert.equal(engine.matchRosterName('Duplicate Person',matchIndex).status,'ambiguous');

// Summary and filters cover all representative output categories.
const strengthOnly={...rep,repKey:'sarah',fullName:'Sarah Jones'};
const evaluated=engine.evaluateAll({representatives:[rep,strengthOnly],rules:[concernRule],rosterRows:roster,resolver:resolver({'john:Appointment Rate:rate':.40,'sarah:Appointment Rate:rate':.60}),template:engine.DEFAULT_TEMPLATE});
assert.equal(evaluated.summary.concern,1); assert.equal(evaluated.summary.strength,1); assert.equal(evaluated.summary.ready,2);
assert.equal(evaluated.results.filter(item=>engine.filterResult(item,'concernOnly')).length,1);
assert.equal(evaluated.results.filter(item=>engine.filterResult(item,'strengthOnly')).length,1);

console.log('PASS Qualtrics Individual Messages tests');
