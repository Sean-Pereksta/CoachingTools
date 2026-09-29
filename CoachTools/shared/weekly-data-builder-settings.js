(function(root){
  'use strict';
  const D=root.CoachToolsStatsDirectory,B=root.WeeklyBuilder,doc=root.document;
  if(!D||!B)return;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const panel=doc.createElement('section');panel.className='panel stats-settings';panel.setAttribute('aria-label','Saved manager groups and name replacements');
  panel.innerHTML=`<style>.stats-settings{padding:20px;margin-top:16px}.stats-settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}.stats-settings label{display:block;font-size:12px;margin-top:8px}.stats-settings input:not([type=checkbox]),.stats-settings select{width:100%}.stats-settings .settings-actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.stats-settings ul{padding-left:20px;max-height:230px;overflow:auto}.stats-settings td{white-space:normal;overflow-wrap:anywhere}.stats-settings .settings-scroll{max-height:240px;overflow:auto}.stats-settings input[type=file]{position:static;width:auto;height:auto;opacity:1}.stats-settings summary{padding:7px 0}.stats-settings .hint{font-size:12px}@media(max-width:800px){.stats-settings-grid{grid-template-columns:1fr}}</style>
  <h2>Saved managers &amp; automatic name replacements</h2><p class="hint">Settings stay in this browser. Report statistics are not saved here. Export settings to transfer them to another browser or file location.</p>
  <div class="stats-settings-grid"><div><h3>Manager → Coaches</h3><p id="stats-discovered" class="hint"></p><div class="settings-actions"><button type="button" id="stats-save-groups">Save detected manager groups</button></div><div id="stats-groups"></div><details><summary>Change a coach’s manager</summary><label>Coach<input id="stats-group-coach" list="stats-coach-names"></label><label>Manager<input id="stats-group-manager" list="stats-manager-names"></label><button type="button" id="stats-save-link">Save coach assignment</button></details></div>
  <div><h3>Automatically replace a name on upload</h3><label>Name type<select id="stats-role"><option value="name">Representative</option><option value="coach">Coach</option><option value="manager">Manager</option></select></label><label>Name from the export<input id="stats-from" list="stats-source-names" placeholder="Select or enter the source name"></label><label>Replace it with<input id="stats-to" list="stats-source-names" placeholder="Preferred name"></label><div class="settings-actions"><button type="button" id="stats-save-alias">Save replacement</button><button type="button" id="stats-cancel-alias" hidden>Cancel edit</button></div><div id="stats-rules" class="settings-scroll"></div><p class="hint">Exact full-name matches only; no fuzzy matching. Saved rules apply before matching new reports. Changing rules invalidates the current preview. Existing history stays unchanged in Add mode.</p></div></div>
  <details><summary>Settings backup / transfer</summary><div class="settings-actions"><button type="button" id="stats-export">Export settings</button><label>Import settings<input type="file" id="stats-import" accept=".json,application/json"></label></div></details><p id="stats-settings-message" role="status" class="hint"></p><datalist id="stats-source-names"></datalist><datalist id="stats-coach-names"></datalist><datalist id="stats-manager-names"></datalist>`;
  doc.querySelector('.controls').after(panel);
  const $=id=>doc.getElementById(id);let editing='';
  function message(text,error=false){const e=$('stats-settings-message');e.textContent=text;e.style.color=error?'#ad1830':'';}
  function detected(){const s=B.getSources().appointments;return s?.analysis?D.discover(s.originalRows||s.rows,s.analysis):{links:[],conflicts:[]};}
  function candidates(role){
    const names=new Map();
    for(const s of Object.values(B.getSources()))if(s?.analysis){const col=s.analysis.dims[role];if(col>=0)for(const row of (s.originalRows||s.rows).slice(s.analysis.headerRow+1))if(!D.summary(row[col]))names.set(D.key(row[col]),D.clean(row[col]));}
    for(const a of D.snapshot().aliases)if(a.role===role){names.set(D.key(a.from),a.from);names.set(D.key(a.to),a.to);}
    for(const g of D.grouped()){if(role==='manager')names.set(D.key(g.name),g.name);if(role==='coach')for(const c of g.coaches)names.set(D.key(c),c);}
    return [...names.values()].sort((a,b)=>a.localeCompare(b));
  }
  function render(){
    const found=detected(),groups=D.grouped();
    $('stats-discovered').textContent=found.links.length+' coach assignments detected in the Opportunity file'+(found.conflicts.length?' · '+found.conflicts.length+' conflicting coach assignments will not be saved.':'.');
    $('stats-save-groups').disabled=!found.links.length;
    $('stats-groups').innerHTML=groups.length?groups.map(g=>`<details><summary>${esc(g.name)} · ${g.coaches.length} coaches</summary><ul>${g.coaches.map(c=>'<li>'+esc(c)+'</li>').join('')}</ul></details>`).join(''):'<p class="hint">No manager groups saved yet. Load the new Opportunity export, then save the detected groups.</p>';
    if(found.conflicts.length)$('stats-groups').innerHTML+='<p class="hint">Needs review: '+found.conflicts.map(c=>esc(c.coach)+' ('+c.managers.map(esc).join(' / ')+')').join('; ')+'</p>';
    for(const [role,id] of [[ $('stats-role').value,'stats-source-names'],['coach','stats-coach-names'],['manager','stats-manager-names']])$(id).innerHTML=candidates(role).map(n=>'<option value="'+esc(n)+'"></option>').join('');
    const rules=D.snapshot().aliases;
    $('stats-rules').innerHTML=rules.length?'<table><thead><tr><th>Enabled / type</th><th>Replacement</th><th>Actions</th></tr></thead><tbody>'+rules.map((a,i)=>`<tr><td><label><input type="checkbox" data-toggle="${i}" ${a.enabled?'checked':''}>${esc(a.role==='name'?'Representative':a.role)}</label></td><td>${esc(a.from)} → ${esc(a.to)}</td><td><button type="button" class="small" data-edit="${i}">Edit</button> <button type="button" class="small" data-delete="${i}">Delete</button></td></tr>`).join('')+'</tbody></table>':'<p class="hint">No replacements saved.</p>';
    $('stats-rules').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{const a=rules[+b.dataset.edit];editing=a.role+'|'+D.key(a.from);$('stats-role').value=a.role;$('stats-from').value=a.from;$('stats-to').value=a.to;$('stats-cancel-alias').hidden=false;render();});
    $('stats-rules').querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>change(async()=>{const s=D.snapshot();s.aliases.splice(+b.dataset.delete,1);await D.save(s);},'Replacement deleted. Rebuild the preview.'));
    $('stats-rules').querySelectorAll('[data-toggle]').forEach(b=>b.onchange=()=>change(async()=>{const s=D.snapshot();s.aliases[+b.dataset.toggle].enabled=b.checked;await D.save(s);},'Replacement updated. Rebuild the preview.'));
  }
  async function change(work,success){try{await D.ready;const applied=await work();if(applied!==false)message(success);render();}catch(e){message(e.message,true);render();}}
  $('stats-save-groups').onclick=()=>change(()=>D.saveHierarchy(detected().links),'Manager groups saved. They are now available in Clean Upload’s coach selector.');
  $('stats-save-link').onclick=()=>change(async()=>{const coach=D.clean($('stats-group-coach').value),manager=D.clean($('stats-group-manager').value);if(D.summary(coach)||D.summary(manager))throw new Error('Choose a coach and manager.');await D.saveHierarchy([{coach,manager}]);},'Coach assignment saved.');
  $('stats-save-alias').onclick=()=>change(async()=>{
    const role=$('stats-role').value,from=D.clean($('stats-from').value),to=D.clean($('stats-to').value);
    if(from===to)throw new Error('The replacement must differ from the source name.');
    const s=D.snapshot(),id=role+'|'+D.key(from);s.aliases=s.aliases.filter(a=>a.role+'|'+D.key(a.from)!==id&&a.role+'|'+D.key(a.from)!==editing);s.aliases.push({role,from,to,enabled:true});await D.save(s);
    editing='';$('stats-from').value='';$('stats-to').value='';$('stats-cancel-alias').hidden=true;
  },'Replacement saved. Future uploads will apply it automatically; rebuild this preview to see the change.');
  $('stats-cancel-alias').onclick=()=>{editing='';$('stats-from').value='';$('stats-to').value='';$('stats-cancel-alias').hidden=true;};
  $('stats-role').onchange=render;
  $('stats-export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(D.snapshot(),null,2)],{type:'application/json'})),a=doc.createElement('a');a.href=url;a.download='CoachTools_Stats_Settings.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  $('stats-import').onchange=()=>change(async()=>{const file=$('stats-import').files[0];if(!file)return false;if(file.size>1000000)throw new Error('Choose a settings JSON file smaller than 1 MB.');const value=D.validate(JSON.parse(await file.text()));if(!root.confirm('Replace saved manager groups and name replacements with this settings file?'))return false;await D.save(value);$('stats-import').value='';},'Settings import complete.');
  root.addEventListener('coachtools-stats-directory-change',render);root.addEventListener('weekly-builder-sources-change',render);
  D.ready.then(()=>{render();const status=D.getStatus();message(status.warning||'Settings storage: '+status.mode+'.');}).catch(e=>message(e.message,true));
  render();
})(window);
