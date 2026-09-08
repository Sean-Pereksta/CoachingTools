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
  return {EMAIL_COLUMNS,emailFields,fingerprint,rulesetStatus,matchingRules,matchesSearch,invalidateSearch};
});
