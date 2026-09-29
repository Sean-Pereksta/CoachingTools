/* Manager shortcuts drive the existing per-source coach checkboxes. */
(function(root){
  'use strict';
  const D=root.CoachToolsStatsDirectory,doc=root.document;
  if(!D||!doc)return;
  let pending=false,lastSignature='';
  function entries(){
    const result=[];
    for(const section of doc.querySelectorAll('#smartImportSources .smart-import-source')){
      const source=section.querySelector('.smart-import-source-heading strong')?.textContent||'';
      for(const input of section.querySelectorAll('input[type="checkbox"]')){
        const name=D.clean(input.closest('label')?.querySelector('span strong')?.textContent);
        if(name)result.push({input,name,source,key:D.key(D.resolve(name,'coach'))});
      }
    }
    return result;
  }
  function schedule(){if(pending)return;pending=true;(root.requestAnimationFrame||root.setTimeout).call(root,()=>{pending=false;render();});}
  function render(){
    const host=doc.getElementById('smartImportSources');
    if(!host){doc.getElementById('statsManagerPicker')?.remove();lastSignature='';return;}
    const groups=D.grouped(),items=entries();
    const signature=JSON.stringify([groups,items.map(x=>[x.source,x.name,x.input.checked,x.input.disabled])]);
    let panel=doc.getElementById('statsManagerPicker');
    if(panel && signature===lastSignature)return;
    lastSignature=signature;
    if(!panel){panel=doc.createElement('section');panel.id='statsManagerPicker';panel.setAttribute('aria-label','Select coaches by manager');host.before(panel);}
    panel.replaceChildren();panel.style.cssText='padding:12px;margin:10px 0;border:1px solid currentColor;border-radius:10px;max-height:240px;overflow:auto;';
    const title=doc.createElement('strong');title.textContent='Managers — select their coaches';panel.append(title);
    const note=doc.createElement('p');note.style.cssText='font-size:12px;margin:6px 0 10px;';
    note.textContent=groups.length?'Saved in Weekly Data Builder. You can still change individual coaches below.':'Save manager groups in Weekly Data Builder to select a manager here. Individual coach selection still works.';panel.append(note);
    for(const group of groups){
      const keys=new Set(group.coaches.map(D.key));
      const matches=items.filter(i=>keys.has(i.key)&&!i.input.disabled);
      const selected=matches.filter(i=>i.input.checked).length;
      const label=doc.createElement('label');label.style.cssText='display:flex;gap:8px;align-items:center;margin:7px 0;';
      const box=doc.createElement('input');box.type='checkbox';box.disabled=!matches.length;box.checked=!!matches.length&&selected===matches.length;box.indeterminate=selected>0&&selected<matches.length;
      const text=doc.createElement('span');text.textContent=group.name+' · '+new Set(matches.map(i=>i.key)).size+' of '+group.coaches.length+' coaches available';
      box.addEventListener('change',()=>{
        const checked=box.checked,visited=new Set();
        // Re-read after each event: the existing chooser may replace its DOM.
        for(let i=0;i<items.length;i++){
          const next=entries().find(e=>keys.has(e.key)&&!e.input.disabled&&e.input.checked!==checked&&!visited.has(e.source+'|'+e.name));
          if(!next)break;visited.add(next.source+'|'+next.name);next.input.click();
        }
        schedule();
      });
      label.append(box,text);panel.append(label);
    }
  }
  function start(){
    if(!doc.body){doc.addEventListener('DOMContentLoaded',start,{once:true});return;}
    new root.MutationObserver(schedule).observe(doc.body,{childList:true,subtree:true});
    doc.addEventListener('change',schedule);root.addEventListener('coachtools-stats-directory-change',schedule);schedule();
  }
  root.CoachToolsStatsManagerPicker={refresh:schedule};
  D.ready.then(start).catch(()=>{});
})(window);
