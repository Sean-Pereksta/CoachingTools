/* Organization-file normalization and merge rules shared by All-Star and Clean Upload. */
(function(root){
  'use strict';
  const nameKey=value=>String(value??'').replace(/[“”]/g,'"').replace(/[‘’]/g,"'").trim().replace(/^['"]|['"]$/g,'').replace(/\s+/g,' ').toLowerCase();
  const identityKey=value=>String(value??'').toLowerCase().replace(/%/g,' percent ').replace(/&/g,' and ').trim().replace(/[^a-z0-9]+/g,'');
  const createId=()=> 'm'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
  function coachDisplay(value){
    let text=String(value??'').replace(/\s*(\([^)]*\)|\[[^\]]*\])\s*$/g,'').replace(/\s+/g,' ').trim();
    if(text.includes(',')){
      const parts=text.split(',').map(x=>x.trim()).filter(Boolean);
      if(parts.length>=2){
        const last=parts.shift(),suffixes=new Set(['jr','sr','ii','iii','iv','v']),tail=[];
        while(parts.length&&suffixes.has(identityKey(parts[parts.length-1])))tail.unshift(parts.pop());
        text=[parts.join(' '),last,...tail].filter(Boolean).join(' ');
      }
    }
    return text.replace(/[\u2018\u2019]/g,"'").replace(/[\u2010-\u2014]/g,'-').toLowerCase().replace(/\b[a-z]/g,m=>m.toUpperCase()).replace(/\b([ivx]+|jr|sr)\b/gi,m=>m.toUpperCase()).replace(/\s+/g,' ').trim();
  }
  function canonicalCoach(value){
    return coachDisplay(root.CoachToolsStatsDirectory?.resolve(String(value??'').trim(),'coach')||value);
  }
  function storedCoachResolver(){
    if(root.CoachToolsStatsDirectory)return canonicalCoach;
    // Read the directory's compatibility mirror for this import only. Loading
    // its global data hooks here would also change the pending data-file upload.
    let aliases=[];try{const saved=JSON.parse(root.localStorage?.getItem('coachtools.statsDirectory.v1')||'{}');if(Array.isArray(saved.aliases))aliases=saved.aliases;}catch(_){}
    const clean=v=>String(v??'').normalize('NFKC').trim().replace(/\s+/g,' ');
    const key=value=>{let s=clean(value).toLowerCase().replace(/[‘’]/g,"'").replace(/[‐‑–—]/g,'-');if((s.match(/,/g)||[]).length===1){const [a,b]=s.split(',').map(clean);if(a&&b)s=b+' '+a;}return s;};
    return value=>{
      let current=clean(value);const seen=new Set();
      for(let i=0;i<=aliases.length;i++){
        const k=key(current),rule=aliases.find(a=>a.enabled!==false&&a.role==='coach'&&key(a.from)===k);
        if(!rule)return coachDisplay(current);
        if(key(rule.to)===k)return coachDisplay(rule.to);
        if(seen.has(k))throw new Error('Saved coach aliases contain a cycle. Review Stats Settings.');
        seen.add(k);current=rule.to;
      }
      throw new Error('Saved coach aliases contain a cycle. Review Stats Settings.');
    };
  }
  function normalize(org={},options={}){
    const now=new Date().toISOString(),coaches=new Map(),coach=options.canonicalCoach||canonicalCoach,key=options.coachKey||(value=>identityKey(coach(value)));
    (org.coachNames||[]).forEach(value=>{const name=coach(value);if(name)coaches.set(key(name),name);});
    return {id:org.id||(options.createId||createId)(),name:String(org.name||'New Org').trim()||'New Org',coachNames:[...coaches.values()].sort((a,b)=>a.localeCompare(b)),createdAt:org.createdAt||now,updatedAt:org.updatedAt||now};
  }
  function merge(text,existing=[],options={}){
    const parsed=JSON.parse(text),coach=storedCoachResolver(),normalizeOrg=options.normalizeOrg||(org=>normalize(org,{canonicalCoach:coach})),key=options.nameKey||nameKey;
    const incoming=(Array.isArray(parsed)?parsed:(parsed.orgs||[])).map(org=>normalizeOrg(org)),orgs=existing.slice();
    for(const org of incoming){
      const index=orgs.findIndex(saved=>saved.id===org.id);
      if(index>=0)orgs[index]=org;
      else {if(orgs.some(saved=>key(saved.name)===key(org.name)))org.name+=' copy';orgs.push(org);}
    }
    return {orgs:orgs.map(org=>normalizeOrg(org)),imported:incoming.length};
  }
  root.CoachToolsOrganizationImport=Object.freeze({normalize,merge,nameKey});
})(window);
