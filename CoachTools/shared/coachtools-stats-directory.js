/* Shared weekly-stat settings. Report rows are never persisted here. */
(function (root) {
  'use strict';
  const KEY = 'coachtools.statsDirectory.v1';
  const clean = v => String(v == null ? '' : v).normalize('NFKC').trim().replace(/\s+/g, ' ');
  function key(v) {
    let s = clean(v).toLowerCase().replace(/[‘’]/g, "'").replace(/[‐‑–—]/g, '-');
    if ((s.match(/,/g) || []).length === 1) { const [a,b] = s.split(',').map(clean); if(a && b) s = b + ' ' + a; }
    return s;
  }
  const header = v => clean(v).toLowerCase().replace(/[_\-./]+/g, ' ').replace(/\s+/g, ' ');
  const summary = v => !clean(v) || /^(total|grand total|subtotal|overall total|all reps|all representatives|all employees|all agents|\*|-)(\s*[:(].*)?$/i.test(clean(v));
  const roles = ['name', 'coach', 'manager'];
  function roleOf(v) {
    const h = header(v);
    if (['name','employee name','employee full name','employee fullname','rep name','representative name','csr name','agent name','full name','representative','rep'].includes(h)) return 'name';
    if (['sheet','coach','coach name','job coach','supervisor','supervisor name','team','team coach','team leader','employee supervisor name','employee immediate supervisor name'].includes(h)) return 'coach';
    if (['manager','manager name','manger','manger name','employee manager name','employee second level supervisor name'].includes(h)) return 'manager';
    return '';
  }
  function empty() { return {version:1, revision:0, aliases:[], links:[]}; }
  function validate(value) {
    if (!value || value.version !== 1 || !Array.isArray(value.aliases) || !Array.isArray(value.links)) throw new Error('This is not a supported stats-settings file.');
    const result = {version:1, revision:Number(value.revision)||0, aliases:[], links:[]};
    const seen = new Set();
    for(const a of value.aliases) {
      if(!a || !roles.includes(a.role) || summary(a.from) || summary(a.to)) throw new Error('Each name replacement needs a role and two nonblank person names.');
      const from=clean(a.from),to=clean(a.to),id=a.role+'|'+key(from);
      if (/^[=+@\-]/.test(from) || /^[=+@\-]/.test(to) || from.length>200 || to.length>200) throw new Error('Use a person name, not a formula, for name replacements.');
      if(seen.has(id)) throw new Error('Two replacements use the same source name and role.');
      seen.add(id); result.aliases.push({role:a.role,from,to,enabled:a.enabled!==false});
    }
    const links = new Map();
    for(const l of value.links) {
      if(!l || summary(l.coach) || summary(l.manager)) continue;
      const id=key(l.coach),old=links.get(id);
      if(old && key(old.manager)!==key(l.manager)) throw new Error('A saved coach cannot belong to two managers.');
      links.set(id,{coach:clean(l.coach),manager:clean(l.manager)});
    }
    result.links=[...links.values()];
    for(const a of result.aliases) resolve(a.from,a.role,result); // Reject cycles before saving.
    const canonicalLinks=new Map();
    for(const link of result.links){
      const coach=key(resolve(link.coach,'coach',result)),manager=key(resolve(link.manager,'manager',result));
      if(canonicalLinks.has(coach)&&canonicalLinks.get(coach)!==manager)throw new Error('That replacement would put the same coach under two managers. Update the coach assignment first.');
      canonicalLinks.set(coach,manager);
    }
    return result;
  }
  function resolve(value, role, settings) {
    let current=clean(value); if(summary(current)) return current;
    const seen=new Set(),rules=(settings||state).aliases;
    for(let i=0;i<=rules.length;i++) {
      const k=key(current),rule=rules.find(a=>a.enabled!==false&&a.role===role&&key(a.from)===k);
      if(!rule) return current;
      if(key(rule.to)===k) return rule.to; // An intentional capitalization / display spelling change.
      if(seen.has(k)) throw new Error('Name replacements contain a cycle. Remove the circular rule.');
      seen.add(k);current=rule.to;
    }
    throw new Error('Name replacements contain a cycle.');
  }
  function rewriteRows(rows,analysis,settings) {
    const active=settings||state,changes=[];
    if(!analysis || !active.aliases.some(a=>a.enabled!==false)) return {rows,changes};
    const result=rows.map((row,i)=>{
      if(i<=analysis.headerRow || !Array.isArray(row)) return row;
      let copy=row;
      for(const role of roles) {
        const col=analysis.dims[role];if(!Number.isInteger(col)||col<0||summary(row[col]))continue;
        const to=resolve(row[col],role,active);
        if(to!==clean(row[col])) {if(copy===row)copy=row.slice();copy[col]=to;changes.push({row:i+1,role,from:clean(row[col]),to});}
      }
      return copy;
    });
    return {rows:result,changes};
  }
  function discover(rows,analysis,settings) {
    if(!analysis || !Number.isInteger(analysis.dims.manager) || !Number.isInteger(analysis.dims.coach) || analysis.dims.manager<0 || analysis.dims.coach<0) return {links:[],conflicts:[]};
    const map=new Map();
    for(const row of rows.slice(analysis.headerRow+1)) {
      const coach=resolve(row[analysis.dims.coach],'coach',settings),manager=resolve(row[analysis.dims.manager],'manager',settings);
      if(summary(coach)||summary(manager))continue;
      const id=key(coach);if(!map.has(id))map.set(id,new Map());map.get(id).set(key(manager),{coach,manager});
    }
    return {links:[...map.values()].filter(x=>x.size===1).map(x=>[...x.values()][0]),conflicts:[...map.values()].filter(x=>x.size>1).map(x=>({coach:[...x.values()][0].coach,managers:[...x.values()].map(v=>v.manager)}))};
  }
  function grouped(settings) {
    const map=new Map();
    for(const l of (settings||state).links) {
      const coach=resolve(l.coach,'coach',settings),manager=resolve(l.manager,'manager',settings),id=key(manager);
      if(!map.has(id))map.set(id,{name:manager,coaches:new Map()});map.get(id).coaches.set(key(coach),coach);
    }
    return [...map.values()].map(g=>({name:g.name,coaches:[...g.coaches.values()].sort((a,b)=>a.localeCompare(b))})).sort((a,b)=>a.name.localeCompare(b.name));
  }
  function managerFor(coach,settings) {
    const matches=grouped(settings).filter(g=>g.coaches.some(c=>key(c)===key(resolve(coach,'coach',settings))));
    return matches.length===1?matches[0].name:'';
  }
  function inspectRows(rows) {
    for(let i=0;i<Math.min(rows.length,60);i++) {
      const dims={name:-1,coach:-1,manager:-1};
      rows[i].forEach((v,j)=>{const role=roleOf(v);if(role && dims[role]<0)dims[role]=j;});
      if(dims.name>=0 && (dims.coach>=0||dims.manager>=0))return {headerRow:i,dims};
    }
    return null;
  }
  function applyDataset(parsed,source) {
    if(!['weeklyRetail','weeklyReferral','retail','referral'].includes(source)||!parsed?.workbook)return parsed;
    const data={...parsed.workbook.data};let count=0;
    for(const name of parsed.workbook.sheets||[]) {
      const sheet=data[name],rows=sheet?.aoa;if(!Array.isArray(rows))continue;
      const rewritten=rewriteRows(rows,inspectRows(rows));count+=rewritten.changes.length;
      if(rewritten.rows!==rows)data[name]={...sheet,aoa:rewritten.rows};
    }
    return {...parsed,meta:{...parsed.meta,statsNameReplacements:count,statsDirectoryRevision:state.revision},workbook:{...parsed.workbook,data}};
  }
  function mapScope(scope,source) {
    if(!scope||!['weeklyRetail','weeklyReferral','retail','referral'].includes(source))return scope;
    const map=a=>Array.isArray(a)?[...new Set(a.map(v=>resolve(v,'coach')))]:a;
    return {...scope,coaches:map(scope.coaches),coachKeys:map(scope.coachKeys),sourceSelections:scope.sourceSelections?{...scope.sourceSelections,[source]:map(scope.sourceSelections[source])}:scope.sourceSelections};
  }
  let state=empty(),db=null,storageMode='session',storageWarning='',writeQueue=Promise.resolve();
  try {const raw=root.localStorage?.getItem(KEY);if(raw){state=validate(JSON.parse(raw));storageMode='localStorage';}} catch(e){storageWarning='Saved settings could not be read: '+e.message;}
  const ready=new Promise(resolveReady=>{
    if(!root.indexedDB){storageMode=root.localStorage?'localStorage':'session';resolveReady();return;}
    const request=root.indexedDB.open('coachtoolsStatsDirectory',1);
    request.onupgradeneeded=()=>{request.result.createObjectStore('settings');};
    request.onerror=()=>{storageWarning='IndexedDB is unavailable; settings use local browser storage.';storageMode=root.localStorage?'localStorage':'session';resolveReady();};
    request.onblocked=()=>{storageWarning='Close older CoachTools tabs to finish opening saved settings.';resolveReady();};
    request.onsuccess=()=>{
      db=request.result;db.onversionchange=()=>{db.close();db=null;};storageMode='IndexedDB';
      const tx=db.transaction('settings','readonly'),get=tx.objectStore('settings').get(KEY);
      get.onsuccess=()=>{try{if(get.result)state=validate(get.result);}catch(e){storageWarning='Saved settings need review: '+e.message;}};
      tx.oncomplete=()=>{notify();resolveReady();};tx.onerror=()=>{storageWarning='Saved settings could not be loaded.';resolveReady();};
    };
  });
  function snapshot(){return JSON.parse(JSON.stringify(state));}
  function notify(){try{root.dispatchEvent?.(new root.CustomEvent('coachtools-stats-directory-change'));}catch(_) {}}
  function save(value) {
    const next=validate(value);
    const task=writeQueue.catch(()=>{}).then(async()=>{
      await ready;next.revision=Math.max(Date.now(),state.revision+1);
      if(db) await new Promise((ok,fail)=>{const tx=db.transaction('settings','readwrite');tx.objectStore('settings').put(next,KEY);tx.oncomplete=ok;tx.onerror=()=>fail(new Error('Could not save stats settings. Export a settings backup before closing.'));tx.onabort=tx.onerror;});
      else if(!root.localStorage)throw new Error('Browser storage is unavailable. Settings have not been saved.');
      try{root.localStorage?.setItem(KEY,JSON.stringify(next));}catch(e){if(!db)throw new Error('Browser storage is full or disabled. Settings have not been saved.');storageWarning='IndexedDB saved successfully, but the compatibility mirror could not be written.';}
      state=next;notify();return snapshot();
    });writeQueue=task;return task;
  }
  async function saveHierarchy(links) {
    await ready;
    const next=snapshot(),map=new Map(next.links.map(l=>[key(resolve(l.coach,'coach')),l]));
    for(const l of links)if(!summary(l.coach)&&!summary(l.manager))map.set(key(resolve(l.coach,'coach')),{coach:resolve(l.coach,'coach'),manager:resolve(l.manager,'manager')});
    next.links=[...map.values()];return save(next);
  }
  root.addEventListener?.('storage',event=>{if(event.key!==KEY||!event.newValue)return;try{const next=validate(JSON.parse(event.newValue));if(next.revision>state.revision){state=next;notify();}}catch(_) {}});
  const api={version:'1.0.0',KEY,clean,key,summary,roleOf,resolve,rewriteRows,discover,grouped,managerFor,inspectRows,applyDataset,mapScope,validate,ready,snapshot,save,saveHierarchy,getStatus:()=>({mode:storageMode,warning:storageWarning})};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.CoachToolsStatsDirectory=api;
})(typeof globalThis!=='undefined'?globalThis:this);
