(function horizonWorkspace(root) {
  'use strict';
  const $ = id => document.getElementById(id);
  let scopeGeneration = 0;
  let opener = null;
  let selectedCoaches = new Map();
  let coachSelectionChanged = false;
  function pickerOpen() { return $('scopePicker').hasAttribute('open'); }
  function currentScope() { return root.CoachToolsStorage?.getScope?.() || {mode:'all',label:'All people'}; }
  function scopeName(scope) { return scope.mode === 'all' ? 'All people' : scope.label || scope.coaches?.[0] || scope.representatives?.[0] || scope.team || scope.department || 'Selected data view'; }
  function modeName(mode) { return ({coach:'Coach',representative:'Representative',team:'Team',department:'Department',coordinator:'Coordinator'})[mode] || 'Data view'; }
  function scopeOptions() {
    const options=[...($('globalScopeSelect')?.options || [])].filter(option => option.value !== 'all:' && !option.value.startsWith('coaches:')).map(option => {
      const mode = option.value.split(':')[0];
      const saved=/^Saved /i.test(option.textContent);
      return {value:option.value,mode,saved,personId:option.dataset.personId || (mode==='coach' && !saved?option.value.slice(6):''),label:option.textContent.replace(/^(?:Saved )?(?:Coach|Representative|Team|Department|Coordinator):\s*/i,'')};
    });
    return options.filter(option=>!(option.saved && option.mode==='coach' && options.some(candidate=>!candidate.saved && candidate.mode==='coach' && candidate.label.toLowerCase()===option.label.toLowerCase())));
  }
  function resetCoachSelection() {
    const scope=currentScope(), ids=new Set(scope.coachPersonIds || []);
    if(scope.mode==='coach' && scope.personId)ids.add(scope.personId);
    const names=new Set((scope.coaches || []).map(name=>name.trim().toLowerCase()));
    selectedCoaches=new Map();
    if(scope.mode!=='coach' && !(scope.mode==='team' && !scope.team && scope.coaches?.length))return;
    for(const option of scopeOptions().filter(option=>option.mode==='coach')) {
      if(ids.size ? ids.has(option.personId) : names.has(option.label.toLowerCase()) || scope.mode==='coach' && scope.label===option.label)selectedCoaches.set(option.value,option);
    }
  }
  function updateCoachSelection() {
    const count=selectedCoaches.size;
    $('scopeSelectionCount').textContent=count ? count+' coach'+(count===1?'':'es')+' selected' : 'No coaches selected';
    $('applyCoachScope').disabled=!count;
  }
  function renderScopeResults() {
    const query = $('scopeSearch').value.trim().toLowerCase(), type = $('scopeType').value;
    // Directory hydration can finish after opening the picker. Until the user
    // changes a checkbox, restore the saved selection by identity each render.
    if(!coachSelectionChanged)resetCoachSelection();
    const available=scopeOptions();
    for(const option of available)if(selectedCoaches.has(option.value))selectedCoaches.set(option.value,option);
    for(const option of selectedCoaches.values())if(!available.some(candidate=>candidate.value===option.value))available.push(option);
    const options = available.filter(option => (type === 'all' || option.mode === type) && (!query || option.label.toLowerCase().includes(query)));
    const selected = $('globalScopeSelect').value;
    $('scopeResults').replaceChildren(...options.map(option => {
      const item=document.createElement('div');item.setAttribute('role','listitem');
      const coach=option.mode==='coach',checked=coach?selectedCoaches.has(option.value):selected===option.value;
      const button=document.createElement(coach?'label':'button');if(!coach)button.type='button';button.className='scope-result'+(checked?' selected':'');
      const avatar=document.createElement('span');avatar.className='scope-avatar';avatar.textContent=option.label.split(/\s+/).map(part=>part[0]).slice(0,2).join('').toUpperCase();avatar.setAttribute('aria-hidden','true');
      const copy=document.createElement('span'),name=document.createElement('strong'),detail=document.createElement('small');
      name.textContent=option.label;detail.textContent=modeName(option.mode);copy.append(name,detail);button.append(avatar,copy);
      if(coach) {
        const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.className='scope-coach-checkbox';checkbox.value=option.value;checkbox.checked=checked;
        checkbox.setAttribute('aria-label','Coach: '+option.label);
        checkbox.addEventListener('change',()=>{coachSelectionChanged=true;if(checkbox.checked)selectedCoaches.set(option.value,option);else selectedCoaches.delete(option.value);button.classList.toggle('selected',checkbox.checked);updateCoachSelection();});
        button.append(checkbox);
      } else {
        const marker=document.createElement('span');marker.className='scope-check';marker.textContent=checked?'✓':'→';button.append(marker);
        button.setAttribute('aria-label',modeName(option.mode)+': '+option.label+(checked?', current data view':''));
        button.addEventListener('click',()=>chooseScope(option.value));
      }
      item.append(button);return item;
    }));
    $('scopeResultCount').textContent=options.length ? options.length+' matching data view'+(options.length===1?'':'s') : scopeOptions().length ? 'No matches. Try a different name or type.' : 'No coach directory is available yet. Load weekly team data in Data Manager to add coaches and representatives.';
    $('scopeAllPeople').classList.toggle('selected',currentScope().mode==='all');updateCoachSelection();
  }
  function closePicker() { if($('scopePicker').open)$('scopePicker').close();else $('scopePicker').removeAttribute('open');opener?.focus(); }
  function chooseScope(value) {
    const select=$('globalScopeSelect');
    if (![...select.options].some(option=>option.value===value)) return;
    select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));closePicker();updateScope();
  }
  function applyCoachScope() {
    const coaches=[...selectedCoaches.values()];
    if(!coaches.length)return;
    if(coaches.length===1 && [...$('globalScopeSelect').options].some(option=>option.value===coaches[0].value))return chooseScope(coaches[0].value);
    root.CoachToolsStorage?.setScope?.({
      mode:coaches.length===1?'coach':'team',label:coaches.length===1?coaches[0].label:coaches.length+' selected coaches',
      coaches:coaches.map(option=>option.label),coachPersonIds:coaches.map(option=>option.personId).filter(Boolean),
      personId:'',team:'',department:'',coordinator:'',representatives:[]
    });
    closePicker();updateScope();
  }
  function openPicker(event) {
    opener=event?.currentTarget || $('scopeTrigger');$('scopeSearch').value='';
    coachSelectionChanged=false;resetCoachSelection();
    const scope=currentScope(),mode=scope.mode;$('scopeType').value=mode==='all' || mode==='team' && !scope.team && scope.coaches?.length?'coach':mode;
    renderScopeResults();
    if(typeof $('scopePicker').showModal==='function'){if(!$('scopePicker').open)$('scopePicker').showModal();}else $('scopePicker').setAttribute('open','');
    $('scopeSearch').focus();
  }
  async function updateScope() {
    const generation=++scopeGeneration,scope=currentScope(),name=scopeName(scope),specific=scope.mode!=='all';
    $('activeScopeName').textContent=name;$('workspaceScopeName').textContent=name;$('clearScope').hidden=!specific;
    document.querySelector('.scope-card').classList.toggle('scoped',specific);
    const view=scope.coaches?.length>1 && !scope.team?'Selected coaches':modeName(scope.mode);
    $('activeScopeDetail').textContent=specific?view+' view · Connected reports show this selection’s data.':'All available people · Choose one or more coaches to focus connected reports on their teams.';
    try {
      if(!specific || !root.CoachToolsAppData?.filterPeople || !root.CoachToolsIdentity?.getAllPeople)return;
      const people=await root.CoachToolsAppData.filterPeople(await root.CoachToolsIdentity.getAllPeople());
      if(generation!==scopeGeneration)return;
      const reps=people.filter(person=>person.role==='representative').length;
      $('activeScopeDetail').textContent=view+' view · '+reps+' representative'+(reps===1?'':'s')+' in the loaded directory. Connected reports follow this selection.';
    } catch(_) { /* The selected view remains explicit even before the directory loads. */ }
    finally { if(pickerOpen())renderScopeResults(); }
  }
  function favoriteIds() {
    const fallback=(root.COACHTOOLS_MANIFEST?.apps||[]).filter(app=>app.enabled!==false&&app.favorite).map(app=>app.id);
    try { const stored=JSON.parse(localStorage.getItem('coachtools.desktop.favorites.v1')||'null');return Array.isArray(stored)?stored:fallback; }catch(_){return fallback;}
  }
  function renderFavorites() {
    const ids=favoriteIds(),apps=(root.COACHTOOLS_MANIFEST?.apps||[]).filter(app=>app.enabled!==false);
    const favorites=ids.map(id=>apps.find(app=>app.id===id)).filter(Boolean);
    $('favoritesEmpty').hidden=Boolean(favorites.length);
    $('favoriteTools').replaceChildren(...favorites.map(app=>{
      const button=document.createElement('button');button.type='button';button.className='favorite-tool';
      const icon=document.createElement('img');icon.src=app.icon;icon.alt='';
      const name=document.createElement('span');name.textContent=app.name;
      button.append(icon,name);button.addEventListener('click',()=>{
        // Existing desktop tiles own app activation, window restore, and data readiness.
        let tile=document.querySelector('[data-app-id="'+app.id+'"]');
        if(!tile){const search=$('appSearch');search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#categoryFilters .category-filter')?.click();tile=document.querySelector('[data-app-id="'+app.id+'"]');}
        tile?.click();
      });return button;
    }));
  }
  function editFavorites() {
    const selected=new Set(favoriteIds());
    $('favoritesChoices').replaceChildren(...(root.COACHTOOLS_MANIFEST?.apps||[]).filter(app=>app.enabled!==false).map(app=>{
      const label=document.createElement('label'),input=document.createElement('input'),icon=document.createElement('img'),name=document.createElement('span');
      input.type='checkbox';input.value=app.id;input.checked=selected.has(app.id);icon.src=app.icon;icon.alt='';name.textContent=app.name;label.append(input,icon,name);return label;
    }));
    if(typeof $('favoritesPicker').showModal==='function')$('favoritesPicker').showModal();else $('favoritesPicker').setAttribute('open','');
  }
  function closeFavorites() { if($('favoritesPicker').open)$('favoritesPicker').close();else $('favoritesPicker').removeAttribute('open');$('editFavorites').focus(); }
  function start() {
    if(!$('scopePicker')||!$('globalScopeSelect'))return;
    for(const id of ['scopeTrigger','changeScope','workspaceScopeButton'])$(id).addEventListener('click',openPicker);
    $('closeScopePicker').addEventListener('click',closePicker);
    $('scopePicker').addEventListener('click',event=>{if(event.target===$('scopePicker'))closePicker();});
    $('scopeSearch').addEventListener('input',renderScopeResults);$('scopeType').addEventListener('change',renderScopeResults);
    $('scopeAllPeople').addEventListener('click',()=>chooseScope('all:'));$('clearScope').addEventListener('click',()=>chooseScope('all:'));
    $('applyCoachScope').addEventListener('click',applyCoachScope);
    $('globalScopeSelect').addEventListener('change',()=>{updateScope();renderScopeResults();});
    new MutationObserver(()=>{updateScope();renderScopeResults();}).observe($('globalScopeSelect'),{childList:true,subtree:true});
    root.addEventListener('coachtools:scope-updated',updateScope);root.addEventListener('coachtools:identity-updated',updateScope);
    $('editFavorites').addEventListener('click',editFavorites);$('closeFavoritesPicker').addEventListener('click',closeFavorites);
    $('favoritesPicker').addEventListener('click',event=>{if(event.target===$('favoritesPicker'))closeFavorites();});
    $('saveFavorites').addEventListener('click',()=>{const ids=[...$('favoritesChoices').querySelectorAll('input:checked')].map(input=>input.value);localStorage.setItem('coachtools.desktop.favorites.v1',JSON.stringify(ids));root.dispatchEvent(new CustomEvent('coachtools:favorites-updated'));renderFavorites();closeFavorites();});
    root.addEventListener('coachtools:favorites-updated',renderFavorites);
    updateScope();renderFavorites();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})(window);
