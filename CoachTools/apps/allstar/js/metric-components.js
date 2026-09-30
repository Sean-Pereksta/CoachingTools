/* Reusable rate calculations. Values returned to All-Star use percentage points. */
(function(root){
  'use strict';
  const nameKey=x=>String(x??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
  function component(row,field,settings,read){
    const actual=Object.keys(row._fieldMeta||{}).find(k=>nameKey(k)===nameKey(field))||field;
    const raw=read(row,field),declared=row._fieldStates?.[actual],meta=row._fieldMeta?.[actual];
    let status=declared&&declared!=='valid'?declared:raw===undefined?'missing':raw===null?'missing':String(raw).trim()===''?'blank':String(raw).trim()==='*'?'suppressed':/^(n\/?a|—|not applicable)$/i.test(String(raw).trim())?'unavailable':'valid';
    let value=null;
    if(status==='valid'){
      const text=String(raw).trim(),n=Number(text.replace(/,/g,'').replace(/%$/,''));
      const unit=settings.componentUnits?.[field]||meta?.storageUnit||settings.componentUnit||'percentage-points';
      value=n*(text.endsWith('%')?1:unit==='fraction'?100:1);
      if(!/^-?(?:\d+(?:,\d{3})*(?:\.\d+)?|\.\d+)%?$/.test(text)||!Number.isFinite(value)||value<0||value>100){status='invalid';value=null;}else if(value===0)status='zero';
    }
    if(['blank','missing'].includes(status)){
      if(settings.excludeMissing!==false)return {field,raw,status,value:null,included:false,reason:status+' excluded'};
      if(settings.missingAsZero)return {field,raw,status,value:0,included:!settings.excludeZero,reason:settings.excludeZero?'Explicit missing-as-zero excluded by zero rule':'Explicitly treated as zero'};
      return {field,raw,status,value:null,included:false,requiredMissing:true,reason:status+' prevents calculation; missing-as-zero is off'};
    }
    const included=(status==='valid'||status==='zero')&&!(settings.excludeZero&&value===0);
    return {field,raw,status,value,included,reason:included?'Included':status==='zero'?'Zero excluded':status+' excluded'};
  }
  function evaluate(settings,rows,read=(r,f)=>r[f]){
    const fields=[...new Set(settings.componentFields||[])],groups=new Map();let noIdentity=0;
    for(const row of rows||[]){
      if(row._ranked===false)continue;
      const person=row._personId||row['Employee ID'],name=row._rep||row.Representative||row['EMPLOYEE_FULL_NAME'];
      if(!person&&!name){noIdentity++;continue;}
      const key=person?'id:'+person:'name:'+nameKey(name),g=groups.get(key)||{key,name:name||String(person),rows:[],coaches:new Set(),managers:new Set(),person:!!person};
      g.rows.push(row);g.coaches.add(nameKey(row._team||row.Coach));g.managers.add(row._manager||row.Manager||'Unassigned Manager');groups.set(key,g);
    }
    const representatives=[];
    for(const g of groups.values()){
      const ambiguous=!g.person&&g.coaches.size>1,components=[];
      for(const field of fields){
        const cells=g.rows.map(r=>component(r,field,settings,read)),available=cells.filter(c=>['valid','zero'].includes(c.status)),unique=[...new Set(available.map(c=>c.value))];
        let c=available[0]||cells.find(c=>!['blank','missing'].includes(c.status))||cells[0];
        if(unique.length>1)c={field,value:null,status:'conflicting',included:false,reason:'Conflicting source rows; select a reporting scope'};
        if(ambiguous)c={field,value:null,status:'ambiguous-identity',included:false,reason:'Same name under multiple coaches; resolve identity or filter to one coach'};
        components.push(c);
      }
      const eligible=components.filter(c=>c.included),requiredMissing=components.some(c=>c.requiredMissing),value=!requiredMissing&&eligible.length?eligible.reduce((n,c)=>n+c.value,0)/eligible.length:null;
      representatives.push({key:g.key,name:g.name,coach:g.rows[0]._team||g.rows[0].Coach||'',manager:g.managers.size===1?[...g.managers][0]:'Unassigned Manager',value,components,sourceRows:g.rows.length,included:eligible.length,total:fields.length,reason:requiredMissing?'Required component missing':ambiguous?'Ambiguous identity':eligible.length?'':'No eligible components'});
    }
    const eligible=representatives.filter(r=>r.value!==null),value=eligible.length?eligible.reduce((n,r)=>n+r.value,0)/eligible.length:null;
    return {value,representatives,eligible:eligible.length,total:representatives.length,noIdentity,method:'Average selected fields per representative, then average eligible representatives',unit:'percentage-points'};
  }
  const api={component,evaluate};root.CoachToolsMetricComponents=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);

/* Optional creation UI bootstrap. The rate utility above remains unchanged.
 * Defer until all legacy scripts are ready; no source scans or categorization. */
(function(){
  if(typeof document==='undefined'||!document.currentScript?.src)return;
  const base=document.currentScript.src;
  const load=file=>new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src=new URL(file,base).href;
    script.onload=resolve;script.onerror=()=>{script.remove();reject(new Error('Could not load '+file));};document.head.appendChild(script);
  });
  const start=async()=>{
    try{if(!window.AllStarSentenceQuery)await load('sentence-query.js');if(!window.AllStarSentenceWorkspace)await load('sentence-workspace.js');}
    catch(error){console.warn('[All-Star sentence builder]',error);const toolbar=document.querySelector('.toolbar');if(toolbar&&!document.getElementById('sentenceBuilderRetry')){const button=document.createElement('button');button.id='sentenceBuilderRetry';button.textContent='Retry sentence builder';button.onclick=()=>{button.remove();start();};toolbar.appendChild(button);}}
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
