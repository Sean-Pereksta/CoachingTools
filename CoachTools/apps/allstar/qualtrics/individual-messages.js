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
    includeNeither:false,
    includeGeneric:false,
    genericMessage:'',
    genericPlacement:'before',
    maxConcerns:0,
    maxStrengths:0
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
    const maximum=value=>{ const parsed=Math.floor(Number(value)); return Number.isFinite(parsed)&&parsed>0?Math.min(50,parsed):0; };
    return {
      header:raw.header==null?DEFAULT_TEMPLATE.header:cleanText(raw.header),
      concernHeading:raw.concernHeading==null?DEFAULT_TEMPLATE.concernHeading:cleanText(raw.concernHeading),
      strengthHeading:raw.strengthHeading==null?DEFAULT_TEMPLATE.strengthHeading:cleanText(raw.strengthHeading),
      footer:raw.footer==null?DEFAULT_TEMPLATE.footer:cleanText(raw.footer),
      includeNeither:!!raw.includeNeither,
      includeGeneric:!!raw.includeGeneric,
      genericMessage:cleanText(raw.genericMessage),
      genericPlacement:raw.genericPlacement==='after'?'after':'before',
      maxConcerns:maximum(raw.maxConcerns),
      maxStrengths:maximum(raw.maxStrengths)
    };
  }

  function scopeSet(value){ return value instanceof Set?value:new Set(Array.isArray(value)?value:[]); }
  function scopeKey(value){ return normalizeName(value); }
  function buildScopeIndex(representatives,organizations){
    const sourceOrganizations=(organizations||[]).map(function(raw,index){
      const id=cleanText(raw?.id||raw?.name)||`organization-${index+1}`, name=cleanText(raw?.name)||id;
      return {id,name,coachNames:[...new Set((raw?.coachNames||raw?.coaches||[]).map(cleanText).filter(Boolean))],coachKeys:new Set(),repKeys:new Set(),search:scopeKey(`${name} ${id}`)};
    });
    const organizationById=new Map(), organizationByName=new Map(), organizationsByCoach=new Map();
    for(const organization of sourceOrganizations){
      organizationById.set(organization.id,organization); organizationByName.set(scopeKey(organization.name),organization);
      for(const coachName of organization.coachNames){
        const coachKey=scopeKey(coachName); if(!coachKey) continue;
        organization.coachKeys.add(coachKey);
        if(!organizationsByCoach.has(coachKey)) organizationsByCoach.set(coachKey,new Set());
        organizationsByCoach.get(coachKey).add(organization.id);
      }
    }
    const repByKey=new Map(), coachByKey=new Map();
    for(const raw of representatives||[]){
      const fullName=cleanText(raw?.fullName||raw?.name||raw?.repName), repKey=cleanText(raw?.repKey||raw?.key)||normalizeName(fullName);
      if(!repKey||!fullName) continue;
      const coach=cleanText(raw?.coach||raw?.coachName), coachKey=scopeKey(coach), team=cleanText(raw?.team||raw?.teamName);
      const organizationIds=new Set();
      for(const value of [raw?.organizationId,raw?.organization,raw?.organizationName,raw?.org]){
        const direct=organizationById.get(cleanText(value))||organizationByName.get(scopeKey(value)); if(direct) organizationIds.add(direct.id);
      }
      for(const id of organizationsByCoach.get(coachKey)||[]) organizationIds.add(id);
      const organizationNames=[...organizationIds].map(id=>organizationById.get(id)?.name).filter(Boolean);
      const rep=Object.assign({},raw,{repKey,fullName,coach,coachKey,team,organizationIds,organizationNames,
        normalizedSearch:scopeKey(`${fullName} ${coach} ${team} ${organizationNames.join(' ')}`)});
      const existing=repByKey.get(repKey);
      if(existing){
        if(!existing.coach&&coach){ existing.coach=coach; existing.coachKey=coachKey; }
        if(!existing.team&&team) existing.team=team;
        for(const id of organizationIds) existing.organizationIds.add(id);
        existing.organizationNames=[...existing.organizationIds].map(id=>organizationById.get(id)?.name).filter(Boolean);
        existing.normalizedSearch=scopeKey(`${existing.fullName} ${existing.coach} ${existing.team} ${existing.organizationNames.join(' ')}`);
        continue;
      }
      repByKey.set(repKey,rep);
    }
    for(const rep of repByKey.values()){
      for(const id of rep.organizationIds) organizationById.get(id)?.repKeys.add(rep.repKey);
      if(rep.coachKey){
        if(!coachByKey.has(rep.coachKey)) coachByKey.set(rep.coachKey,{key:rep.coachKey,name:rep.coach||'Unassigned',repKeys:new Set(),organizationIds:new Set(),search:scopeKey(`${rep.coach} ${rep.team} ${rep.organizationNames.join(' ')}`)});
        const coach=coachByKey.get(rep.coachKey); coach.repKeys.add(rep.repKey); for(const id of rep.organizationIds) coach.organizationIds.add(id);
      }
    }
    const indexedOrganizations=sourceOrganizations.sort((a,b)=>a.name.localeCompare(b.name));
    const coaches=[...coachByKey.values()].sort((a,b)=>a.name.localeCompare(b.name));
    const indexedRepresentatives=[...repByKey.values()].sort((a,b)=>a.fullName.localeCompare(b.fullName));
    return {organizations:indexedOrganizations,organizationById,coaches,coachByKey,representatives:indexedRepresentatives,repByKey,allRepKeys:indexedRepresentatives.map(rep=>rep.repKey)};
  }
  function resolveScope(index,selection){
    selection=selection||{};
    const organizationIds=scopeSet(selection.organizationIds), coachKeys=scopeSet(selection.coachKeys), includeRepKeys=scopeSet(selection.includeRepKeys), excludeRepKeys=scopeSet(selection.excludeRepKeys);
    const hasGroupSelection=organizationIds.size>0||coachKeys.size>0, defaultAll=selection.allByDefault==null?!includeRepKeys.size:selection.allByDefault!==false, selected=new Set(hasGroupSelection||!defaultAll?[]:(index?.allRepKeys||[]));
    for(const id of organizationIds) for(const repKey of index?.organizationById?.get(id)?.repKeys||[]) selected.add(repKey);
    for(const key of coachKeys) for(const repKey of index?.coachByKey?.get(key)?.repKeys||[]) selected.add(repKey);
    for(const repKey of includeRepKeys) if(index?.repByKey?.has(repKey)) selected.add(repKey);
    for(const repKey of excludeRepKeys) selected.delete(repKey);
    return (index?.representatives||[]).filter(rep=>selected.has(rep.repKey));
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
      const aVolume=a?.volume, bVolume=b?.volume, aHasVolume=typeof aVolume==='number'&&Number.isFinite(aVolume), bHasVolume=typeof bVolume==='number'&&Number.isFinite(bVolume);
      if(aHasVolume!==bHasVolume) return bHasVolume-aHasVolume;
      if(aHasVolume&&bVolume!==aVolume) return bVolume-aVolume;
      return (b.score-a.score)||(a.ruleIndex-b.ruleIndex)||String(a.rule?.title||'').localeCompare(String(b.rule?.title||''))||String(a.rule?.id||'').localeCompare(String(b.rule?.id||''));
    });
  }
  function candidateVolume(observation){
    const value=Number.isFinite(observation?.value)?observation.value:numeric(observation?.raw,observation?.isPercent);
    return Number.isFinite(value)?value:null;
  }
  function uniqueRenderedMessages(sideName,candidates,rep,emailMatch,otherCandidate,resolver){
    const seen=new Set(), messages=[], errors=[];
    for(const candidate of candidates){
      const values=sideName==='Concern'?valuesForResult(rep,emailMatch,candidate,otherCandidate):valuesForResult(rep,emailMatch,otherCandidate,candidate);
      const rendered=resolveMessage(sideName,candidate,rep,emailMatch,values,resolver); errors.push(...rendered.errors);
      const text=cleanText(rendered.text), normalized=text.replace(/\s+/g,' ').toLowerCase();
      if(text&&!seen.has(normalized)){ seen.add(normalized); messages.push(text); }
    }
    return {messages,errors:[...new Set(errors)]};
  }
  function evaluateRepresentativePrepared(rep,rules,rosterIndex,resolver,template){
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
          const candidate={rule,ruleIndex,title:rule.title||side.source||side.field||sideName,sideName,side,observation,volume:candidateVolume(observation),score:evaluation.score,diagnostic};
          (sideName==='concern'?concerns:strengths).push(candidate);
        }
      });
    });
    const allRankedConcerns=rankCandidates(concerns), allRankedStrengths=rankCandidates(strengths);
    const rankedConcerns=template.maxConcerns?allRankedConcerns.slice(0,template.maxConcerns):allRankedConcerns;
    const rankedStrengths=template.maxStrengths?allRankedStrengths.slice(0,template.maxStrengths):allRankedStrengths;
    const concern=rankedConcerns[0]||null, strength=rankedStrengths[0]||null;
    const baseValues=valuesForResult(Object.assign({},rep,{fullName}),emailMatch,concern,strength);
    const concernRendered=uniqueRenderedMessages('Concern',rankedConcerns,rep,emailMatch,strength,resolver);
    const strengthRendered=uniqueRenderedMessages('Strength',rankedStrengths,rep,emailMatch,concern,resolver);
    const greeting=replaceVariables(template.header,baseValues,BUILT_INS);
    const concernHeading=concern?replaceVariables(template.concernHeading,baseValues,BUILT_INS):{text:'',errors:[]};
    const strengthHeading=strength?replaceVariables(template.strengthHeading,baseValues,BUILT_INS):{text:'',errors:[]};
    const generic=template.includeGeneric&&template.genericMessage?replaceVariables(template.genericMessage,baseValues,BUILT_INS):{text:'',errors:[]};
    const closing=replaceVariables(template.footer,baseValues,BUILT_INS);
    const wrapperParts=[greeting,concernHeading,strengthHeading,generic,closing];
    const errors=[...new Set(wrapperParts.flatMap(part=>part.errors||[]).concat(concernRendered.errors,strengthRendered.errors,generic.errors||[]))];
    const sections=[];
    if(greeting.text) sections.push(greeting.text);
    if(generic.text&&template.genericPlacement==='before') sections.push(generic.text);
    if(concern){ if(concernHeading.text) sections.push(concernHeading.text); sections.push(...concernRendered.messages); }
    if(strength){ if(strengthHeading.text) sections.push(strengthHeading.text); sections.push(...strengthRendered.messages); }
    if(generic.text&&template.genericPlacement==='after') sections.push(generic.text);
    if(closing.text) sections.push(closing.text);
    const hasBehavior=!!(concern||strength), hasGeneric=!!generic.text, anyMissingMetric=diagnostics.some(item=>item.enabled&&item.missing);
    let status='Ready';
    if(emailMatch.status==='ambiguous') status='Ambiguous Email';
    else if(emailMatch.status!=='matched') status='Missing Email';
    else if(errors.length) status='Template Error';
    else if(!hasBehavior&&!hasGeneric) status=anyMissingMetric?'Missing Metric':'No Qualifying Behavior';
    const sendReady=status==='Ready'&&(hasBehavior||hasGeneric);
    return {
      repKey:rep.repKey||rep.key||normalizeName(fullName),fullName,email:emailMatch.email||'',emailMatch,
      coach:rep.coach||rep.coachName||'',team:rep.team||rep.teamName||'',organizationNames:rep.organizationNames||[],
      concern,strength,concerns:rankedConcerns,strengths:rankedStrengths,
      qualifyingConcernCount:allRankedConcerns.length,qualifyingStrengthCount:allRankedStrengths.length,
      greeting:greeting.text||'',concernHeading:concernHeading.text||'',areasToFocusOn:concernRendered.messages.join('\n\n'),strengthHeading:strengthHeading.text||'',strengthSection:strengthRendered.messages.join('\n\n'),genericMessage:generic.text||'',closing:closing.text||'',
      concernMessages:concernRendered.messages,strengthMessages:strengthRendered.messages,diagnostics,errors,status,sendReady,
      message:hasBehavior||hasGeneric||template.includeNeither?sections.join('\n\n'):'',
      selectionReason:{
        concern:concern?'Highest observed Concern volume among qualifying rules; normalized severity breaks equal-volume ties.':'No Concern threshold was crossed.',
        strength:strength?'Highest observed Strength volume among qualifying rules; normalized severity breaks equal-volume ties.':'No Strength threshold was crossed.'
      }
    };
  }
  function evaluateRepresentative(rep,rules,rosterIndex,resolver,template){
    return evaluateRepresentativePrepared(rep,(rules||[]).map(normalizeRule),rosterIndex,resolver,normalizeTemplate(template));
  }
  function reviewCategory(result){
    if(result?.concern&&result?.strength) return 'mixed';
    if(result?.concern) return 'attention';
    if(result?.strength) return 'strength';
    return 'noFinding';
  }
  function compareReviewPriority(a,b){
    const order={attention:0,mixed:1,strength:2,noFinding:3}, categoryDiff=order[reviewCategory(a)]-order[reviewCategory(b)]; if(categoryDiff) return categoryDiff;
    const concernScore=item=>Math.max(0,...(item?.concerns||[]).map(candidate=>Number(candidate.score)||0));
    const scoreDiff=concernScore(b)-concernScore(a); if(scoreDiff) return scoreDiff;
    const concernCountDiff=(b?.concerns?.length||0)-(a?.concerns?.length||0); if(concernCountDiff) return concernCountDiff;
    const strengthScoreDiff=Math.max(0,...(b?.strengths||[]).map(candidate=>Number(candidate.score)||0))-Math.max(0,...(a?.strengths||[]).map(candidate=>Number(candidate.score)||0)); if(strengthScoreDiff) return strengthScoreDiff;
    return String(a?.fullName||'').localeCompare(String(b?.fullName||''))||String(a?.repKey||'').localeCompare(String(b?.repKey||''));
  }
  function sortReviewResults(results){ return (results||[]).slice().sort(compareReviewPriority); }
  function summarize(results){
    const summary={evaluated:results.length,matched:0,unmatched:0,ambiguous:0,ready:0,concern:0,strength:0,both:0,neither:0,attention:0,mixed:0,strengthOnly:0,noFinding:0,templateErrors:0,missingMetrics:0};
    for(const result of results){
      if(result.emailMatch.status==='matched') summary.matched++;
      else if(result.emailMatch.status==='ambiguous') summary.ambiguous++;
      else summary.unmatched++;
      if(result.sendReady) summary.ready++;
      if(result.concern) summary.concern++;
      if(result.strength) summary.strength++;
      if(result.concern&&result.strength) summary.both++;
      if(!result.concern&&!result.strength) summary.neither++;
      const category=reviewCategory(result); summary[category==='strength'?'strengthOnly':category]++;
      if(result.status==='Template Error') summary.templateErrors++;
      if(result.status==='Missing Metric') summary.missingMetrics++;
    }
    return summary;
  }
  function evaluateAll(options){
    options=options||{};
    if(!options.resolver||typeof options.resolver.resolveObservation!=='function'||typeof options.resolver.resolveVariable!=='function') throw new Error('An Individual Message data resolver is required.');
    const index=options.rosterIndex||buildRosterIndex(options.rosterRows||[]), rules=(options.rules||[]).map(normalizeRule), template=normalizeTemplate(options.template);
    const results=(options.representatives||[]).map(rep=>evaluateRepresentativePrepared(rep,rules,index,options.resolver,template));
    results.sort((a,b)=>String(a.fullName).localeCompare(String(b.fullName)));
    return {rosterIndex:index,results,summary:summarize(results)};
  }
  async function evaluateAllAsync(options){
    options=options||{};
    if(!options.resolver||typeof options.resolver.resolveObservation!=='function'||typeof options.resolver.resolveVariable!=='function') throw new Error('An Individual Message data resolver is required.');
    const index=options.rosterIndex||buildRosterIndex(options.rosterRows||[]), rules=(options.rules||[]).map(normalizeRule), template=normalizeTemplate(options.template), representatives=options.representatives||[], results=[];
    const sliceMs=Math.max(4,Number(options.sliceMs)||12), chunkSize=Math.max(1,Number(options.chunkSize)||25), yieldToBrowser=typeof options.yieldToBrowser==='function'?options.yieldToBrowser:()=>new Promise(resolve=>setTimeout(resolve,0));
    let sliceStarted=Date.now();
    for(let i=0;i<representatives.length;i++){
      if(options.signal?.aborted||options.cancelled?.()){ const error=new Error('Individual review cancelled.'); error.name='AbortError'; throw error; }
      results.push(evaluateRepresentativePrepared(representatives[i],rules,index,options.resolver,template));
      const completed=i+1, shouldYield=completed%chunkSize===0||Date.now()-sliceStarted>=sliceMs;
      if(shouldYield||completed===representatives.length){ options.onProgress?.({completed,total:representatives.length,fraction:representatives.length?completed/representatives.length:1}); }
      if(shouldYield&&completed<representatives.length){ await yieldToBrowser(); sliceStarted=Date.now(); }
    }
    results.sort((a,b)=>String(a.fullName).localeCompare(String(b.fullName)));
    return {rosterIndex:index,results,summary:summarize(results)};
  }
  function filterResult(result,filter){
    if(!filter||filter==='all') return true;
    if(['attention','mixed','strength','noFinding'].includes(filter)) return reviewCategory(result)===filter;
    if(filter==='ready') return result.sendReady;
    if(filter==='hasConcern') return !!result.concern;
    if(filter==='hasStrength') return !!result.strength;
    if(filter==='both') return !!result.concern&&!!result.strength;
    if(filter==='concernOnly') return !!result.concern&&!result.strength;
    if(filter==='strengthOnly') return !result.concern&&!!result.strength;
    if(filter==='neither') return !result.concern&&!result.strength;
    if(filter==='missingEmail') return result.status==='Missing Email';
    if(filter==='emailIssue') return result.status==='Missing Email'||result.status==='Ambiguous Email';
    if(filter==='ambiguous') return result.status==='Ambiguous Email';
    if(filter==='templateError') return result.status==='Template Error';
    if(filter==='missingMetric') return result.status==='Missing Metric';
    return true;
  }

  return {
    SCHEMA_VERSION,DEFAULT_TEMPLATE,BUILT_INS,normalizeName,splitName,rosterRows,buildRosterIndex,matchRosterName,
    buildScopeIndex,resolveScope,reviewCategory,compareReviewPriority,sortReviewResults,
    normalizeVariable,normalizeSide,normalizeRuleConfig,normalizeRule,normalizeTemplate,numeric,compareObservation,
    operatorLabel,conditionLabel,formatValue,replaceVariables,evaluateRepresentative,evaluateAll,evaluateAllAsync,summarize,filterResult
  };
});
