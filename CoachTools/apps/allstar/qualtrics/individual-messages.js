/*
 * Qualtrics Individual Messages
 * Pure evaluation engine used by the browser UI and Node-based regression tests.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  if(root) root.QualtricsIndividualMessages=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const SCHEMA_VERSION=1;
  const DEFAULT_TEMPLATE=Object.freeze({
    header:'Hi (FirstName),',
    concernHeading:'Area to Focus On',
    strengthHeading:'Great Work',
    footer:'Keep up the progress, and please reach out to your Job Coach if you have any questions.',
    includeNeither:false
  });
  const BUILT_INS=Object.freeze([
    'FirstName','LastName','FullName','Email','ConcernName','ConcernValue','ConcernThreshold',
    'StrengthName','StrengthValue','StrengthThreshold','CoachName'
  ]);

  function cleanText(value){ return String(value==null?'':value).trim(); }
  function normalizeName(value){
    return cleanText(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'');
  }
  function splitName(value){
    const parts=cleanText(value).replace(/\s+/g,' ').split(' ').filter(Boolean);
    return {firstName:parts[0]||'',lastName:parts.length>1?parts[parts.length-1]:'',fullName:parts.join(' ')};
  }
  function key(value){ return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g,''); }
  function findHeader(row,aliases){
    const headers=Object.keys(row||{}), wanted=aliases.map(key);
    return headers.find(header=>wanted.includes(key(header)))||headers.find(header=>wanted.some(alias=>key(header).includes(alias)||alias.includes(key(header))))||'';
  }
  function rosterRows(rows){
    const entries=[];
    for(const row of Array.isArray(rows)?rows:[]){
      const firstHeader=findHeader(row,['First Name','FirstName','Given Name']);
      const lastHeader=findHeader(row,['Last Name','LastName','Surname','Family Name']);
      const emailHeader=findHeader(row,['Username','User Name','Email','Email Address','Work Email']);
      const firstName=cleanText(firstHeader?row[firstHeader]:'');
      const lastName=cleanText(lastHeader?row[lastHeader]:'');
      const email=cleanText(emailHeader?row[emailHeader]:'');
      const fullName=[firstName,lastName].filter(Boolean).join(' ');
      const normalizedName=normalizeName(fullName);
      if(!normalizedName) continue;
      entries.push({firstName,lastName,fullName,email,normalizedName,row});
    }
    return entries;
  }
  function buildRosterIndex(rows){
    const entries=rosterRows(rows), byName=new Map();
    for(const entry of entries){
      if(!byName.has(entry.normalizedName)) byName.set(entry.normalizedName,[]);
      byName.get(entry.normalizedName).push(entry);
    }
    return {entries,byName};
  }
  function matchRosterName(name,index){
    const normalizedName=normalizeName(name), matches=index?.byName?.get(normalizedName)||[];
    if(matches.length>1) return {status:'ambiguous',normalizedName,matches,email:'',entry:null};
    if(!matches.length) return {status:'unmatched',normalizedName,matches:[],email:'',entry:null};
    const entry=matches[0];
    if(!entry.email||!/@/.test(entry.email)) return {status:'missingEmail',normalizedName,matches,email:entry.email||'',entry};
    return {status:'matched',normalizedName,matches,email:entry.email,entry};
  }

  function normalizeVariable(raw){
    raw=raw||{};
    return {
      name:cleanText(raw.name).replace(/^\(|\)$/g,''),
      sourceType:raw.sourceType==='reportField'?'reportField':'stat',
      source:cleanText(raw.source),
      field:cleanText(raw.field),
      format:['raw','number','percent','duration','text'].includes(raw.format)?raw.format:'raw'
    };
  }
  function normalizeSide(raw,defaults){
    raw=raw||{}; defaults=defaults||{};
    const variables=(Array.isArray(raw.variables)?raw.variables:[]).map(normalizeVariable).filter(variable=>variable.name);
    return {
      enabled:raw.enabled==null?!!defaults.enabled:!!raw.enabled,
      sourceType:['legacy','stat','reportField'].includes(raw.sourceType)?raw.sourceType:(defaults.sourceType||'stat'),
      source:cleanText(raw.source||defaults.source),
      field:cleanText(raw.field||defaults.field),
      operator:['legacy','lt','lte','gt','gte','eq','neq','between'].includes(raw.operator)?raw.operator:(defaults.operator||'lt'),
      threshold:cleanText(raw.threshold||defaults.threshold),
      threshold2:cleanText(raw.threshold2||defaults.threshold2),
      message:cleanText(raw.message||defaults.message),
      variables
    };
  }
  function normalizeRuleConfig(rule){
    rule=rule||{};
    const existing=rule.individualMessage||rule.individualMessages||null;
    const defaultConcernMessage=cleanText(rule.concernMessage)||'Your current (ConcernName) result is (ConcernValue). Please review this area with your Job Coach.';
    const concern=normalizeSide(existing?.concern,{
      enabled:true,sourceType:'legacy',source:'legacyRule',operator:'legacy',message:defaultConcernMessage
    });
    const strength=normalizeSide(existing?.strength,{
      enabled:false,sourceType:'stat',source:concern.sourceType==='stat'?concern.source:'',field:concern.field,operator:'gte',message:''
    });
    return {schemaVersion:SCHEMA_VERSION,concern,strength};
  }
  function normalizeRule(rule){
    const copy=Object.assign({},rule||{});
    copy.individualMessage=normalizeRuleConfig(copy);
    return copy;
  }
  function normalizeTemplate(raw){
    raw=raw||{};
    return {
      header:raw.header==null?DEFAULT_TEMPLATE.header:cleanText(raw.header),
      concernHeading:raw.concernHeading==null?DEFAULT_TEMPLATE.concernHeading:cleanText(raw.concernHeading),
      strengthHeading:raw.strengthHeading==null?DEFAULT_TEMPLATE.strengthHeading:cleanText(raw.strengthHeading),
      footer:raw.footer==null?DEFAULT_TEMPLATE.footer:cleanText(raw.footer),
      includeNeither:!!raw.includeNeither
    };
  }

  function numeric(value,percentContext){
    if(typeof value==='number') return Number.isFinite(value)?value:NaN;
    const raw=cleanText(value); if(!raw) return NaN;
    const percent=/%/.test(raw)||percentContext;
    const parsed=Number(raw.replace(/[$,%\s,]/g,'').replace(/[^0-9.\-]/g,''));
    if(!Number.isFinite(parsed)) return NaN;
    return percent&&Math.abs(parsed)>1.5?parsed/100:parsed;
  }
  function thresholdValue(raw,observation){
    const pct=!!observation?.isPercent||/%/.test(cleanText(raw));
    return numeric(raw,pct);
  }
  function compareObservation(observation,side){
    if(side.operator==='legacy'){
      if(observation?.missing) return {pass:false,missing:true,score:0,reason:observation.reason||'Existing rule could not be evaluated'};
      const pass=!!observation?.matched;
      return {pass,missing:false,score:pass?Math.max(0,Number(observation.score)||1):0,reason:pass?'Existing rule matched':'Existing rule did not match'};
    }
    if(!observation||observation.missing) return {pass:false,missing:true,score:0,reason:observation?.reason||'Metric value is missing'};
    const value=Number.isFinite(observation.value)?observation.value:numeric(observation.raw,observation.isPercent);
    const a=thresholdValue(side.threshold,observation), b=thresholdValue(side.threshold2,observation);
    if((side.operator==='eq'||side.operator==='neq')&&!Number.isFinite(value)){
      const actual=cleanText(observation.raw).toLowerCase(), expected=cleanText(side.threshold).toLowerCase();
      if(!actual) return {pass:false,missing:true,score:0,reason:'Metric value is missing'};
      if(!expected) return {pass:false,missing:true,score:0,reason:'Threshold is missing or invalid'};
      const equal=actual===expected, pass=side.operator==='eq'?equal:!equal;
      return {pass,missing:false,score:pass?100:0,reason:pass?'Condition passed':'Condition failed',value:observation.raw,threshold:side.threshold};
    }
    if(!Number.isFinite(value)) return {pass:false,missing:true,score:0,reason:'Metric value is not numeric'};
    if(!Number.isFinite(a)) return {pass:false,missing:true,score:0,reason:'Threshold is missing or invalid'};
    let pass=false, distance=0, denominator=Math.max(Math.abs(a),1e-9);
    if(side.operator==='lt'){ pass=value<a; distance=a-value; }
    else if(side.operator==='lte'){ pass=value<=a; distance=a-value; }
    else if(side.operator==='gt'){ pass=value>a; distance=value-a; }
    else if(side.operator==='gte'){ pass=value>=a; distance=value-a; }
    else if(side.operator==='eq'){ pass=Math.abs(value-a)<1e-9; distance=pass?denominator:0; }
    else if(side.operator==='neq'){ pass=Math.abs(value-a)>=1e-9; distance=pass?Math.abs(value-a):0; }
    else if(side.operator==='between'){
      if(!Number.isFinite(b)) return {pass:false,missing:true,score:0,reason:'Second Between threshold is missing or invalid'};
      const low=Math.min(a,b), high=Math.max(a,b); pass=value>=low&&value<=high;
      distance=pass?Math.min(value-low,high-value):0; denominator=Math.max(high-low,1e-9);
    }
    const score=pass?Math.max(0,distance/denominator*100):0;
    return {pass,missing:false,score:Number(score.toFixed(6)),reason:pass?'Condition passed':'Condition failed',value,threshold:a,threshold2:b};
  }
  function operatorLabel(operator){
    return ({legacy:'existing rule result',lt:'<',lte:'<=',gt:'>',gte:'>=',eq:'=',neq:'!=',between:'Between'})[operator]||operator;
  }
  function conditionLabel(side){
    if(side.operator==='legacy') return 'existing rule result';
    return `${operatorLabel(side.operator)} ${side.threshold||'—'}${side.operator==='between'?` and ${side.threshold2||'—'}`:''}`;
  }

  function formatDuration(value){
    const numericValue=Number(value)||0, seconds=Math.max(0,Math.round(numericValue>0&&numericValue<1?numericValue*86400:numericValue));
    return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
  }
  function formatValue(value,format,isPercent){
    const raw=value?.formatted!=null?value.formatted:(value?.raw!=null?value.raw:value?.value);
    const number=Number.isFinite(value?.value)?value.value:numeric(raw,isPercent||value?.isPercent);
    if(format==='text'||format==='raw') return cleanText(raw);
    if(format==='duration') return Number.isFinite(number)?formatDuration(number):cleanText(raw);
    if(format==='percent'){
      if(!Number.isFinite(number)) return cleanText(raw);
      const fraction=Math.abs(number)>1.5?number/100:number;
      return `${(fraction*100).toFixed(1).replace(/\.0$/,'')}%`;
    }
    if(format==='number') return Number.isFinite(number)?Number(number.toFixed(2)).toLocaleString():cleanText(raw);
    if(value?.formatted!=null) return cleanText(value.formatted);
    if(value?.isPercent&&Number.isFinite(number)) return `${(number*100).toFixed(1).replace(/\.0$/,'')}%`;
    return Number.isFinite(number)?String(Number(number.toFixed(4))):cleanText(raw);
  }
  function observationDisplay(observation){
    if(!observation||observation.missing) return 'N/A';
    return formatValue(observation,'raw',observation.isPercent)||'N/A';
  }

  function replaceVariables(template,values,knownNames){
    const errors=[], lookup=new Map();
    for(const [name,value] of Object.entries(values||{})) lookup.set(key(name),value==null?'':String(value));
    const known=new Set((knownNames||[]).map(key));
    const text=cleanText(template).replace(/\(([A-Za-z][A-Za-z0-9_]*)\)/g,function(token,name){
      const normalized=key(name);
      if(lookup.has(normalized)) return lookup.get(normalized);
      if(known.has(normalized)) return '';
      errors.push(`Unresolved Variable: ${name}`); return token;
    });
    return {text,errors:[...new Set(errors)]};
  }
  function valuesForResult(rep,emailMatch,concern,strength){
    const names=splitName(rep.fullName||rep.name||rep.repName||'');
    return {
      FirstName:names.firstName,LastName:names.lastName,FullName:names.fullName,
      Email:emailMatch?.email||'',CoachName:rep.coach||rep.coachName||'',
      ConcernName:concern?.title||'',ConcernValue:observationDisplay(concern?.observation),ConcernThreshold:concern?.side?.threshold||'',
      StrengthName:strength?.title||'',StrengthValue:observationDisplay(strength?.observation),StrengthThreshold:strength?.side?.threshold||''
    };
  }
  function resolveMessage(sideName,candidate,rep,emailMatch,baseValues,resolver){
    if(!candidate) return {text:'',errors:[]};
    const side=candidate.side, errors=[], values=Object.assign({},baseValues), known=BUILT_INS.slice();
    if(!side.message) errors.push(`Missing ${sideName} message`);
    for(const variable of side.variables||[]){
      known.push(variable.name);
      const observation=resolver.resolveVariable(rep,variable,candidate.rule,sideName,candidate);
      if(!observation||observation.missing){ errors.push(`Unresolved Variable: ${variable.name}`); continue; }
      values[variable.name]=formatValue(observation,variable.format,observation.isPercent);
    }
    const rendered=replaceVariables(side.message,values,known);
    return {text:rendered.text,errors:[...new Set(errors.concat(rendered.errors))]};
  }
  function rankCandidates(candidates){
    return candidates.slice().sort(function(a,b){
      return (b.score-a.score)||(a.ruleIndex-b.ruleIndex)||String(a.rule?.title||'').localeCompare(String(b.rule?.title||''))||String(a.rule?.id||'').localeCompare(String(b.rule?.id||''));
    });
  }
  function evaluateRepresentative(rep,rules,rosterIndex,resolver,template){
    rules=(rules||[]).map(normalizeRule); template=normalizeTemplate(template);
    const fullName=rep.fullName||rep.name||rep.repName||'', emailMatch=matchRosterName(fullName,rosterIndex);
    const diagnostics=[], concerns=[], strengths=[];
    rules.forEach(function(rule,ruleIndex){
      ['concern','strength'].forEach(function(sideName){
        const side=rule.individualMessage[sideName];
        if(!side.enabled){ diagnostics.push({ruleId:rule.id,ruleTitle:rule.title,side:sideName,enabled:false,pass:false,missing:false,score:0,condition:conditionLabel(side),reason:'Disabled'}); return; }
        const observation=resolver.resolveObservation(rep,side,rule,sideName);
        const evaluation=compareObservation(observation,side);
        const diagnostic={ruleId:rule.id,ruleTitle:rule.title,side:sideName,enabled:true,pass:evaluation.pass,missing:evaluation.missing,score:evaluation.score,condition:conditionLabel(side),reason:evaluation.reason,observation,value:observationDisplay(observation)};
        diagnostics.push(diagnostic);
        if(evaluation.pass){
          const candidate={rule,ruleIndex,title:rule.title||side.source||side.field||sideName,sideName,side,observation,score:evaluation.score,diagnostic};
          (sideName==='concern'?concerns:strengths).push(candidate);
        }
      });
    });
    const concern=rankCandidates(concerns)[0]||null, strength=rankCandidates(strengths)[0]||null;
    const baseValues=valuesForResult(Object.assign({},rep,{fullName}),emailMatch,concern,strength);
    const concernMessage=resolveMessage('Concern',concern,rep,emailMatch,baseValues,resolver);
    const strengthMessage=resolveMessage('Strength',strength,rep,emailMatch,baseValues,resolver);
    const wrapperParts=[replaceVariables(template.header,baseValues,BUILT_INS)];
    if(concern){ wrapperParts.push(replaceVariables(template.concernHeading,baseValues,BUILT_INS),concernMessage); }
    if(strength){ wrapperParts.push(replaceVariables(template.strengthHeading,baseValues,BUILT_INS),strengthMessage); }
    wrapperParts.push(replaceVariables(template.footer,baseValues,BUILT_INS));
    const errors=[...new Set(wrapperParts.flatMap(part=>part.errors||[]))];
    const sections=[];
    if(wrapperParts[0].text) sections.push(wrapperParts[0].text);
    let position=1;
    if(concern){ const heading=wrapperParts[position++].text; const message=wrapperParts[position++].text; if(heading) sections.push(heading); if(message) sections.push(message); }
    if(strength){ const heading=wrapperParts[position++].text; const message=wrapperParts[position++].text; if(heading) sections.push(heading); if(message) sections.push(message); }
    const footer=wrapperParts[wrapperParts.length-1].text; if(footer) sections.push(footer);
    const hasBehavior=!!(concern||strength), anyMissingMetric=diagnostics.some(item=>item.enabled&&item.missing);
    let status='Ready';
    if(emailMatch.status==='ambiguous') status='Ambiguous Email';
    else if(emailMatch.status!=='matched') status='Missing Email';
    else if(errors.length) status='Template Error';
    else if(!hasBehavior) status=anyMissingMetric?'Missing Metric':'No Qualifying Behavior';
    const sendReady=status==='Ready'&&hasBehavior;
    return {
      repKey:rep.repKey||rep.key||normalizeName(fullName),fullName,email:emailMatch.email||'',emailMatch,
      coach:rep.coach||rep.coachName||'',concern,strength,diagnostics,errors,status,sendReady,
      message:hasBehavior||template.includeNeither?sections.join('\n\n'):'',
      selectionReason:{
        concern:concern?'Highest normalized Concern severity among qualifying rules.':'No Concern threshold was crossed.',
        strength:strength?'Highest normalized Strength score among qualifying rules.':'No Strength threshold was crossed.'
      }
    };
  }
  function summarize(results){
    const summary={evaluated:results.length,matched:0,unmatched:0,ambiguous:0,ready:0,concern:0,strength:0,both:0,neither:0,templateErrors:0,missingMetrics:0};
    for(const result of results){
      if(result.emailMatch.status==='matched') summary.matched++;
      else if(result.emailMatch.status==='ambiguous') summary.ambiguous++;
      else summary.unmatched++;
      if(result.sendReady) summary.ready++;
      if(result.concern) summary.concern++;
      if(result.strength) summary.strength++;
      if(result.concern&&result.strength) summary.both++;
      if(!result.concern&&!result.strength) summary.neither++;
      if(result.status==='Template Error') summary.templateErrors++;
      if(result.status==='Missing Metric') summary.missingMetrics++;
    }
    return summary;
  }
  function evaluateAll(options){
    options=options||{};
    if(!options.resolver||typeof options.resolver.resolveObservation!=='function'||typeof options.resolver.resolveVariable!=='function') throw new Error('An Individual Message data resolver is required.');
    const index=buildRosterIndex(options.rosterRows||[]);
    const results=(options.representatives||[]).map(rep=>evaluateRepresentative(rep,options.rules||[],index,options.resolver,options.template));
    results.sort((a,b)=>String(a.fullName).localeCompare(String(b.fullName)));
    return {rosterIndex:index,results,summary:summarize(results)};
  }
  function filterResult(result,filter){
    if(!filter||filter==='all') return true;
    if(filter==='ready') return result.sendReady;
    if(filter==='hasConcern') return !!result.concern;
    if(filter==='hasStrength') return !!result.strength;
    if(filter==='both') return !!result.concern&&!!result.strength;
    if(filter==='concernOnly') return !!result.concern&&!result.strength;
    if(filter==='strengthOnly') return !result.concern&&!!result.strength;
    if(filter==='neither') return !result.concern&&!result.strength;
    if(filter==='missingEmail') return result.status==='Missing Email';
    if(filter==='ambiguous') return result.status==='Ambiguous Email';
    if(filter==='templateError') return result.status==='Template Error';
    if(filter==='missingMetric') return result.status==='Missing Metric';
    return true;
  }

  return {
    SCHEMA_VERSION,DEFAULT_TEMPLATE,BUILT_INS,normalizeName,splitName,rosterRows,buildRosterIndex,matchRosterName,
    normalizeVariable,normalizeSide,normalizeRuleConfig,normalizeRule,normalizeTemplate,numeric,compareObservation,
    operatorLabel,conditionLabel,formatValue,replaceVariables,evaluateRepresentative,evaluateAll,summarize,filterResult
  };
});
