#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../qualtrics/generator.html'),'utf8');
function section(start,end){ const from=html.indexOf(start); assert.ok(from>=0,start); const to=html.indexOf(end,from); assert.ok(to>from,end); return html.slice(from,to); }
const escape=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const state={rules:[]};
const context=vm.createContext({state,esc:escape,sanitizeRichHtml:value=>value,splitCoachingTypes:value=>String(value||'').split('|').map(value=>value.trim()),textMatch:(value,phrase)=>String(value).toLowerCase()===String(phrase).toLowerCase()});
vm.runInContext(section('function splitListInput','function findHeaderPreferred')+section('function ccNormalizePhraseList','const normalizeRuleBeforeCoachingPhrases')+section('function ccPhrasePrepared','const buildCoachingCorrectiveRecordsBeforePhrases')+section('function coachingMatchInfo','function coachingRowMatchesRule')+section('function simpleQualtricsCoachingRequirementsHtml','function simpleQualtricsAverage'),context);
function render(rule){return context.simpleQualtricsCoachingRequirementsHtml(rule);}
function matches(rule,row){return context.coachingMatchInfo(row,rule).matches;}
const descriptionRule={id:'description',coaching:{mode:'descriptionContains',typeValue:'Inactive type',descriptionPhrases:['assumptive language','ask & <confirm>']},guidance:{html:'<p>Coach an assumptive next step.</p>'}};
let output=render(descriptionRule);
assert.match(output,/ANY description phrase/); assert.match(output,/assumptive language/); assert.match(output,/ask &amp; &lt;confirm&gt;/); assert.ok(!output.includes('Inactive type'));
assert.equal(matches(descriptionRule,{type:'assumptive language',desc:'Other subject'}),false,'description pills cannot be satisfied by the type field');
assert.equal(matches(descriptionRule,{desc:'Discuss using assumptive language'}),true);
state.rules=[descriptionRule];output=context.simpleQualtricsRuleDescription({rows:[{ruleId:'description'}]});
assert.ok(output.indexOf('Coach an assumptive next step.')<output.indexOf('coachingRequirementPills'),'pills follow the rule description inside Breakdown');
const combined={coaching:{mode:'typeOrDescription',typeValue:'Sales | Soft Skills',descriptionPhrases:['confirm next step']}};
output=render(combined); assert.match(output,/ANY coaching type/);assert.match(output,/ANY description phrase/);assert.match(output,/type OR description phrase qualifies/);
assert.equal(matches(combined,{type:'Sales',desc:''}),true);assert.equal(matches(combined,{type:'Other',desc:'confirm next step'}),true);
const typeOnly={coaching:{mode:'type',typeValue:'Sales',descriptionPhrases:['inactive phrase']}};
assert.match(render(typeOnly),/Sales/);assert.ok(!render(typeOnly).includes('inactive phrase'));
assert.equal(render({coaching:{mode:'none',typeValue:'Sales',descriptionPhrases:['ignored']},coachingImpact:{topicPhrases:['inferred only']}}),'','inactive fields must not appear as requirements');
assert.equal(render({coachingImpact:{topicName:'inferred topic',topicPhrases:['not a registration rule']}}),'','impact-topic hints are not coaching registration requirements');
const corrective={ruleType:'coachingCorrective',coachingCorrective:{coachingMatch:'contains',coachingPhrases:['assumptive language','next step'],coachingPhraseLogic:'and',coachingCaseInsensitive:false,coachingExactPhrase:true,coachingNormalizeSpacing:false}};
output=render(corrective);for(const label of ['ALL phrases required','Case-sensitive','Exact phrase boundaries','Original spacing'])assert.ok(output.includes(label));
assert.equal(matches(corrective,{type:'',searchText:'assumptive language'}),false);assert.equal(matches(corrective,{type:'',searchText:'assumptive language and next step'}),true);
corrective.coachingCorrective.coachingPhraseLogic='or';assert.match(render(corrective),/ANY phrase matches/);assert.equal(matches(corrective,{type:'',searchText:'assumptive language'}),true);
corrective.coachingCorrective={coachingMatch:'equals',coachingTopic:'Sales',coachingPhrases:['inactive phrase']};
assert.match(render(corrective),/Exact coaching type/);assert.ok(!render(corrective).includes('inactive phrase'));assert.equal(matches(corrective,{type:'Sales'}),true);assert.equal(matches(corrective,{type:'Sales Call'}),false);
assert.equal(render({ruleType:'coachingCorrective',coachingCorrective:{coachingMatch:'equals',coachingTopic:''}}),'');
assert.equal(render(null),'');assert.equal(context.simpleQualtricsRuleDescription({ruleId:'deleted'}),'<span style="color:#94a3b8">—</span>');
console.log('PASS coaching keyword pills: field-scoped rules, type/phrase alternatives, corrective ANY/ALL, exact/case/spacing, escaping, and Breakdown placement');
