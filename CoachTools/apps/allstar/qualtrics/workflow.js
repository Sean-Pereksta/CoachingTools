/* Pure presentation/workflow helpers. Existing evaluation and storage schemas are unchanged. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  if(root) root.QualtricsWorkflow=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const EMAIL_COLUMNS=Object.freeze(['Name','Email','Header','Concern Areas','Strengths','Footer']);
  const join=parts=>parts.filter(Boolean).join('\n\n');
  function emailFields(result,template={}){
    return {
      Name:result.fullName||'', Email:result.email||'',
      Header:join([result.greeting,template.genericPlacement!=='after'?result.genericMessage:'']),
      'Concern Areas':join([result.concernHeading,result.areasToFocusOn||(result.concernMessages||[]).join('\n\n')]),
      Strengths:join([result.strengthHeading,result.strengthSection||(result.strengthMessages||[]).join('\n\n')]),
      Footer:join([template.genericPlacement==='after'?result.genericMessage:'',result.closing])
    };
  }
  function canonical(value){
    if(Array.isArray(value)) return value.map(canonical);
    if(value&&typeof value==='object') return Object.fromEntries(Object.keys(value).sort().filter(key=>key!=='updatedAt'&&key!=='createdAt').map(key=>[key,canonical(value[key])]));
    return value;
  }
  function fingerprint(rules){
    // A small advisory content checksum avoids persisting a second rule library.
    const text=JSON.stringify(rules.slice().sort((a,b)=>String(a.id).localeCompare(String(b.id))).map(canonical));
    let first=2166136261,second=5381;
    for(let i=0;i<text.length;i++){ first=Math.imul(first^text.charCodeAt(i),16777619); second=Math.imul(second,33)^text.charCodeAt(i); }
    return `${text.length}:${(first>>>0).toString(16)}:${(second>>>0).toString(16)}`;
  }
  function rulesetStatus(attachment,rules,draftDirty=false){
    if(!attachment) return {kind:'none',label:'— No Ruleset Attached'};
    if(attachment.error) return {kind:'review',label:'! File Changed / Review Required'};
    return draftDirty||attachment.fingerprint!==fingerprint(rules)?{kind:'dirty',label:'● Unsaved Changes'}:{kind:'current',label:'✓ Up to Date'};
  }
  function matchingRules(name,rules){
    const low=String(name||'').toLowerCase();
    return rules.filter(rule=>!['statRule','statCount','coachingCorrective'].includes(rule.ruleType)&&rule.baseName&&low.includes(String(rule.baseName).toLowerCase()));
  }
  const searchCache=new WeakMap();
  function invalidateSearch(rule){ searchCache.delete(rule); }
  function searchText(rule){
    if(!searchCache.has(rule)){
      const values=[];
      function visit(value){ if(Array.isArray(value)) value.forEach(visit); else if(value&&typeof value==='object') Object.entries(value).forEach(([key,item])=>{ if(!['id','createdAt','updatedAt'].includes(key)) visit(item); }); else if(typeof value==='string') values.push(value); }
      visit(rule); searchCache.set(rule,values.join(' ').toLowerCase());
    }
    return searchCache.get(rule);
  }
  function matchesSearch(rule,query){ return String(query||'').toLowerCase().trim().split(/\s+/).every(word=>searchText(rule).includes(word)); }
  const COACHING_NEEDS_COLUMNS=Object.freeze(['Representative','Priority','Priority Reason','Coach','Team','Organizations','Topics Needing Coaching','Recently Coached Topics','Follow-up Topics','Total Concern Topics','Topics Without Recent Coaching','Topics Never Coached','Latest Topic Coaching','Latest Any Coaching','Days Since Any Coaching','Topic Coaching Details','Topic Lookback Days','Report Date']);
  function calendarDate(value){
    if(!value) return '';
    if(value instanceof Date) return isNaN(value)?'':`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
    const match=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
    if(!match) return '';
    const date=new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
    return !isNaN(date)&&date.toISOString().slice(0,10)===match[0]?match[0]:'';
  }
  function coachingNeedsRows(records,reportDate){
    const asOf=calendarDate(reportDate), groups=new Map();
    const historicalDate=value=>{ const date=calendarDate(value); return date&&(!asOf||date<=asOf)?date:''; };
    for(const record of records||[]){
      const name=String(record.repName||record.fullName||'').trim(), key=String(record.repKey||name.toLowerCase().replace(/\s+/g,' ')).trim();
      if(!key||!name) continue;
      if(!groups.has(key)) groups.set(key,{name,coach:record.coach||'',team:record.team||'',organizations:new Set(),topics:new Map(),latestAny:''});
      const group=groups.get(key), topic=String(record.topic||record.ruleTitle||'Concern').trim(), topicKey=String(record.topicId||record.ruleId||topic);
      for(const org of record.organizationNames||[]) if(org) group.organizations.add(org);
      const latest=historicalDate(record.latestTopicCoaching), latestAny=historicalDate(record.latestAnyCoaching);
      if(latestAny>group.latestAny) group.latestAny=latestAny;
      const current=group.topics.get(topicKey)||{title:topic,recent:false,followUp:false,latest:'',lookbackDays:0};
      current.recent=current.recent||!!record.recent;
      current.followUp=current.followUp||!!record.followUp;
      current.lookbackDays=Math.max(current.lookbackDays,Number(record.lookbackDays)||0);
      if(latest>current.latest) current.latest=latest;
      group.topics.set(topicKey,current);
    }
    const rows=[];
    for(const group of groups.values()){
      const topics=[...group.topics.values()].sort((a,b)=>a.title.localeCompare(b.title)), overdue=topics.filter(topic=>!topic.recent), recent=topics.filter(topic=>topic.recent), followUp=topics.filter(topic=>topic.recent&&topic.followUp);
      // Recent coaching closes the coaching gap unless the current need explicitly requires follow-up.
      if(!overdue.length&&!followUp.length) continue;
      const priority=!recent.length?'High':overdue.length?'Medium':'Low — follow-up';
      const reason=!recent.length?`No recent topic-matched coaching on any of ${topics.length} concern topic(s).`:overdue.length?`${overdue.length} of ${topics.length} concern topic(s) lack recent topic-matched coaching.`:'All concern topics were coached recently; repeated or elevated concerns still require follow-up.';
      const latest=topics.map(topic=>topic.latest).sort().pop()||'', days=group.latestAny&&asOf?Math.round((Date.parse(`${asOf}T00:00:00Z`)-Date.parse(`${group.latestAny}T00:00:00Z`))/86400000):'';
      rows.push({Representative:group.name,Priority:priority,'Priority Reason':reason,Coach:group.coach,Team:group.team,Organizations:[...group.organizations].sort().join(' | '),'Topics Needing Coaching':overdue.map(topic=>topic.title).join(' | '),'Recently Coached Topics':recent.map(topic=>topic.title).join(' | '),'Follow-up Topics':followUp.map(topic=>topic.title).join(' | '),'Total Concern Topics':topics.length,'Topics Without Recent Coaching':overdue.length,'Topics Never Coached':topics.filter(topic=>!topic.latest).length,'Latest Topic Coaching':latest,'Latest Any Coaching':group.latestAny,'Days Since Any Coaching':days,'Topic Coaching Details':topics.map(topic=>`${topic.title}: ${topic.latest||'No matching coaching found'} (${topic.recent?'recent':'needs coaching'})`).join(' | '),'Topic Lookback Days':topics.map(topic=>`${topic.title}: ${topic.lookbackDays}`).join(' | '),'Report Date':asOf});
    }
    const priorityOrder={'High':0,'Medium':1,'Low — follow-up':2};
    return rows.sort((a,b)=>priorityOrder[a.Priority]-priorityOrder[b.Priority]||b['Topics Never Coached']-a['Topics Never Coached']||b['Topics Without Recent Coaching']-a['Topics Without Recent Coaching']||String(a['Latest Topic Coaching']).localeCompare(String(b['Latest Topic Coaching']))||a.Representative.localeCompare(b.Representative));
  }
  function coachingNeedsCsv(rows){
    // Keep pasted names/topic labels as text when Excel opens the CSV.
    const cell=value=>{ let text=String(value??''); if(/^[\s]*[=+@-]/.test(text)) text="'"+text; return '"'+text.replace(/"/g,'""')+'"'; };
    return '\ufeff'+[COACHING_NEEDS_COLUMNS,...(rows||[]).map(row=>COACHING_NEEDS_COLUMNS.map(column=>row[column]))].map(row=>row.map(cell).join(',')).join('\r\n');
  }
  return {EMAIL_COLUMNS,emailFields,fingerprint,rulesetStatus,matchingRules,matchesSearch,invalidateSearch,COACHING_NEEDS_COLUMNS,coachingNeedsRows,coachingNeedsCsv};
});
